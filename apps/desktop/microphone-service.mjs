import { randomUUID } from 'node:crypto';
import { WakePhraseGate } from './wake-phrase.mjs';
import { MAX_SPEECH_SENTENCE } from './renderer/speech-text.mjs';
import { validateSpeechSettings, SPEECH_DEFAULTS } from './renderer/speech-settings.mjs';
import { LANGUAGE_PACKS } from './renderer/language-settings.mjs';
import { asrStartupStage } from './asr-worker.mjs';

const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const interruption = (text) =>
  /[\p{L}\p{N}]{3}/u.test(text) || /^(no|go|hi|ok)$/i.test(text.trim());
const commandText = (text) =>
  text
    .trim()
    .replace(/[.!?,;:]+$/g, '')
    .trim();
const microphoneOff = (text) =>
  /^(stop listening|microphone off|turn off (?:the )?microphone|не слушай|выключи микрофон|прекрати слушать)$/i.test(
    commandText(text),
  );
const startupRepair =
  'Speech recognition could not start. Check the selected language and setup-multilingual.cmd.';
const workerStopped = 'The local speech recognizer stopped. Restart the microphone.';
const canAutoSend = (config, capture) =>
  Boolean(config.autoSend && (!capture?.systemAudioReview || capture.systemAudioWake));

/** AEC is primary. This only rejects obvious transcripts of Capri's own output. */
export class EchoGuard {
  constructor({ now = () => performance.now(), tailMs = 1100 } = {}) {
    this.now = now;
    this.tailMs = tailMs;
    this.current = '';
    this.history = [];
  }
  playback({ speaking, text = '' }) {
    if (this.current && (!speaking || this.current !== text))
      this.history.push({ text: this.current, until: this.now() + this.tailMs });
    this.current = speaking ? text : '';
    this.history = this.history.filter((item) => item.until > this.now()).slice(-2);
  }
  matches(text) {
    if (/^(stop|stop capri|wait|no|be quiet|stop listening)$/i.test(commandText(text)))
      return false;
    const heard = words(text);
    if (!heard.length) return false;
    const own = [
      ...this.history.filter((item) => item.until > this.now()).map((item) => item.text),
      this.current,
    ].join(' ');
    const spoken = words(own);
    if (!spoken.length) return false;
    if (` ${spoken.join(' ')} `.includes(` ${heard.join(' ')} `)) return true;
    return (
      heard.length >= 4 &&
      heard.filter((word) => spoken.includes(word)).length / heard.length >= 0.85
    );
  }
}

