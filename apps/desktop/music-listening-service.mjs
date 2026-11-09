// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prepareMusicDetector, musicPython } from './music-detector-provision.mjs';
import { MUSIC_TEMPO_MIN_CONFIDENCE } from './music-listening-settings.mjs';

export class MusicDecision {
  constructor() {
    this.reset();
  }
  reset() {
    this.hearingMusic = false;
    this.enter = 0;
    this.exit = 0;
    this.energy = 0;
    this.music = 0;
    this.speech = 0;
    this.resetTempo();
  }
  resetTempo() {
    this.tempo = 0;
    this.tempoConfidence = 0;
    this.beatAt = 0;
    this.pendingTempo = null;
  }
  update(value, capturedAt = Date.now()) {
    if (
      ![value.music, value.speech, value.rms].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
    )
      throw Error('Invalid music classification.');
    const tempo = value.tempo ?? 0,
      confidence = value.tempoConfidence ?? 0,
      phase = value.beatPhase ?? 0;
    if (
      !Number.isFinite(tempo) ||
      (tempo !== 0 && (tempo < 40 || tempo > 240)) ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      !Number.isFinite(phase) ||
      phase < 0 ||
      phase >= 1 ||
      (tempo === 0 && (confidence !== 0 || phase !== 0))
    )
      throw Error('Invalid music tempo.');
    this.music = value.music;
    this.speech = value.speech;
    this.energy = Math.min(1, value.rms * 6);
    this.enter = value.music >= 0.6 && value.rms >= 0.0003 ? this.enter + 1 : 0;
    this.exit = value.music < 0.28 || value.rms < 0.0003 ? this.exit + 1 : 0;
    if (!this.hearingMusic && this.enter >= 3) this.hearingMusic = true;
    else if (this.hearingMusic && this.exit >= 3) this.hearingMusic = false;
    const beat =
      tempo && confidence >= MUSIC_TEMPO_MIN_CONFIDENCE
        ? {
            tempo,
            tempoConfidence: confidence,
            beatAt: Math.max(0, capturedAt - (phase * 60000) / tempo),
          }
        : null;
    // Keep a reliable prewarmed beat during the three-window music decision.
    // It stays private until the music gate agrees; a rejected candidate clears it.
    if (!this.hearingMusic) {
      const pending = this.enter > 0 ? (beat ?? this.pendingTempo) : null;
      this.resetTempo();
      this.pendingTempo = pending;
    } else {
      const available = beat ?? this.pendingTempo;
      this.pendingTempo = null;
      if (available) Object.assign(this, available);
    }
    return this.hearingMusic;
  }
}

