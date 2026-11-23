// SPDX-License-Identifier: GPL-3.0-only
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const unavailable = { cpuPercent: null, ramBytes: null, vramBytes: null };
const bytes = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

export class ProcessLoadSampler {
  constructor({
    root,
    pid = process.pid,
    now = () => performance.now(),
    cores = availableParallelism(),
    read = () => this.readWindows(root, pid),
  }) {
    Object.assign(this, { now, cores, read });
    this.generation = 0;
  }

  async readWindows(root, pid) {
    if (process.platform !== 'win32') throw new Error('Windows counters unavailable');
    const generation = this.generation;
    this.executable ??= await this.prepare(root);
    if (generation !== this.generation) throw new Error('Process monitoring paused');
    clearTimeout(this.idleTimer);
    const child = this.worker ?? this.startWorker(pid, root);
    const sample = await this.request(child);
    if (generation !== this.generation) throw new Error('Process monitoring paused');
    this.idleTimer = setTimeout(() => this.stop(), 15000);
    this.idleTimer.unref();
    return sample;
  }

  startWorker(pid, root) {
    const child = spawn(this.executable, [String(pid), root], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.stdout.setEncoding('utf8');
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.once('close', () => {
      if (this.worker === child) this.worker = null;
    });
    this.worker = child;
    return child;
  }

  request(child) {
    return new Promise((resolve, reject) => {
      let response = '';
      const settle = (error, data) => {
        clearTimeout(timeout);
        child.stdout.off('data', receive);
        child.off('close', closed);
        child.off('error', settle);
        if (this.cancelRequest === cancel) this.cancelRequest = null;
        if (error) reject(error);
        else resolve(data);
      };
      const closed = () => settle(new Error('Process monitor exited'));
      const cancel = () => settle(new Error('Process monitoring paused'));
      const receive = (chunk) => {
        response += chunk;
        if (response.length > 65536) return settle(new Error('Process sample too large'));
        const end = response.indexOf('\n');
        if (end < 0) return;
        try {
          settle(null, JSON.parse(response.slice(0, end)));
        } catch (error) {
          settle(error);
        }
      };
      const timeout = setTimeout(() => settle(new Error('Process sample timed out')), 2500);
      this.cancelRequest = cancel;
      child.stdout.on('data', receive);
      child.once('close', closed);
      child.once('error', settle);
      child.stdin.write('sample\n', (error) => {
        if (error) settle(error);
      });
    });
  }

  stop() {
    this.generation++;
    this.previous = null;
    this.retryAt = 0;
    clearTimeout(this.idleTimer);
    this.cancelRequest?.();
    const child = this.worker;
    this.worker = null;
    if (child) {
      child.stdin.destroy();
      child.kill();
    }
  }

  async prepare(root) {
    const source = path.join(root, 'apps/desktop/native/CapriProcessLoad.cs');
    const hash = createHash('sha256')
      .update(await readFile(source))
      .digest('hex')
      .slice(0, 16);
    const folder = path.join(root, '.runtime/process-load', hash);
    const executable = path.join(folder, 'Capri.ProcessLoad.exe');
    if (
      await access(executable).then(
        () => true,
        () => false,
      )
    )
      return executable;
    await mkdir(folder, { recursive: true });
    const temporary = path.join(folder, 'build-' + process.pid + '.exe');
    const compiler = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    );
    try {
      await run(
        compiler,
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/out:' + temporary,
          '/r:System.Web.Extensions.dll',
          source,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      );
      await rename(temporary, executable);
      return executable;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  sample() {
    if (!this.pending) {
      if (this.retryAt > this.now()) return Promise.resolve(unavailable);
      const generation = this.generation;
      this.pending = Promise.resolve()
        .then(this.read)
        .then((reading) => {
          if (generation !== this.generation) return unavailable;
          const at = this.now();
          const cpu = new Map();
          for (const process of reading.processes) {
            if (
              Number.isSafeInteger(process.pid) &&
              /^\d+$/.test(process.started) &&
              Number.isFinite(process.cpuMs) &&
              process.cpuMs >= 0
            )
              cpu.set(process.pid + '/' + process.started, process.cpuMs);
          }
          if (!cpu.size) throw new Error('No Capri processes in sample');
          const elapsed = at - this.previous?.at;
          let used = 0;
          let matches = 0;
          if (elapsed > 0 && elapsed <= 20000)
            for (const [id, total] of cpu) {
              const before = this.previous.cpu.get(id);
              if (before === undefined || total < before) continue;
              used += total - before;
              matches++;
            }
          this.previous = { at, cpu };
          return {
            cpuPercent: matches ? Math.min(100, (100 * used) / (elapsed * this.cores)) : null,
            ramBytes: bytes(reading.ramBytes),
            vramBytes: bytes(reading.vramBytes),
          };
        })
        .catch(() => {
          if (generation === this.generation) {
            this.stop();
            this.executable = null;
            this.retryAt = this.now() + 30000;
          }
          return unavailable;
        })
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  }
}
