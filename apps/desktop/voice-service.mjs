import { setTimeout as delay } from 'node:timers/promises';
import {
  currentResponseTiming,
  markResponseTiming,
} from '../../packages/runtime/src/response-timing.mjs';

import {
  SentenceBuffer,
  MAX_SPEECH_SENTENCE,
  speechLanguageMismatch,
} from './renderer/speech-text.mjs';
import { LANGUAGE_PACKS } from './renderer/language-settings.mjs';
export { SentenceBuffer, spokenText, MAX_SPEECH_SENTENCE } from './renderer/speech-text.mjs';

const VOICE_LANGUAGE_MISMATCH = 'CAPRI_VOICE_LANGUAGE_MISMATCH';
const VOICE_LANGUAGE_WARNING =
  'The English voice cannot read this response language. Text replies remain available.';
const VOICE_START_WARNING = 'Capri’s voice could not start. Text replies are still available.';
const voiceFailureCodes = new Set([
  VOICE_LANGUAGE_MISMATCH,
  'CAPRI_VOICE_SPEECH_LIMIT',
  'CAPRI_VOICE_CUDA_OOM',
  'CAPRI_VOICE_MODEL_MISSING',
  'CAPRI_VOICE_INFERENCE_FAILED',
]);
async function voiceHttpFailure(response) {
  const error = Object.assign(new Error(`Voice HTTP ${response.status}`), {
    httpStatus: response.status,
  });
  try {
    if (response.headers?.get('content-type')?.startsWith('application/json')) {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > 4096) break;
        chunks.push(chunk);
      }
      if (size <= 4096) {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (voiceFailureCodes.has(value?.code)) error.code = value.code;
      }
    } else await response.body?.cancel();
  } catch {
    /* Keep the HTTP status; never log arbitrary server response text. */
  }
  return error;
}

