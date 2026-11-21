// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { installedBreezeTts } from '../../packages/installer/src/breeze-tts-install.mjs';
import {
  assertPrivatePath,
  writePrivateBytesAtomic,
} from '../../packages/runtime/src/safe-file.mjs';
import {
  readModelDevices,
  voiceDevicePreference,
} from '../../packages/runtime/src/model-device-settings.mjs';
import { breezeDeviceMatches, breezeEnvironment } from './breeze-devices.mjs';
import { voiceApiPcm } from './external-tts.mjs';

export const BREEZE_MODEL = 'breeze-tts-2-q4-k';
export const BREEZE_LICENSE_URL =
  'https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE';
export const BREEZE_PROFILE_ERROR = 'Choose a valid Breeze TTS 2 voice profile (.breeze).';
const maxProfileBytes = 8 * 1024 ** 2;
const maxWaveBytes = 24000 * 2 * 45 + 65536;
const decoder = new TextDecoder('utf-8', { fatal: true });
const execute = promisify(execFile);
const profilePath = (root) => path.join(root, 'data/voices/breeze-tts/profile.json');

function readBounded(file, limit) {
  assertPrivatePath(file);
  const descriptor = openSync(file, 'r');
  try {
    const info = fstatSync(descriptor);
    const { size, nlink } = info;
    if (!info.isFile() || nlink !== 1 || size < 1 || size > limit)
      throw new Error('Invalid file size or type.');
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const length = readSync(descriptor, bytes, offset, size - offset);
      if (!length) throw new Error('Incomplete file.');
      offset += length;
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

// BRZV v1/v2 files contain the encoded reference audio, not executable model weights.
export function validateBreezeProfile(bytes) {
  try {
    if (bytes.toString('latin1', 0, 4) !== 'BRZV') throw new Error();
    let offset = 4;
    const read32 = () => {
      const value = bytes.readUInt32LE(offset);
      offset += 4;
      return value;
    };
    const readString = (limit) => {
      const size = read32();
      if (size > limit || offset + size > bytes.length) throw new Error();
      const text = decoder.decode(bytes.subarray(offset, offset + size));
      offset += size;
      return text;
    };
    const version = read32();
    if (![1, 2].includes(version) || read32() !== 24000 || read32() !== 16) throw new Error();
    const frames = read32();
    // Keep reference conditioning bounded to two minutes at 12.5 frames/sec.
    if (!frames || frames > 1500) throw new Error();
    const transcript = readString(1024 ** 2);
    if (!transcript.trim() || transcript.includes('\0')) throw new Error();
    if (version === 2) {
      readString(65536);
      const fields = read32();
      if (fields > 256) throw new Error();
      for (let index = 0; index < fields; index++) {
        readString(256);
        readString(65536);
      }
    }
    if (bytes.length !== offset + frames * 16 * 4) throw new Error();
    for (; offset < bytes.length; offset += 4) {
      if (bytes.readUInt32LE(offset) > 2047) throw new Error();
    }
    return bytes;
  } catch {
    throw new Error(BREEZE_PROFILE_ERROR);
  }
}

export function loadBreezeProfile(root) {
  try {
    const value = JSON.parse(readBounded(profilePath(root), maxProfileBytes * 2).toString('utf8'));
    if (
      value?.schemaVersion !== 1 ||
      typeof value.name !== 'string' ||
      !value.name ||
      value.name.length > 255 ||
      typeof value.data !== 'string'
    )
      return null;
    const bytes = Buffer.from(value.data, 'base64');
    if (bytes.length > maxProfileBytes) return null;
    return { name: value.name, bytes: validateBreezeProfile(bytes) };
  } catch {
    return null;
  }
}

export function prepareBreezeProfile(source) {
  try {
    if (path.extname(source).toLowerCase() !== '.breeze') throw new Error();
    const bytes = readBounded(source, maxProfileBytes);
    validateBreezeProfile(bytes);
    return { name: path.basename(source), bytes };
  } catch {
    throw new Error(BREEZE_PROFILE_ERROR);
  }
}

export function saveBreezeProfile(root, { name, bytes }) {
  writePrivateBytesAtomic(
    profilePath(root),
    Buffer.from(JSON.stringify({ schemaVersion: 1, name, data: bytes.toString('base64') })),
  );
}

export class BreezeVoice {
  constructor({ root, installed = installedBreezeTts, run = execute }) {
    Object.assign(this, { root, installed, run });
    this.controller = new AbortController();
  }
  assets() {
    const engine = this.installed(this.root);
    if (!engine) throw new Error('Breeze TTS 2 is not installed.');
    const profile = loadBreezeProfile(this.root);
    if (!profile) throw new Error(BREEZE_PROFILE_ERROR);
    return { engine, profile };
  }
  prepare() {
    this.assets();
  }
  identity() {
    const profile = loadBreezeProfile(this.root);
    return profile
      ? BREEZE_MODEL + ':' + createHash('sha256').update(profile.bytes).digest('hex')
      : BREEZE_MODEL;
  }
  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
    return this.pending?.catch(() => {});
  }
  async synthesize({ text, signal }) {
    const lifetime = this.controller.signal;
    const request = signal ? AbortSignal.any([lifetime, signal]) : lifetime;
    request.throwIfAborted();
    // Wake acknowledgements share the same GPU as the reply and preview queue.
    const task = Promise.resolve(this.pending)
      .catch(() => {})
      .then(() => this.synthesizeLine(text, request));
    this.pending = task;
    try {
      return await task;
    } finally {
      if (this.pending === task) this.pending = null;
    }
  }
  async synthesizeLine(text, signal) {
    signal.throwIfAborted();
    if (typeof text !== 'string' || !text.trim() || text.length > 1200 || text.includes('\0'))
      throw new Error('Breeze TTS 2 needs a short line of text.');
    const { engine, profile } = this.assets();
    const device = voiceDevicePreference(readModelDevices(this.root).voice, 'breeze-tts');
    const ordinal = device.startsWith('vulkan:') ? Number(device.split(':')[1]) : undefined;
    const parent = path.join(this.root, '.runtime/breeze-voice-tmp');
    assertPrivatePath(parent);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const folder = await mkdtemp(path.join(parent, 'line-'));
    const wav = path.join(folder, 'line.wav');
    try {
      await writeFile(path.join(folder, 'capri.breeze'), profile.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      signal?.throwIfAborted();
      const options = [
        engine.model,
        '--voices-dir',
        folder,
        '--voice',
        'capri',
        '--max-new',
        '550',
        '--output',
        wav,
        ...(device === 'cpu' ? ['--cpu'] : []),
        '--text',
        text,
      ];
      const result = await this.run(engine.executable, options, {
        cwd: engine.cwd,
        env: breezeEnvironment(folder, ordinal),
        signal,
        windowsHide: true,
        timeout: 90000,
        maxBuffer: 256 * 1024,
      });
      signal?.throwIfAborted();
      if (
        ordinal !== undefined &&
        (!/^backend: Vulkan0, sample rate:/m.test(result.stdout) ||
          !breezeDeviceMatches(device, result.stderr))
      )
        throw new Error();
      const wave = readBounded(wav, maxWaveBytes);
      if (wave.toString('ascii', 0, 4) !== 'RIFF') throw new Error();
      return new Response(voiceApiPcm(wave), {
        headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000' },
      });
    } catch {
      signal?.throwIfAborted();
      // Native process errors can contain argv, including the line being spoken.
      throw new Error('Breeze TTS 2 could not synthesize this line.');
    } finally {
      await rm(folder, { recursive: true, force: true, maxRetries: 2 }).catch(() => {});
    }
  }
}
