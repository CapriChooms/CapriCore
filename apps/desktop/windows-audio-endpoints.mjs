// SPDX-License-Identifier: GPL-3.0-only
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareNativeHelper } from './native-helper.mjs';

export const WINDOWS_AUDIO_SAMPLE_RATE = 16000;
export const WINDOWS_AUDIO_PACKET_BYTES =
  (WINDOWS_AUDIO_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT) / 10;
const captureMarker = Buffer.from('CAPRI-AUDIO-1\n');
const listFailure = 'Audio devices could not be listed.';
const startFailure = 'The selected audio source could not start.';
const captureFailure = 'The selected audio source disconnected.';

export const validWindowsAudioEndpointId = (id) =>
  typeof id === 'string' && id.trim().length > 0 && id.length <= 512 && !/[\x00-\x1f\x7f]/.test(id);

/** Enumerate active Windows endpoints and capture one explicit route in a private child process. */
export class WindowsAudioEndpoints {
  constructor({
    root,
    platform = process.platform,
    prepare = prepareNativeHelper,
    run = promisify(execFile),
    spawnProcess = spawn,
  }) {
    Object.assign(this, { root, platform, prepare, run, spawnProcess });
  }

  list() {
    if (this.platform !== 'win32') return Promise.resolve([]);
    return (this.listing ??= this.readList().finally(() => {
      this.listing = null;
    }));
  }

  async readList() {
    try {
      const executable = await this.prepare(this.root, 'audio-endpoints');
      const { stdout } = await this.run(executable, ['list'], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 256 * 1024,
      });
      const devices = JSON.parse(stdout);
      if (!Array.isArray(devices) || devices.length > 256) throw new Error(listFailure);
      const result = new Map();
      for (const device of devices) {
        const { id, kind, label } = device ?? {};
        if (!validWindowsAudioEndpointId(id) || !['input', 'output'].includes(kind)) continue;
        result.set(id, {
          id,
          kind,
          label:
            typeof label === 'string'
              ? label
                  .replace(/[\x00-\x1f\x7f]/g, ' ')
                  .trim()
                  .slice(0, 180)
              : '',
        });
      }
      return [...result.values()];
    } catch {
      throw new Error(listFailure);
    }
  }

  async capture(id, { onPacket, onError = () => {}, signal } = {}) {
    if (
      this.platform !== 'win32' ||
      !validWindowsAudioEndpointId(id) ||
      typeof onPacket !== 'function'
    )
      throw new Error(startFailure);
    signal?.throwIfAborted();
    let child;
    try {
      const executable = await this.prepare(this.root, 'audio-endpoints');
      signal?.throwIfAborted();
      child = this.spawnProcess(executable, ['capture', id], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error(startFailure);
    }

    const opened = Promise.withResolvers();
    let ready = false;
    let finished = false;
    let pending = Buffer.allocUnsafe(captureMarker.length);
    let used = 0;
    let forceStop;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(startDeadline);
      signal?.removeEventListener('abort', stop);
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null)
        forceStop = setTimeout(() => child.kill(), 500).unref();
      if (!ready) opened.reject(error ?? signal?.reason ?? new Error(startFailure));
      else if (error) onError(error);
    };
    const stop = () => finish();
    const startDeadline = setTimeout(() => finish(new Error(startFailure)), 5000).unref();
    const ended = () => finish(new Error(ready ? captureFailure : startFailure));
    child.stdin.on('error', () => {});
    child.on('error', ended);
    child.on('close', () => {
      ended();
      clearTimeout(forceStop);
    });
    child.stdout.on('error', ended);
    child.stdout.on('data', (chunk) => {
      for (let offset = 0; !finished && offset < chunk.length; ) {
        const copy = Math.min(chunk.length - offset, pending.length - used);
        chunk.copy(pending, used, offset, offset + copy);
        offset += copy;
        used += copy;
        if (used !== pending.length) continue;
        const packet = pending;
        pending = Buffer.allocUnsafe(WINDOWS_AUDIO_PACKET_BYTES);
        used = 0;
        if (!ready) {
          if (!packet.equals(captureMarker)) {
            finish(new Error(startFailure));
            return;
          }
          ready = true;
          clearTimeout(startDeadline);
          opened.resolve({ stop });
        } else {
          try {
            onPacket(packet);
          } catch {
            finish(new Error(captureFailure));
          }
        }
      }
    });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    return opened.promise;
  }
}
