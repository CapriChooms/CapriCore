import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LANGUAGE_PACKS } from './renderer/language-settings.mjs';

const reportedStartupCodes = new Set([
  'ASR_START_DEPENDENCIES',
  'ASR_START_CONFIG',
  'ASR_START_DETECTOR',
  'ASR_START_MODEL',
]);
export const asrStartupStage = (value) => (reportedStartupCodes.has(value) ? value : undefined);
const nativeStartupCodes = new Map([
  [0xc000001d, 'ASR_START_NATIVE_INSTRUCTION'],
  [0xc0000005, 'ASR_START_NATIVE_CRASH'],
  [0xc0000017, 'ASR_START_NO_MEMORY'],
  [0xc0000135, 'ASR_START_NATIVE_DLL'],
  [0xc0000139, 'ASR_START_NATIVE_DLL'],
  [0xc0000142, 'ASR_START_NATIVE_DLL'],
]);
const workerStopped = 'The local speech recognizer stopped. Restart the microphone.';
const startupRepair =
  'Speech recognition could not start. Check the selected language and setup-multilingual.cmd.';
const canRecoverStartup = (error) =>
  error.code === 'ASR_START_NATIVE_CRASH' && error.startupStage === 'ASR_START_MODEL';

const asrError = (code, startupStage) =>
  Object.assign(
    new Error(
      code === 'ASR_START_TIMEOUT'
        ? 'Recognition worker startup timed out'
        : code.startsWith('ASR_START_')
          ? startupRepair
          : workerStopped,
    ),
    {
      code,
      ...(code.startsWith('ASR_START_') && asrStartupStage(startupStage) ? { startupStage } : {}),
    },
  );

