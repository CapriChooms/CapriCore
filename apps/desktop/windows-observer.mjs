import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateObservation } from './initiative-policy.mjs';

export class WindowsObserver extends EventEmitter {
  constructor({ root, verification = false } = {}) {
    super();
    Object.assign(this, { root, verification });
    this.status = 'off';
    this.generation = 0;
    this.lastFailure = null;
  }
  snapshot() {
    return {
      status: this.status,
      active: this.status === 'active',
      capturesImages: false,
      capturesTitles: false,
      lastFailure: this.lastFailure,
    };
  }
  publish(status) {
    this.status = status;
    this.emit('status', this.snapshot());
  }
  start({ ignoredProcessIds = [process.pid], filterProcessId = 0 } = {}) {
    if (this.child) return this.starting;
    if (filterProcessId && !this.verification)
      throw new Error('Process filtering is for owned verification fixtures only');
    if (
      !Array.isArray(ignoredProcessIds) ||
      ignoredProcessIds.length > 10 ||
      !ignoredProcessIds.every((n) => Number.isInteger(n) && n > 0) ||
      !Number.isInteger(filterProcessId) ||
      filterProcessId < 0
    )
      throw new Error('Invalid observer startup');
    const hash = (value) => createHash('sha256').update(value).digest('hex'),
      directory = path.join(this.root, '.runtime/awareness');
    const build = JSON.parse(readFileSync(path.join(directory, 'build.json'), 'utf8'));
    if (
      !/^[a-f0-9]{16}[\\/]Capri\.WindowsEvents\.exe$/.test(build.artifact) ||
      build.sourceSha256 !==
        hash(readFileSync(path.join(this.root, 'integrations/awareness/native/WindowsEvents.cs')))
    )
      throw new Error('Windows observer needs rebuilding');
    const executable = path.join(directory, build.artifact);
    if (hash(readFileSync(executable)) !== build.executableSha256)
      throw new Error('Windows observer integrity check failed');
    const generation = ++this.generation,
      windows = process.env.SystemRoot ?? 'C:\\Windows';
    this.publish('starting');
    const child = spawn(executable, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        SystemRoot: windows,
        WINDIR: windows,
        PATH: path.join(windows, 'System32'),
        TEMP: path.join(this.root, '.runtime/tmp'),
        TMP: path.join(this.root, '.runtime/tmp'),
      },
    });
    this.child = child;
    this.starting = new Promise((resolve, reject) => {
      let pending = '',
        ready = false;
      this.rejectStartup = reject;
      const timer = setTimeout(
        () => failure(new Error('Windows observer startup timed out')),
        15000,
      );
      this.startTimer = timer;
      const failure = (error) => {
        clearTimeout(timer);
        if (generation !== this.generation) return;
        this.lastFailure = {
          at: new Date().toISOString(),
          phase: ready ? 'running' : 'startup',
          code: String(error.code ?? error.name).slice(0, 60),
          message: String(error.message).slice(0, 400),
        };
        this.stop();
        this.publish('failed');
        if (!ready) reject(error);
        this.emit(
          'failure',
          'Windows event observation stopped. Basic conversation is still available.',
        );
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (generation !== this.generation) return;
        pending += chunk;
        if (pending.length > 32768) {
          failure(new Error('Observer response exceeds limit'));
          return;
        }
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (
              event.type === 'ready' &&
              !ready &&
              event.source === 'windows-events' &&
              event.capturesImages === false &&
              event.capturesTitles === false
            ) {
              clearTimeout(timer);
              this.rejectStartup = null;
              ready = true;
              this.lastFailure = null;
              this.publish('active');
              resolve(this.snapshot());
            } else if (ready) this.emit('observation', validateObservation(event));
            else throw new Error('Observer was not ready');
          } catch (error) {
            failure(error);
            return;
          }
        }
      });
      child.stderr.on('data', () => {});
      child.on('error', failure);
      child.on('close', () => {
        if (generation === this.generation) failure(new Error('Windows observer closed'));
      });
      child.stdin.on('error', failure);
      child.stdin.write(JSON.stringify({ ignoredProcessIds, filterProcessId }) + '\n');
    });
    return this.starting;
  }
  stop() {
    this.generation++;
    clearTimeout(this.startTimer);
    const reject = this.rejectStartup;
    this.rejectStartup = null;
    const error = new Error('Windows observation startup cancelled');
    error.name = 'AbortError';
    reject?.(error);
    const child = this.child;
    this.child = null;
    this.starting = null;
    if (child) {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 600);
      timer.unref();
    }
    this.publish('off');
  }
}