/** Independent CPU classifier. PCM is ephemeral private stdio, never ASR/API/logs. */
export class MusicListeningService {
  constructor({
    root,
    settings,
    emit = () => {},
    available = () => true,
    prepare = prepareMusicDetector,
    spawnImpl = spawn,
    now = Date.now,
    staleMs = 5000,
  }) {
    Object.assign(this, { root, settings, emit, available, prepare, spawnImpl, now, staleMs });
    this.session = null;
    this.decision = new MusicDecision();
    this.phase = 'off';
    this.error = null;
  }
  snapshot() {
    return {
      phase: this.phase,
      enabled: Boolean(this.session),
      supported: process.platform === 'win32' && Boolean(musicPython(this.root)),
      hearingMusic: this.decision.hearingMusic && this.settings().enabled,
      energy: this.decision.energy,
      musicScore: this.decision.music,
      speechScore: this.decision.speech,
      tempo: this.settings().enabled ? this.decision.tempo : 0,
      tempoConfidence: this.settings().enabled ? this.decision.tempoConfidence : 0,
      beatAt: this.settings().enabled ? this.decision.beatAt : 0,
      settings: { ...this.settings() },
      ...(this.progress ? { progress: this.progress } : {}),
      error: this.error,
    };
  }
  publish(extra = {}) {
    const value = { ...this.snapshot(), ...extra };
    this.emit({ type: 'music.status', ...value });
    return value;
  }
  start() {
    if (!this.available()) throw Error('Music listening could not start. Try again from Settings.');
    if (this.session) return { sessionId: this.session.id, sampleRate: 16000 };
    const session = (this.session = {
      id: randomUUID(),
      sequence: -1,
      lastResultSequence: -1,
      tempoStartSequence: 0,
      controller: new AbortController(),
      ready: false,
      capture: false,
      submitted: new Map(),
    });
    this.decision.reset();
    this.error = null;
    this.progress = null;
    this.phase = 'preparing';
    this.publish();
    void this.initialize(session);
    return { sessionId: session.id, sampleRate: 16000 };
  }
  async initialize(session) {
    try {
      const result = await this.prepare(this.root, {
        signal: session.controller.signal,
        progress: (value) => {
          if (this.session !== session) return;
          this.progress = { received: value.received, total: value.total };
          this.publish();
        },
      });
      if (this.session !== session || session.controller.signal.aborted) return;
      const env = Object.fromEntries(
        ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']
          .filter((key) => process.env[key])
          .map((key) => [key, process.env[key]]),
      );
      Object.assign(env, {
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        OMP_NUM_THREADS: '1',
        OPENBLAS_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
      });
      const child = (session.child = this.spawnImpl(
        result.python,
        ['-u', '-m', 'integrations.music_runtime.worker', '--model-dir', result.folder],
        { cwd: this.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      ));
      let pending = '';
      const failed = () => {
        if (this.session === session) this.fail();
      };
      child.on('error', failed);
      child.on('exit', failed);
      child.stdin.on('error', failed);
      child.stderr.on('data', () => {});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (this.session !== session) return;
        pending += chunk;
        if (pending.length > 16384) return failed();
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          try {
            this.result(session, JSON.parse(line));
          } catch {
            failed();
            return;
          }
        }
      });
      session.startTimer = setTimeout(failed, 20000);
      session.startTimer.unref?.();
    } catch {
      if (this.session === session && !session.controller.signal.aborted) this.fail();
    }
  }
  result(session, value) {
    if (this.session !== session) return;
    if (value.type === 'ready') {
      clearTimeout(session.startTimer);
      session.ready = true;
      this.progress = null;
      this.phase = session.capture ? 'listening' : 'starting';
      this.publish();
      return;
    }
    if (
      value.type !== 'classification' ||
      !session.ready ||
      !session.capture ||
      value.sessionId !== session.id ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      value.sequence <= session.lastResultSequence ||
      value.sequence > session.sequence ||
      !session.submitted.has(value.sequence)
    )
      throw Error('Invalid music result.');
    session.lastResultSequence = value.sequence;
    const capturedAt = session.submitted.get(value.sequence);
    for (const sequence of session.submitted.keys())
      if (sequence <= value.sequence) session.submitted.delete(sequence);
    if (this.now() - capturedAt > this.staleMs) {
      this.decision.reset();
      this.publish();
      return;
    }
    this.decision.update(value, capturedAt);
    if (value.sequence < session.tempoStartSequence) this.decision.resetTempo();
    clearTimeout(session.staleTimer);
    session.staleTimer = setTimeout(
      () => {
        if (this.session !== session) return;
        this.decision.reset();
        this.publish();
      },
      Math.max(0, this.staleMs - (this.now() - capturedAt)),
    );
    session.staleTimer.unref?.();
    this.phase = 'listening';
    this.publish();
  }
  ready(id) {
    const session = this.session;
    if (!session || session.id !== id || !this.available()) return false;
    session.capture = true;
    this.phase = session.ready ? 'listening' : 'preparing';
    this.publish();
    return true;
  }
  packet(value) {
    const session = this.session;
    if (!session || value?.sessionId !== session.id) return { accepted: false, stop: true };
    if (!this.available()) {
      this.stop();
      return { accepted: false, stop: true };
    }
    if (
      !value ||
      Object.keys(value).some(
        (key) => !['sessionId', 'sequence', 'pcm', 'capturedAt'].includes(key),
      ) ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence <= session.sequence ||
      !ArrayBuffer.isView(value.pcm) ||
      value.pcm.byteLength !== 32000 ||
      (value.capturedAt !== undefined &&
        (!Number.isFinite(value.capturedAt) || value.capturedAt < 0))
    )
      throw Error('Invalid music audio packet.');
    const gap = value.sequence !== session.sequence + 1;
    session.sequence = value.sequence;
    if (gap) {
      session.tempoStartSequence = value.sequence;
      this.decision.resetTempo();
      this.publish();
    }
    const capturedAt = value.capturedAt ?? this.now();
    if (capturedAt < this.now() - this.staleMs || capturedAt > this.now() + 1000) {
      session.tempoStartSequence = value.sequence + 1;
      this.decision.resetTempo();
      return { accepted: false };
    }
    if (
      !session.capture ||
      !session.ready ||
      !session.child?.stdin?.writable ||
      session.child.stdin.writableLength > 128 * 1024
    ) {
      session.tempoStartSequence = value.sequence + 1;
      this.decision.resetTempo();
      return { accepted: false };
    }
    const pcm = Buffer.from(value.pcm.buffer, value.pcm.byteOffset, value.pcm.byteLength);
    session.submitted.set(value.sequence, capturedAt);
    while (session.submitted.size > 64)
      session.submitted.delete(session.submitted.keys().next().value);
    session.child.stdin.write(
      JSON.stringify({
        type: 'audio',
        sessionId: session.id,
        sequence: value.sequence,
        pcm: pcm.toString('base64'),
      }) + '\n',
    );
    return { accepted: true };
  }
  fail() {
    this.stop();
    this.phase = 'error';
    this.error = 'Music listening stopped. Enable it again to retry.';
    this.publish();
  }
  stop(id = this.session?.id) {
    const session = this.session;
    if (!session || session.id !== id) return this.snapshot();
    this.session = null;
    session.controller.abort();
    clearTimeout(session.startTimer);
    clearTimeout(session.staleTimer);
    session.submitted.clear();
    session.child?.stdin.destroy();
    session.child?.kill();
    this.decision.reset();
    this.phase = 'off';
    this.progress = null;
    this.error = null;
    return this.publish({ stoppedSessionId: session.id });
  }
}
