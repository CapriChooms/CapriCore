// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from './storage.mjs';
import { apiKeyProblem, normalizeApiKey, validApiKey } from './renderer/api-key.mjs';
import { EXTERNAL_TTS_DEFAULTS, externalTtsSettings } from './renderer/external-tts-settings.mjs';

const MAX_PCM_BYTES = 24000 * 2 * 45;
const TEST_TEXT = 'Hello! This is a voice connection test.';
class VoiceApiError extends Error {}
const failure = (message, code = 'CAPRI_TTS_API_FAILED', status) =>
  Object.assign(new VoiceApiError(message), {
    code,
    ...(status ? { httpStatus: status } : {}),
  });
const unavailable = () => failure('Saved voice API access could not be read. Save the key again.');
function publicFailure(error, signal) {
  if (error instanceof VoiceApiError) return error;
  return signal.aborted
    ? failure('Voice API request cancelled or timed out.', 'CAPRI_TTS_API_CANCELLED')
    : failure(
        'Could not connect to the voice API. Check the provider address and network.',
        'CAPRI_TTS_API_NETWORK',
      );
}
function httpFailure(status) {
  const messages = {
    401: 'Voice API rejected the key (HTTP 401).',
    402: 'Voice API account balance or budget is insufficient (HTTP 402).',
    403: 'Voice API access was denied (HTTP 403).',
    404: 'Voice API endpoint, model or voice was not found (HTTP 404).',
    429: 'Voice API rate limit reached (HTTP 429). Try again later.',
  };
  return failure(
    messages[status] ?? 'Voice API request failed. Check the provider status and settings.',
    'CAPRI_TTS_API_HTTP',
    status,
  );
}
async function readAudio(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw failure('Voice API returned no audio.', 'CAPRI_TTS_API_FORMAT');
  const chunks = [];
  let bytes = 0,
    abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), cancelled]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PCM_BYTES + 65536)
        throw failure('Voice API audio exceeds the sentence limit.', 'CAPRI_TTS_API_LIMIT');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Providers send signed 16-bit, mono 24 kHz PCM; the existing player uses float32. */
export function voiceApiPcm(bytes) {
  let pcm = bytes;
  const invalid = () =>
    failure('Voice API must return mono 24 kHz, 16-bit PCM or WAV audio.', 'CAPRI_TTS_API_FORMAT');
  if (bytes.subarray(0, 4).toString() === 'RIFF') {
    if (bytes.subarray(8, 12).toString() !== 'WAVE') throw invalid();
    let format, audio;
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const id = bytes.toString('ascii', offset, offset + 4),
        size = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + size > bytes.length) throw invalid();
      if (id === 'fmt ' && size >= 16) format = bytes.subarray(start, start + size);
      if (id === 'data') audio = bytes.subarray(start, start + size);
      offset = start + size + (size % 2);
    }
    if (
      !format ||
      !audio ||
      format.readUInt16LE(0) !== 1 ||
      format.readUInt16LE(2) !== 1 ||
      format.readUInt32LE(4) !== 24000 ||
      format.readUInt16LE(14) !== 16
    )
      throw invalid();
    pcm = audio;
  }
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_PCM_BYTES) throw invalid();
  const result = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length / 2; i++)
    result.writeFloatLE(pcm.readInt16LE(i * 2) / 32768, i * 4);
  return result;
}