/** Turn-scoped sentence queue. Text replies never wait for synthesis. */
export class VoiceService {
  constructor({
    url,
    headers,
    emit,
    fetchImpl = fetch,
    enabled = true,
    language = 'en',
    external,
    ensureReady,
  }) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1')
      throw new Error('Voice service must use loopback');
    Object.assign(this, { url, headers, emit, fetchImpl, enabled, external, ensureReady });
    this.turn = null;
    this.ready = false;
    this.running = false;
    this.language = language;
    this.error = null;
  }
  snapshot() {
    return {
      enabled: this.enabled,
      ready: this.ready && this.language !== 'off',
      language: this.language,
      error: this.error,
      source: this.external?.config.enabled ? 'api' : 'local',
    };
  }
  diagnostics() {
    return {
      ...this.snapshot(),
      running: this.running,
      preparing: Boolean(this.prepareController),
      queuedSentences: this.turn?.queue.length ?? 0,
      lastFailure: this.lastFailure ?? null,
    };
  }
  get generating() {
    // Retained playback identity is not an inference that blocks reminders.
    return this.running || Boolean(this.turn && (!this.turn.final || this.turn.queue.length));
  }
  recordFailure(error, phase) {
    this.lastFailure = {
      at: new Date().toISOString(),
      phase,
      name: error.name,
      message: error.message,
      stack: error.stack?.slice(0, 12000),
      ...(voiceFailureCodes.has(error.code) ? { code: error.code } : {}),
      ...(Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}),
    };
  }
  setLanguage(language) {
    if (language !== 'off' && !LANGUAGE_PACKS.some((p) => p.id === language && p.speechReady))
      throw new Error('Unsupported voice language');
    if (language !== this.language) {
      this.cancel();
      this.prepareController?.abort();
    }
    this.language = language;
    this.emit({ type: 'voice.settings', ...this.snapshot() });
  }
  async prepareLanguage() {
    if (this.language === 'off') return;
    this.prepareController?.abort();
    const controller = (this.prepareController = new AbortController()),
      language = this.language;
    const requestId = `prepare:${language}:${Date.now()}`;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]);
    this.setReady(false);
    try {
      if (this.external?.config.enabled) {
        await this.external.prepare();
        if (this.prepareController === controller && this.language === language && !signal.aborted)
          this.setReady(true);
        return;
      }
      let response;
      do {
        response = await this.fetchImpl(`${this.url}/prepare`, {
          method: 'POST',
          headers: { ...this.headers(), 'content-type': 'application/json' },
          body: JSON.stringify({ language, requestId }),
          redirect: 'error',
          signal,
        });
        if (response.status !== 409) break;
        await response.body?.cancel();
        await delay(100, undefined, { signal });
      } while (!signal.aborted);
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new Error(
          details?.error === 'model_missing'
            ? 'Multilingual voice files are missing or damaged. Open Languages and install multilingual speech.'
            : `Could not prepare the selected voice model: HTTP ${response.status}`,
        );
      }
      await response.body?.cancel();
      if (this.prepareController === controller && this.language === language) this.setReady(true);
    } catch (error) {
      if (this.prepareController === controller && !controller.signal.aborted) {
        this.recordFailure(error, 'prepare');
        this.error = error.message;
        this.cancel();
        this.emit({ type: 'voice.settings', ...this.snapshot() });
        this.emit({
          type: 'voice.error',
          message: this.external?.config.enabled
            ? error.message
            : error.message.includes('Multilingual voice')
              ? error.message
              : 'The selected voice could not start. Text replies remain available. Check setup-multilingual.cmd.',
        });
      }
    } finally {
      if (this.prepareController === controller) this.prepareController = null;
    }
  }
  setReady(value) {
    this.ready = value;
    if (value) this.lastFailure = null;
    this.error = null;
    this.emit({ type: 'voice.settings', ...this.snapshot() });
    if (value) this.pump().catch(() => {});
  }
  fail(message) {
    this.ready = false;
    this.error = message;
    this.cancel();
    this.emit({ type: 'voice.settings', ...this.snapshot() });
    this.emit({ type: 'voice.error', message });
  }
  setEnabled(value) {
    if (typeof value !== 'boolean') throw new Error('Invalid voice setting');
    this.enabled = value;
    if (!value) this.cancel();
    this.emit({ type: 'voice.settings', ...this.snapshot() });
    return this.snapshot();
  }
  close() {
    this.prepareController?.abort();
    this.cancel();
  }
  cancel() {
    const turn = this.turn;
    if (turn) {
      turn.controller.abort();
      this.turn = null;
      if (turn.requestId && !turn.external)
        this.fetchImpl(`${this.url}/cancel`, {
          method: 'POST',
          headers: { ...this.headers(), 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: turn.requestId }),
          redirect: 'error',
          signal: AbortSignal.timeout(2000),
        })
          .then((response) => response.body?.cancel())
          .catch(() => {});
      this.emit({ type: 'voice.cancelled', turnId: turn.id });
    }
  }
  beginTurn(turnId, preview = false) {
    this.cancel();
    if (this.error && !this.ready) return;
    if ((this.enabled || preview) && this.language !== 'off') {
      const turn = (this.turn = {
        id: turnId,
        language: this.language,
        external: this.external?.config.enabled === true,
        controller: new AbortController(),
        buffer: new SentenceBuffer(),
        queue: [],
        final: false,
        sequence: 0,
        segments: 0,
        started: performance.now(),
        timing: currentResponseTiming(),
      });
      if (!this.ready && this.ensureReady) {
        // Start beside text generation and give the renderer the turn before a
        // startup failure or a fast provider can publish voice events for it.
        void Promise.resolve().then(async () => {
          if (this.turn !== turn || this.ready || this.prepareController) return;
          try {
            await this.ensureReady();
          } catch {
            // The host handles startup diagnostics and may already have failed this turn.
          }
          if (this.turn === turn && !this.ready && !this.prepareController) {
            // A busy installer or another temporary blocker can make the host
            // decline startup. Complete only this turn's voice path so the next
            // reply can try again without requiring a speaker toggle.
            this.cancel();
            this.emit({ type: 'voice.error', turnId: turn.id, message: VOICE_START_WARNING });
          }
        });
      }
    }
  }
  preview(turnId, text) {
    if (!this.ready || this.language === 'off')
      throw new Error('No spoken voice is selected for this language.');
    this.beginTurn(turnId, true);
    this.onChat({ type: 'turn.delta', turnId, text });
    this.onChat({ type: 'turn.completed', turnId });
  }
  onChat(event) {
    if (event.type === 'turn.started') {
      this.beginTurn(event.turnId);
    }
    const turn = this.turn;
    if (!turn || turn.id !== event.turnId) return;
    if (['turn.cancelled', 'turn.failed'].includes(event.type)) {
      this.cancel();
      return;
    }
    if (event.type === 'turn.preface') {
      if (
        turn.preface ||
        typeof event.text !== 'string' ||
        !event.text.trim() ||
        event.text.length > 240
      )
        return;
      turn.preface = true;
      turn.queue.push(event.text);
      turn.segments++;
      this.pump().catch(() => {});
      return;
    }
    if (event.type === 'turn.delta' || event.type === 'turn.completed') {
      if (event.text && !turn.textReceived) {
        turn.textReceived = true;
        if (turn.timing) markResponseTiming('voice_text', {}, { turn: turn.timing });
      }
      turn.final = event.type === 'turn.completed';
      const parts = turn.buffer.push(event.text || '', turn.final);
      if (parts.some((text) => text.length > MAX_SPEECH_SENTENCE)) {
        this.cancel();
        this.emit({
          type: 'voice.error',
          message: 'This sentence is too long to read aloud. The full text is still available.',
        });
        return;
      }
      turn.segments += parts.length;
      if (turn.segments > 100) {
        this.cancel();
        this.emit({ type: 'voice.error', message: 'This reply is too long to read aloud.' });
        return;
      }
      turn.queue.push(...parts);
      this.pump().catch(() => {});
    }
  }
  async pump() {
    const queued = this.turn;
    if (queued?.queue.length && !queued.queued) {
      queued.queued = true;
      if (queued.timing)
        markResponseTiming('voice_queued', { cold: this.ready ? 0 : 1 }, { turn: queued.timing });
    }
    if (this.running || !this.ready) return;
    this.running = true;
    try {
      while (this.turn) {
        const turn = this.turn;
        const text = turn.queue.shift();
        if (!text) {
          if (turn.final) this.emit({ type: 'voice.generated', turnId: turn.id });
          break;
        }
        if (!turn.external && speechLanguageMismatch(text, turn.language)) {
          if (!turn.languageWarning) {
            turn.languageWarning = true;
            this.recordFailure(
              Object.assign(new Error(VOICE_LANGUAGE_WARNING), { code: VOICE_LANGUAGE_MISMATCH }),
              'synthesis',
            );
            this.emit({ type: 'voice.warning', turnId: turn.id, message: VOICE_LANGUAGE_WARNING });
          }
          continue;
        }
        try {
          const started = Date.now();
          turn.requestId = `${turn.id}:${turn.sequence}`;
          if (turn.sequence === 0 && turn.timing)
            markResponseTiming(
              'voice_synthesis',
              { speechCharacters: text.length },
              { turn: turn.timing },
            );
          let response;
          if (turn.external) {
            response = await this.external.synthesize({ text, signal: turn.controller.signal });
          } else
            do {
              response = await this.fetchImpl(`${this.url}/synthesize`, {
                method: 'POST',
                headers: { ...this.headers(), 'content-type': 'application/json' },
                body: JSON.stringify({ text, language: turn.language, requestId: turn.requestId }),
                redirect: 'error',
                signal: AbortSignal.any([turn.controller.signal, AbortSignal.timeout(90000)]),
              });
              if (response.status !== 409) break;
              await response.body?.cancel();
              await delay(50, undefined, { signal: turn.controller.signal });
            } while (Date.now() - started < 90000);
          if (!response.ok) throw await voiceHttpFailure(response);
          if (
            response.headers.get('content-type') !== 'application/octet-stream' ||
            response.headers.get('x-sample-rate') !== '24000'
          )
            throw new Error('Unexpected voice audio format');
          const limit = 24000 * 4 * 45;
          const chunks = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > limit) throw new Error('Voice audio exceeds limit');
            chunks.push(chunk);
          }
          const pcm = Buffer.concat(chunks);
          if (!pcm.length || pcm.length % 4) throw new Error('Invalid PCM audio');
          if (this.turn !== turn || turn.controller.signal.aborted) continue;
          turn.requestId = null;
          if (turn.sequence === 0 && turn.timing)
            markResponseTiming(
              'voice_audio',
              {
                requestMs: Date.now() - started,
                tokenMs: Number(response.headers.get('x-t3-ms')),
                decoderMs: Number(response.headers.get('x-decoder-ms')),
              },
              { turn: turn.timing },
            );
          this.emit({
            type: 'voice.timing',
            turnId: turn.id,
            sequence: turn.sequence,
            elapsedMs: performance.now() - turn.started,
            requestMs: Date.now() - started,
            tokenMs: Number(response.headers.get('x-t3-ms')),
            decoderMs: Number(response.headers.get('x-decoder-ms')),
          });
          this.emit({
            type: 'voice.audio',
            turnId: turn.id,
            sequence: turn.sequence++,
            text,
            sampleRate: 24000,
            pcm: pcm.toString('base64'),
          });
        } catch (error) {
          if (this.turn === turn && !turn.controller.signal.aborted) {
            this.recordFailure(error, 'synthesize');
            this.cancel();
            this.emit({
              type: 'voice.error',
              message: turn.external
                ? error.message
                : error.code === 'CAPRI_VOICE_SPEECH_LIMIT'
                  ? 'This sentence could not be spoken. Voice is still ready.'
                  : 'Capri’s voice is unavailable. Text replies are still available.',
            });
            console.error('Voice request failed:', error.message);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