/** An owned CPU worker over private stdio, never a renderer-accessible server. */
export class ASRWorker extends EventEmitter {
  constructor({ root, spawnImpl = spawn, language = 'en' }) {
    super();
    Object.assign(this, { root, spawnImpl, language });
    this.child = null;
    this.pending = new Map();
    this.requestId = 0;
    this.ready = null;
    this.startupGeneration = 0;
    this.startupTask = null;
  }
  async start() {
    if (this.startupTask) return this.startupTask;
    if (this.ready) return this.ready;
    const generation = this.startupGeneration;
    const task = (async () => {
      try {
        return await this.startAttempt();
      } catch (error) {
        if (generation !== this.startupGeneration || !canRecoverStartup(error)) throw error;
        this.emit('recovery', { code: error.code, startupStage: error.startupStage });
        // Only retry a confirmed native model-load crash, once, in a fresh process.
        if (generation !== this.startupGeneration) throw error;
        return this.startAttempt(true);
      }
    })();
    this.startupTask = task;
    try {
      return await task;
    } finally {
      if (this.startupTask === task) this.startupTask = null;
    }
  }
  async startAttempt(safeStartup = false) {
    if (this.ready) return this.ready;
    const python = path.join(this.root, '.runtime/asr-venv/Scripts/python.exe');
    if (!existsSync(python)) throw asrError('ASR_START_PYTHON');
    const env = Object.fromEntries(
      ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
        .filter((name) => process.env[name])
        .map((name) => [name, process.env[name]]),
    );
    Object.assign(env, {
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONNOUSERSITE: '1',
      OMP_NUM_THREADS: safeStartup ? '1' : '4',
      ...(safeStartup && { CAPRI_ASR_SAFE_STARTUP: '1', CAPRI_CPU_THREADS: '1' }),
    });
    if (
      !['auto', 'auto-europe'].includes(this.language) &&
      !LANGUAGE_PACKS.some((p) => p.id === this.language)
    )
      throw asrError('ASR_START_CONFIG');
    Object.assign(env, { HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' });
    env.CAPRI_ASR_LANGUAGE = this.language;
    const child = (this.child = this.spawnImpl(
      python,
      ['-u', '-m', 'integrations.asr_runtime.worker'],
      { cwd: this.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    ));
    let readyResolve,
      readyReject,
      startupStage,
      buffer = '';
    this.ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    this.rejectStart = readyReject;
    const timer = setTimeout(() => fail('ASR_START_TIMEOUT'), 60000);
    this.startTimer = timer;
    const fail = (code = this.rejectStart ? 'ASR_START_PROTOCOL' : 'ASR_WORKER_PROTOCOL') => {
      if (this.child !== child) return;
      const starting = Boolean(this.rejectStart);
      clearTimeout(timer);
      this.child = null;
      this.ready = null;
      this.rejectStart = null;
      child.kill();
      const error = asrError(code, starting ? startupStage : undefined);
      readyReject(error);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      if (safeStartup || !canRecoverStartup(error)) this.emit('failure', error);
    };
    child.on('error', () => fail(this.rejectStart ? 'ASR_START_SPAWN' : 'ASR_WORKER_IO'));
    // Wait for stdout to close so a startup-error record can arrive before the exit status.
    child.on('close', (status) =>
      fail(
        this.rejectStart
          ? (nativeStartupCodes.get(status >>> 0) ?? 'ASR_START_EXIT')
          : 'ASR_WORKER_EXIT',
      ),
    );
    child.stdin.on('error', () => fail(this.rejectStart ? 'ASR_START_IO' : 'ASR_WORKER_IO'));
    child.stderr.on('data', () => {}); // Diagnostics must never echo captured speech.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 65536) {
        fail();
        child.kill();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          fail();
          child.kill();
          return;
        }
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          fail();
          return;
        }
        if (event.type === 'startup-stage') {
          if (
            !this.rejectStart ||
            !asrStartupStage(event.code) ||
            Object.keys(event).some((key) => !['type', 'code'].includes(key))
          ) {
            fail();
            return;
          }
          startupStage = event.code;
        } else if (event.type === 'startup-error') {
          fail(this.rejectStart && reportedStartupCodes.has(event.code) ? event.code : undefined);
          return;
        } else if (event.type === 'ready') {
          if (
            event.protocol !== 1 ||
            event.language !== this.language ||
            event.sampleRate !== 16000 ||
            event.provider !== 'cpu' ||
            event.mode !== 'utterance' ||
            event.draft !== false
          ) {
            fail();
            child.kill();
            return;
          }
          clearTimeout(timer);
          this.rejectStart = null;
          startupStage = undefined;
          readyResolve(event);
        } else if (event.type === 'transcript') {
          if (
            typeof event.text !== 'string' ||
            event.text.length > 4096 ||
            event.final !== true ||
            !Number.isSafeInteger(event.utterance) ||
            event.utterance < 0
          ) {
            fail();
            child.kill();
            return;
          }
          this.emit('transcript', event);
        } else if (event.type === 'wake-candidate') {
          if (
            typeof event.sessionId !== 'string' ||
            typeof event.text !== 'string' ||
            event.text.length > 4096 ||
            !Number.isSafeInteger(event.utterance) ||
            event.utterance < 0
          ) {
            fail();
            return;
          }
          if (
            !Array.isArray(event.boundaries) ||
            event.boundaries.length > 64 ||
            event.boundaries.some(
              (w) =>
                !Number.isInteger(w.start) ||
                !Number.isInteger(w.end) ||
                w.start < 0 ||
                w.end <= w.start ||
                w.end > event.text.length ||
                !Number.isSafeInteger(w.startSample) ||
                !Number.isSafeInteger(w.endSample) ||
                w.startSample < 0 ||
                w.endSample <= 0 ||
                w.startSample > w.endSample,
            )
          ) {
            fail();
            return;
          }
          this.emit('transcript', { ...event, final: false, wakeOnly: true });
        } else if (event.type === 'recognition-reset') {
          if (
            Object.keys(event).some(
              (key) => !['type', 'sessionId', 'utterance', 'nextUtterance', 'reason'].includes(key),
            ) ||
            typeof event.sessionId !== 'string' ||
            !event.sessionId ||
            event.sessionId.length > 80 ||
            !Number.isSafeInteger(event.utterance) ||
            event.utterance < 0 ||
            !Number.isSafeInteger(event.nextUtterance) ||
            event.nextUtterance !== event.utterance + 1 ||
            event.reason !== 'utterance_limit'
          ) {
            fail();
            return;
          }
          this.emit('reset', event);
        } else if (event.type === 'recognition-state') {
          if (
            typeof event.sessionId !== 'string' ||
            !['speech', 'processing'].includes(event.phase) ||
            !Number.isSafeInteger(event.utterance) ||
            event.utterance < 0
          ) {
            fail();
            return;
          }
          this.emit('activity', event);
        } else if (event.type === 'recognition-error') {
          fail();
          return;
        } else if (event.type === 'ack' || event.type === 'error') {
          const pending = this.pending.get(event.request);
          if (pending) {
            this.pending.delete(event.request);
            clearTimeout(pending.timer);
            event.type === 'ack'
              ? pending.resolve()
              : pending.reject(
                  Object.assign(
                    new Error(
                      {
                        ASR_QUEUE_FULL:
                          'Speech recognition is busy. Wait a moment, then restart the microphone.',
                        ASR_UTTERANCE_LIMIT:
                          'The spoken phrase is too long. Restart the microphone and use a shorter phrase.',
                        ASR_INACTIVE_SESSION:
                          'The microphone session changed. Restart the microphone.',
                      }[event.code] ?? 'Recognition rejected an audio packet',
                    ),
                    {
                      code: /^ASR_[A-Z_]{1,40}$/.test(event.code ?? '')
                        ? event.code
                        : 'ASR_PACKET_REJECTED',
                    },
                  ),
                );
          }
        } else {
          fail();
          child.kill();
          return;
        }
      }
    });
    return this.ready;
  }
  async send(command) {
    await this.start();
    if (!this.child || this.pending.size >= 4)
      throw new Error('The speech recognizer cannot keep up with audio input.');
    const request = ++this.requestId,
      child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request);
        reject(new Error('Recognition timed out'));
        this.close();
      }, 15000);
      this.pending.set(request, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ ...command, request }) + '\n', (error) => {
        if (error && this.pending.has(request)) {
          this.pending.delete(request);
          clearTimeout(timer);
          reject(new Error('Recognition worker disconnected'));
        }
      });
    });
  }
  close() {
    this.startupGeneration++;
    this.startupTask = null;
    clearTimeout(this.startTimer);
    this.rejectStart?.(new Error('Recognition closed'));
    this.rejectStart = null;
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child) {
      child.stdin.destroy();
      child.kill();
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Recognition closed'));
    }
    this.pending.clear();
  }
}