/** Session generations prevent late PCM/results from reviving a stopped mic. */
export class MicrophoneService {
  constructor({ worker, config, emit, interrupt, submit, now = () => performance.now() }) {
    Object.assign(this, { worker, config, emit, interrupt, submit, now });
    this.echoOptions = {
      now,
      tailMs: Math.max(
        1100,
        (config.trailingSilenceSeconds ?? SPEECH_DEFAULTS.trailingSilenceSeconds) * 1000 + 1500,
      ),
    };
    this.capture = null;
    this.generation = 0;
    this.status = 'off';
    this.recognitionTimings = [];
    this.lastFailure = null;
    this.echo = new EchoGuard(this.echoOptions);
    this.tail = Promise.resolve();
    worker.on('transcript', (event) => this.transcript(event));
    worker.on('reset', (event) => this.recognitionReset(event));
    worker.on('activity', (event) => {
      const capture = this.capture;
      if (
        !capture ||
        event.sessionId !== capture.id ||
        this.status !== 'listening' ||
        event.utterance <= capture.discardedThrough
      )
        return;
      capture.latestUtterance = Math.max(capture.latestUtterance, event.utterance);
      capture.recognitionPhase = event.phase;
      const whisper =
        this.config.language === 'auto' ||
        LANGUAGE_PACKS.find((p) => p.id === this.config.language)?.recognizer === 'whisper';
      if (capture.wake.state === 'command')
        capture.wake.armTimeout(true, event.phase === 'processing' && whisper ? 90000 : 20000);
      this.publish();
      this.emit({ type: 'microphone.activity' });
    });
    worker.on('failure', (error) => {
      if (this.capture) this.recognizerFailed(error, this.status === 'starting');
    });
  }
  snapshot() {
    return {
      status: this.status,
      enabled: Boolean(this.capture),
      modelLoaded: Boolean(this.worker.child),
      sessionId: this.capture?.id ?? null,
      language: this.config.language ?? 'en',
      autoSend: canAutoSend(this.config, this.capture),
      sampleRate: 16000,
      trailingSilenceSeconds:
        this.config.trailingSilenceSeconds ?? SPEECH_DEFAULTS.trailingSilenceSeconds,
      recognitionPhase: this.capture?.recognitionPhase ?? 'idle',
      systemAudioReview: Boolean(this.capture?.systemAudioReview),
      systemAudioWake: Boolean(this.capture?.systemAudioWake),
      ...(this.capture?.systemAudioReview && !this.capture.systemAudioWake
        ? { wakeState: 'disabled', wakePhrase: null }
        : (this.capture?.wake.snapshot() ?? {
            wakeState: this.config.wakeWord?.enabled ? 'waiting' : 'disabled',
            wakePhrase: this.config.wakeWord?.enabled ? 'Capri / Hey, Capri' : null,
          })),
    };
  }
  diagnostics() {
    const rows = this.recognitionTimings;
    return {
      language: this.config.language,
      wakeState: this.capture?.wake.state ?? 'off',
      recognitionPhase: this.capture?.recognitionPhase ?? 'idle',
      samples: rows.length,
      lastRecognitionMs: rows.at(-1)?.recognitionMs ?? null,
      meanRecognitionMs: rows.length
        ? Math.round(rows.reduce((sum, row) => sum + row.recognitionMs, 0) / rows.length)
        : null,
      lastAudioSeconds: rows.at(-1)?.audioSeconds ?? null,
      trailingSilenceSeconds: this.config.trailingSilenceSeconds,
      lastFailure: this.lastFailure,
    };
  }
  publish(extra = {}) {
    this.emit({ type: 'microphone.settings', ...this.snapshot(), ...extra });
  }
  recognitionReset(event) {
    const capture = this.capture;
    if (
      !capture ||
      event.sessionId !== capture.id ||
      this.status !== 'listening' ||
      event.reason !== 'utterance_limit' ||
      !Number.isSafeInteger(event.utterance) ||
      event.utterance < 0 ||
      event.nextUtterance !== event.utterance + 1 ||
      event.utterance < capture.latestUtterance ||
      event.utterance <= capture.discardedThrough
    )
      return;
    capture.discardedThrough = event.utterance;
    capture.latestUtterance = event.utterance;
    capture.recognitionPhase = 'idle';
    capture.followUps = 0;
    capture.wake.rearm(event.utterance, 'utterance-limit');
    if (capture.systemAudioReview && !capture.systemAudioWake)
      this.worker
        .send({ type: 'attention', sessionId: capture.id, active: true })
        .catch((error) => {
          if (this.capture === capture) this.recognizerFailed(error, false);
        });
    this.publish();
    this.emit({
      type: 'microphone.partial',
      sessionId: capture.id,
      text: '',
      final: false,
      utterance: event.utterance,
      autoSend: canAutoSend(this.config, capture),
    });
  }
  async configurePause(seconds) {
    const { trailingSilenceSeconds } = validateSpeechSettings({ trailingSilenceSeconds: seconds });
    this.config.trailingSilenceSeconds = trailingSilenceSeconds;
    this.echoOptions.tailMs = Math.max(1100, trailingSilenceSeconds * 1000 + 1500);
    this.echo.tailMs = this.echoOptions.tailMs;
    const capture = this.capture;
    if (capture) {
      try {
        await this.worker.send({
          type: 'configure',
          sessionId: capture.id,
          trailingSilenceSeconds,
        });
      } catch {
        if (this.capture === capture)
          this.fail('The pause was saved. Enable the microphone again to apply it.');
      }
    }
    this.publish();
  }
  async start() {
    if (this.capture) return { ...this.snapshot(), sessionId: this.capture.id };
    const generation = ++this.generation,
      id = randomUUID();
    const capture = {
      id,
      generation,
      sequence: 0,
      interrupted: new Set(),
      finalized: new Set(),
      waiting: 0,
      latestUtterance: -1,
      discardedThrough: -1,
      recognitionPhase: 'idle',
      inputGeneration: 0,
    };
    capture.wake = new WakePhraseGate(this.config.wakeWord, {
      onWake: (event) => {
        if (this.capture !== capture) return;
        capture.followUps = 0;
        this.worker
          .send({
            type: 'attention',
            sessionId: id,
            active: true,
            ...(Number.isSafeInteger(event.wakeEndSample)
              ? { wakeEndSample: event.wakeEndSample, utterance: event.utterance }
              : {}),
          })
          .catch(() => {});
        this.publish();
        this.emit({ type: 'microphone.wake', sessionId: id, utterance: event.utterance });
        if (
          !capture.systemAudioReview &&
          this.config.bargeIn &&
          !capture.interrupted.has(event.utterance)
        ) {
          capture.interrupted.add(event.utterance);
          this.interrupt();
          this.emit({ type: 'microphone.interrupt' });
        }
      },
      onReady: (event) => this.transcript(event),
      onSleep: (reason) => {
        if (this.capture !== capture) return;
        this.worker.send({ type: 'attention', sessionId: id, active: false }).catch(() => {});
        this.publish();
        if (reason === 'timeout')
          this.emit({
            type: 'microphone.partial',
            sessionId: id,
            text: '',
            final: false,
            utterance: capture.latestUtterance,
            autoSend: canAutoSend(this.config, capture),
          });
      },
    });
    this.capture = capture;
    this.status = 'starting';
    this.publish();
    try {
      await this.worker.send({
        type: 'start',
        sessionId: id,
        attention: !this.config.wakeWord?.enabled,
        trailingSilenceSeconds:
          this.config.trailingSilenceSeconds ?? SPEECH_DEFAULTS.trailingSilenceSeconds,
      });
      if (this.capture?.generation !== generation) throw new Error('Microphone start cancelled');
      this.lastFailure = null;
      this.status = 'arming';
      this.publish();
      return { ...this.snapshot(), sessionId: id };
    } catch (error) {
      if (this.capture?.generation === generation) this.recognizerFailed(error, true);
      throw error;
    }
  }
  confirm(id) {
    if (this.capture?.id !== id || this.status !== 'arming') throw new Error('Inactive microphone');
    this.status = 'listening';
    this.publish();
    return this.snapshot();
  }
  enableSystemAudioReview(id, wake = false) {
    const capture = this.capture;
    if (!capture || capture.id !== id || this.status !== 'listening') return false;
    // Keep the mixed-input policy for its late recognition tail. Changing
    // that policy also revokes submissions queued under the previous mode.
    capture.inputGeneration++;
    capture.systemAudioReview = true;
    capture.systemAudioWake = wake === true;
    capture.followUps = 0;
    capture.wake.close();
    if (capture.systemAudioWake) {
      capture.wake.enabled = true;
      capture.wake.rearm(capture.latestUtterance, 'mixed-audio');
    } else {
      this.worker.send({ type: 'attention', sessionId: id, active: true }).catch(() => {});
    }
    this.publish();
    return true;
  }
  stop(id) {
    if (id && id !== this.capture?.id) return false;
    const stoppedSessionId = this.capture?.id ?? null;
    this.capture?.wake.close();
    this.capture = null;
    this.generation++;
    this.status = 'off';
    this.echo = new EchoGuard(this.echoOptions);
    this.publish({ stoppedSessionId });
    if (stoppedSessionId && (this.worker.child || this.worker.ready))
      this.worker.send({ type: 'stop', sessionId: stoppedSessionId }).catch(() => {});
    return true;
  }
  fail(message) {
    this.stop();
    this.emit({ type: 'microphone.error', message });
  }
  recognizerFailed(error, startup) {
    const code = /^ASR_(?:START|WORKER)_[A-Z_]{1,40}$/.test(error?.code ?? '')
      ? error.code
      : startup
        ? 'ASR_START_SESSION'
        : 'ASR_WORKER_EXIT';
    const message = startup ? startupRepair : workerStopped;
    this.lastFailure = {
      at: new Date().toISOString(),
      code,
      message,
      ...(startup && code.startsWith('ASR_START_') && asrStartupStage(error?.startupStage)
        ? { startupStage: error.startupStage }
        : {}),
    };
    this.fail(message);
  }
  async audio(value) {
    const capture = this.capture;
    if (!capture || value?.sessionId !== capture.id || this.status !== 'listening')
      // Stop/language changes can race an already queued renderer packet.
      // Reject it quietly; it must neither reach ASR nor fault a newer capture.
      return { accepted: false };
    if (
      !Number.isSafeInteger(value.sequence) ||
      value.sequence !== capture.sequence ||
      !(value.pcm instanceof Uint8Array) ||
      !value.pcm.byteLength ||
      value.pcm.byteLength > 12800 ||
      value.pcm.byteLength % 4 ||
      capture.waiting >= 2
    ) {
      this.fail('Microphone audio could not be delivered reliably. Restart the microphone.');
      throw new Error('Invalid microphone packet');
    }
    capture.sequence++;
    capture.waiting++;
    try {
      await this.worker.send({
        type: 'pcm',
        sessionId: capture.id,
        pcm: Buffer.from(value.pcm).toString('base64'),
      });
    } catch (error) {
      if (this.capture !== capture) return { accepted: false };
      this.lastFailure = {
        at: new Date().toISOString(),
        code: error.code ?? 'ASR_TRANSPORT',
        message: String(error.message).slice(0, 300),
      };
      this.fail(
        error.code ? error.message : 'Recognition could not keep up. Restart the microphone.',
      );
      throw error;
    } finally {
      capture.waiting--;
    }
    return { accepted: this.capture === capture };
  }
  playback(value) {
    if (value?.sessionId !== this.capture?.id) return false;
    if (
      typeof value.speaking !== 'boolean' ||
      typeof value.text !== 'string' ||
      value.text.length > MAX_SPEECH_SENTENCE
    )
      throw new Error('Invalid playback state');
    this.echo.playback(value);
    return true;
  }
  transcript(event) {
    const capture = this.capture;
    if (
      !capture ||
      event.sessionId !== capture.id ||
      this.status !== 'listening' ||
      event.utterance <= capture.discardedThrough
    )
      return;
    // The only nonfinal text is an internal wake probe from the same Parakeet.
    // No provisional words may enter either the UI or the conversation.
    if (!event.final && !event.wakeOnly) return;
    let text = event.text.trim();
    const echo = this.echo.matches(text);
    if (echo) capture.wake.cancelCandidate();
    if (capture.finalized.has(event.utterance)) return;
    if (event.final) {
      if (
        Number.isFinite(event.recognitionMs) &&
        event.recognitionMs >= 0 &&
        event.recognitionMs <= 600000 &&
        Number.isFinite(event.audioSeconds) &&
        event.audioSeconds >= 0 &&
        event.audioSeconds <= 60
      ) {
        this.recognitionTimings.push({
          recognitionMs: event.recognitionMs,
          audioSeconds: event.audioSeconds,
        });
        if (this.recognitionTimings.length > 20) this.recognitionTimings.shift();
      }
      capture.recognitionPhase = 'idle';
      this.publish();
    }
    capture.latestUtterance = Math.max(capture.latestUtterance, event.utterance);
    if (capture.systemAudioReview && !capture.systemAudioWake) {
      if (event.final) {
        capture.finalized.add(event.utterance);
        while (capture.finalized.size > 64)
          capture.finalized.delete(capture.finalized.values().next().value);
        if (text && !echo) {
          this.emit({ type: 'microphone.activity' });
          this.emit({
            type: 'microphone.partial',
            sessionId: capture.id,
            text,
            final: true,
            utterance: event.utterance,
            autoSend: false,
          });
        }
      }
      return;
    }
    if (!capture.systemAudioReview && event.final && !echo && microphoneOff(text)) {
      this.stop(capture.id);
      this.emit({ type: 'microphone.stop-request' });
      return;
    }
    if (!echo && text) this.emit({ type: 'microphone.activity' });
    // Unaddressed speech never reaches preview, interruption, or the chat queue.
    const attention =
      !echo && (capture.wake.state !== 'waiting' || event.utterance === capture.latestUtterance)
        ? capture.wake.observe(event)
        : { accepted: false };
    if (!attention.accepted) {
      if (event.final && !attention.pending) capture.finalized.add(event.utterance);
      while (capture.finalized.size > 64)
        capture.finalized.delete(capture.finalized.values().next().value);
      return;
    }
    text = attention.text;
    if (event.wakeOnly) return;
    if (
      !capture.systemAudioReview &&
      this.config.bargeIn &&
      !echo &&
      interruption(text) &&
      !capture.interrupted.has(event.utterance)
    ) {
      capture.interrupted.add(event.utterance);
      this.interrupt();
      this.emit({ type: 'microphone.interrupt' });
    }
    if (!event.final || capture.finalized.has(event.utterance)) return;
    capture.finalized.add(event.utterance);
    while (capture.finalized.size > 64)
      capture.finalized.delete(capture.finalized.values().next().value);
    while (capture.interrupted.size > 64)
      capture.interrupted.delete(capture.interrupted.values().next().value);
    if (echo) return;
    this.emit({
      type: 'microphone.partial',
      sessionId: capture.id,
      text,
      final: true,
      utterance: event.utterance,
      autoSend: canAutoSend(this.config, capture),
    });
    if (!text) return;
    if (capture.systemAudioReview) {
      capture.wake.rearm(event.utterance);
      if (!capture.systemAudioWake) return;
    } else {
      const local = commandText(text);
      if (microphoneOff(local)) {
        this.stop(capture.id);
        this.emit({ type: 'microphone.stop-request' });
        return;
      }
      if (
        /^(stop|stop capri|stop talking|be quiet|quiet capri|стоп|хватит|замолчи)$/i.test(local)
      ) {
        capture.wake.rearm(event.utterance);
        this.emit({ type: 'microphone.sent', localCommand: true });
        return;
      }
      capture.wake.rearm(event.utterance);
    }
    if (!canAutoSend(this.config, capture)) return;
    capture.followUps = 0;
    const inputGeneration = capture.inputGeneration;
    const current = () =>
      this.capture === capture &&
      capture.inputGeneration === inputGeneration &&
      canAutoSend(this.config, capture);
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        if (!current()) return;
        await this.submit({ id: randomUUID(), text }, current);
        if (current()) this.emit({ type: 'microphone.sent', utterance: event.utterance });
      })
      .catch(() => {
        if (current())
          this.fail('The spoken phrase could not be sent. Its text is shown above the input.');
      });
  }
  close() {
    this.capture?.wake.close();
    this.capture = null;
    this.generation++;
    this.status = 'off';
    this.worker.close();
  }
  continueListening(milliseconds, sessionId) {
    const capture = this.capture;
    if (
      !capture ||
      capture.id !== sessionId ||
      this.status !== 'listening' ||
      capture.systemAudioReview ||
      (capture.followUps ?? 0) >= 3 ||
      !capture.wake.continueListening(milliseconds)
    )
      return false;
    capture.followUps = (capture.followUps ?? 0) + 1;
    this.worker.send({ type: 'attention', sessionId: capture.id, active: true }).catch(() => {});
    this.publish();
    this.emit({ type: 'microphone.wake', sessionId: capture.id, followUp: true });
    return true;
  }
  cancelContinuation() {
    const capture = this.capture;
    if (!capture?.followUps) return;
    capture.wake.rearm(capture.latestUtterance, 'typed-input');
    capture.followUps = 0;
  }
  listenNow() {
    const capture = this.capture;
    if (!capture || this.status !== 'listening' || capture.systemAudioReview) return false;
    if (capture.wake.enabled && capture.wake.state === 'command') {
      capture.wake.rearm(capture.latestUtterance, 'manual');
      return true;
    }
    capture.followUps = 0;
    if (capture.wake.enabled && !capture.wake.continueListening(30000)) return false;
    this.worker.send({ type: 'attention', sessionId: capture.id, active: true }).catch(() => {});
    this.publish();
    this.emit({ type: 'microphone.wake', sessionId: capture.id, manual: true });
    return true;
  }
}

export function audioPermission({
  armed,
  listingDevices = false,
  owner,
  contents,
  permission,
  origin,
  details,
  request = false,
}) {
  if (
    (!armed && (!listingDevices || request)) ||
    !owner ||
    contents !== owner ||
    permission !== 'media'
  )
    return false;
  if (owner.getURL() !== 'capri://desktop/index.html' || details?.isMainFrame === false)
    return false;
  if (origin && origin !== 'capri://desktop' && origin !== 'capri://desktop/') return false;
  if (details?.requestingUrl && details.requestingUrl !== 'capri://desktop/index.html')
    return false;
  return request
    ? Array.isArray(details?.mediaTypes) &&
        details.mediaTypes.length === 1 &&
        details.mediaTypes[0] === 'audio'
    : details?.mediaType === 'audio';
}