/** Main-process-only connection. No key or provider response body crosses IPC or enters logs. */
export class ExternalTts {
  constructor({ root, storage, fetchImpl = fetch }) {
    Object.assign(this, { storage, fetchImpl });
    this.file = path.join(root, 'data/secrets/tts-api.json');
    this.config = { ...EXTERNAL_TTS_DEFAULTS };
    this.controllers = new Set();
    this.lastFailure = null;
    try {
      noLinks(this.file);
      if (!existsSync(this.file)) return;
      const bytes = readFileSync(this.file);
      if (bytes.length > 32768) throw new Error();
      const value = JSON.parse(bytes.toString('utf8'));
      if (value.schemaVersion !== 1) throw new Error();
      this.config = externalTtsSettings(value.settings);
      if (
        value.credential &&
        (typeof value.credential.ciphertext !== 'string' ||
          value.credential.origin !== new URL(this.config.baseUrl).origin)
      )
        throw new Error();
      this.credential = value.credential ?? null;
    } catch {
      // Never silently revert a broken explicit cloud selection to local inference.
      this.config.enabled = true;
      this.loadError = true;
    }
  }
  status() {
    return { ...this.config, hasKey: Boolean(this.credential), loadError: Boolean(this.loadError) };
  }
  diagnostics() {
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      activeRequests: this.controllers.size,
      lastFailure: this.lastFailure,
    };
  }
  requiresKey(config = this.config) {
    return !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.baseUrl).hostname);
  }
  async key() {
    if (this.loadError) throw unavailable();
    if (!this.credential) {
      if (this.requiresKey())
        throw failure(
          'Save a voice API key before enabling external TTS.',
          'CAPRI_TTS_API_KEY_MISSING',
        );
      return null;
    }
    try {
      if (!(await this.storage.available())) throw new Error();
      const decoded = await this.storage.decrypt(Buffer.from(this.credential.ciphertext, 'base64'));
      const key = typeof decoded === 'string' ? decoded : decoded?.result;
      if (!validApiKey(key)) throw new Error();
      return key;
    } catch {
      throw unavailable();
    }
  }
  async prepare() {
    await this.key();
  }
  async save({ settings, key }, beforeCommit = async () => {}) {
    if (this.saving) throw new Error('Voice API settings are being saved.');
    this.saving = true;
    try {
      const config = externalTtsSettings(settings);
      let credential = this.credential;
      key = normalizeApiKey(key);
      const replacing = key !== undefined && key !== '';
      const origin = new URL(config.baseUrl).origin;
      if (credential && credential.origin !== origin && !replacing)
        throw new Error('Enter a new API key when changing the provider address.');
      if (replacing) {
        const problem = apiKeyProblem(key);
        if (problem) throw new Error(problem);
        try {
          if (!(await this.storage.available())) throw new Error();
          credential = {
            origin,
            ciphertext: Buffer.from(await this.storage.encrypt(key)).toString('base64'),
          };
        } catch {
          throw new Error('Secure credential storage is unavailable. API access was not saved.');
        }
      }
      if (config.enabled && !credential && this.requiresKey(config))
        throw new Error('Save a voice API key before enabling external TTS.');
      await beforeCommit();
      noLinks(this.file);
      writeJsonAtomic(this.file, {
        schemaVersion: 1,
        settings: config,
        credential: credential ?? null,
      });
      this.close();
      this.config = config;
      this.credential = credential;
      this.loadError = false;
      this.lastFailure = null;
      return this.status();
    } finally {
      this.saving = false;
    }
  }
  async remove(beforeCommit = async () => {}) {
    if (this.saving) throw new Error('Voice API settings are being saved.');
    this.saving = true;
    try {
      await beforeCommit();
      noLinks(this.file);
      if (existsSync(this.file)) unlinkSync(this.file);
      this.close();
      this.config = { ...EXTERNAL_TTS_DEFAULTS };
      this.credential = null;
      this.loadError = false;
      this.lastFailure = null;
      return this.status();
    } finally {
      this.saving = false;
    }
  }
  close() {
    for (const controller of this.controllers) controller.abort();
  }
  async synthesize({ text, signal: callerSignal, test = false }) {
    if (!test && !this.config.enabled) throw failure('External TTS is disabled.');
    if (typeof text !== 'string' || !text.trim() || text.length > 4096)
      throw failure('Invalid voice API text.');
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(45000),
      ...(callerSignal ? [callerSignal] : []),
    ]);
    const started = performance.now();
    this.controllers.add(controller);
    try {
      signal.throwIfAborted();
      const key = await this.key(),
        config = this.config;
      signal.throwIfAborted();
      const eleven = config.provider === 'elevenlabs';
      const url =
        config.baseUrl +
        (eleven
          ? '/text-to-speech/' + encodeURIComponent(config.voice) + '?output_format=pcm_24000'
          : '/audio/speech');
      const response = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/octet-stream',
          ...(key ? (eleven ? { 'xi-api-key': key } : { authorization: 'Bearer ' + key }) : {}),
        },
        body: JSON.stringify(
          eleven
            ? { text, model_id: config.model }
            : { input: text, model: config.model, voice: config.voice, response_format: 'pcm' },
        ),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw httpFailure(response.status);
      }
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const declaredRate =
        response.headers.get('x-sample-rate') ??
        response.headers.get('content-type')?.match(/;\s*(?:rate|samplerate)=(\d+)/i)?.[1];
      if (declaredRate && declaredRate !== '24000') {
        void response.body?.cancel().catch(() => {});
        throw failure(
          'Voice API must return mono 24 kHz, 16-bit PCM or WAV audio.',
          'CAPRI_TTS_API_FORMAT',
        );
      }
      if (
        ![
          'application/octet-stream',
          'audio/pcm',
          'audio/x-pcm',
          'audio/wav',
          'audio/x-wav',
          'audio/wave',
        ].includes(mime)
      ) {
        void response.body?.cancel().catch(() => {});
        throw failure(
          'Voice API must return mono 24 kHz, 16-bit PCM or WAV audio.',
          'CAPRI_TTS_API_FORMAT',
        );
      }
      const pcm = voiceApiPcm(await readAudio(response, signal));
      signal.throwIfAborted();
      this.lastFailure = null;
      return new Response(pcm, {
        headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000' },
      });
    } catch (error) {
      const safe = publicFailure(error, signal);
      this.lastFailure = {
        code: safe.code,
        httpStatus: safe.httpStatus,
        elapsedMs: Math.round(performance.now() - started),
      };
      throw safe;
    } finally {
      this.controllers.delete(controller);
    }
  }
  async test() {
    const started = performance.now();
    const response = await this.synthesize({ text: TEST_TEXT, test: true });
    const pcm = Buffer.from(await response.arrayBuffer());
    return {
      sampleRate: 24000,
      pcm: pcm.toString('base64'),
      elapsedMs: Math.round(performance.now() - started),
    };
  }
}
