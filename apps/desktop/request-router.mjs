import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const normal = (reason) => ({ mode: 'normal', reason });

/** Optional prewarmed CPU worker. Failure always preserves the ordinary request. */
export class RequestRouter {
  constructor({ root, spawnImpl = spawn, exists = existsSync, config } = {}) {
    Object.assign(this, { root, spawnImpl, exists });
    try {
      config ??= JSON.parse(readFileSync(path.join(root, 'config/request-router.json'), 'utf8'));
      if (
        config.schemaVersion !== 1 ||
        typeof config.enabled !== 'boolean' ||
        !Number.isInteger(config.timeoutMs) ||
        config.timeoutMs < 25 ||
        config.timeoutMs > 250
      )
        throw new Error('Invalid router settings');
      this.config = config;
    } catch {
      this.config = { enabled: false };
    }
    this.child = null;
    this.pending = new Map();
    this.sequence = 0;
    this.isReady = false;
    this.closed = false;
    this.failed = false;
  }

  start() {
    if (this.closed || this.failed || !this.config.enabled) return Promise.resolve(false);
    if (this.startPromise) return this.startPromise;
    const python = path.join(this.root, '.runtime/router-venv/Scripts/python.exe');
    if (!this.exists(python)) return Promise.resolve(false);
    this.startPromise = new Promise((resolve) => {
      this.resolveStart = resolve;
    });
    const env = Object.fromEntries(
      ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
        .filter((name) => process.env[name])
        .map((name) => [name, process.env[name]]),
    );
    Object.assign(env, {
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      TOKENIZERS_PARALLELISM: 'false',
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      OMP_NUM_THREADS: '4',
    });
    let child,
      buffer = '';
    try {
      child = this.child = this.spawnImpl(
        python,
        ['-u', '-m', 'integrations.request_router.worker'],
        { cwd: this.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch {
      this.fail('unavailable');
      return this.startPromise;
    }
    // Cold Windows imports can share disk/CPU with ASR and voice preparation.
    // This background allowance never adds time to a foreground classification.
    this.startTimer = setTimeout(() => this.fail('startup-timeout'), 15000);
    child.on('error', () => this.fail('unavailable'));
    child.on('exit', () => {
      if (this.child === child) this.fail('unavailable');
    });
    child.stdin.on('error', () => this.fail('unavailable'));
    child.stderr.on('data', () => {}); // Never forward speech, paths or dependency diagnostics.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 8192) {
        this.fail('invalid-result');
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
          this.fail('invalid-result');
          return;
        }
        if (
          event.type === 'ready' &&
          !this.isReady &&
          event.protocol === 1 &&
          event.provider === 'cpu'
        ) {
          clearTimeout(this.startTimer);
          this.isReady = true;
          this.resolveStart?.(true);
          this.resolveStart = null;
        } else if (
          event.type === 'result' &&
          this.isReady &&
          Number.isSafeInteger(event.request) &&
          event.request > 0 &&
          ['fast', 'normal'].includes(event.mode) &&
          typeof event.reason === 'string' &&
          event.reason.length <= 40 &&
          Number.isFinite(event.elapsedMs) &&
          event.elapsedMs >= 0
        ) {
          this.pending
            .get(event.request)
            ?.finish({ mode: event.mode, reason: event.reason, classificationMs: event.elapsedMs });
        } else {
          this.fail('invalid-result');
          return;
        }
      }
    });
    return this.startPromise;
  }

  async classify(text, { context = [], signal } = {}) {
    signal?.throwIfAborted();
    if (!this.isReady || this.closed || !this.child || this.pending.size)
      return normal('not-ready');
    if (typeof text !== 'string' || !text.trim() || text.length > 8000)
      return normal('input-scope');
    const request = ++this.sequence,
      child = this.child;
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(request);
      };
      this.pending.set(request, {
        finish: (result) => {
          cleanup();
          resolve(result);
        },
      });
      timer = setTimeout(() => this.fail('timeout'), this.config.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      child.stdin.write(
        JSON.stringify({
          request,
          text,
          context: context
            .filter((item) => typeof item === 'string')
            .slice(-2)
            .map((item) => item.slice(0, 400)),
        }) + '\n',
        (error) => {
          if (error && this.child === child) this.fail('unavailable');
        },
      );
    });
  }

  fail(reason) {
    this.isReady = false;
    this.failed = true;
    clearTimeout(this.startTimer);
    this.resolveStart?.(false);
    this.resolveStart = null;
    const child = this.child;
    this.child = null;
    for (const pending of [...this.pending.values()]) pending.finish(normal(reason));
    if (child) {
      child.stdin.destroy();
      child.kill();
    }
  }

  close() {
    this.closed = true;
    this.fail('closed');
  }
  pause() {
    if (this.closed) return;
    this.fail('paused');
    this.failed = false;
    this.startPromise = null;
  }
}
