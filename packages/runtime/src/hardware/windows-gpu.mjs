// SPDX-License-Identifier: GPL-3.0-only
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { root } from '../host/paths.mjs';

const run = promisify(execFile);
const luidPattern = /^0x[0-9a-f]{8}_0x[0-9a-f]{8}$/i;
const memoryPattern = /^luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_phys_(\d+)$/i;
const enginePattern =
  /^pid_\d+_luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_phys_(\d+)_eng_(\d+)_engtype_[a-z0-9_]+$/i;
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const normalizeLuid = (value) => value.toUpperCase().replaceAll('0X', '0x');

/** Adapter-wide dedicated memory only. Process budgets/shared UMA are not VRAM. */
export function parseWindowsGpuSample(value) {
  if (!Array.isArray(value?.adapters) || value.adapters.length > 64)
    throw Error('Windows GPU inventory unavailable');
  const memory = new Map(),
    engines = new Map();
  for (const row of Array.isArray(value.memory) ? value.memory.slice(0, 8192) : []) {
    const match = memoryPattern.exec(row?.name ?? '');
    if (!match || !Number.isSafeInteger(row.value) || row.value < 0) continue;
    const id = normalizeLuid(match[1]);
    const samples = memory.get(id) ?? [];
    samples.push({ node: match[2], bytes: row.value });
    memory.set(id, samples);
  }
  for (const row of Array.isArray(value.engines) ? value.engines.slice(0, 8192) : []) {
    const match = enginePattern.exec(row?.name ?? '');
    if (!match || !number(row.value) || row.value > 100) continue;
    const id = normalizeLuid(match[1]);
    const perEngine = engines.get(id) ?? new Map();
    const engine = match[2] + '/' + match[3];
    perEngine.set(engine, Math.min(100, (perEngine.get(engine) ?? 0) + row.value));
    engines.set(id, perEngine);
  }
  const seen = new Set();
  return value.adapters.flatMap((adapter) => {
    const luid =
      typeof adapter?.luid === 'string' && luidPattern.test(adapter.luid)
        ? normalizeLuid(adapter.luid)
        : null;
    if (
      !luid ||
      seen.has(luid) ||
      typeof adapter.name !== 'string' ||
      !adapter.name.trim() ||
      adapter.name.length > 256 ||
      /[\x00-\x1f\x7f]/.test(adapter.name)
    )
      return [];
    seen.add(luid);
    const bytes = number(adapter.vramMiB) ? adapter.vramMiB * 1024 ** 2 : null;
    const totalBytes =
      adapter.memoryKind === 'dedicated' && Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
    const samples = memory.get(luid);
    const usedBytes =
      totalBytes &&
      samples?.length === 1 &&
      samples[0].node === '0' &&
      samples[0].bytes <= totalBytes
        ? samples[0].bytes
        : null;
    const usage = engines.get(luid);
    return [
      {
        id: 'luid-' + luid,
        luid,
        name: adapter.name.trim(),
        vendor: ['amd', 'nvidia', 'intel'].includes(adapter.vendor) ? adapter.vendor : 'unknown',
        memoryKind:
          adapter.memoryKind === 'dedicated'
            ? 'dedicated'
            : adapter.memoryKind === 'shared'
              ? 'shared'
              : 'unknown',
        totalBytes,
        usedBytes,
        freeBytes: usedBytes === null ? null : totalBytes - usedBytes,
        percent: usedBytes === null ? null : (100 * usedBytes) / totalBytes,
        utilization: usage?.size ? Math.max(...usage.values()) : null,
        temperatureCelsius: null,
      },
    ];
  });
}

/** One compiled worker, shared requests, bounded output and idle/timeout cleanup. */
export class WindowsGpuSampler {
  constructor({
    directory = root,
    spawnImpl = spawn,
    runImpl = run,
    timeoutMs = 3500,
    idleMs = 15000,
    now = Date.now,
  } = {}) {
    Object.assign(this, { directory, spawnImpl, runImpl, timeoutMs, idleMs, now });
    this.generation = 0;
    this.retryAt = 0;
  }
  async prepare() {
    const files = [
      'packages/runtime/src/hardware/windows-gpu.cs',
      'packages/installer/windows/gpu-inventory.cs',
    ].map((file) => path.join(this.directory, file));
    const hash = createHash('sha256');
    for (const file of files) hash.update(await readFile(file));
    const folder = path.join(
      this.directory,
      '.runtime/gpu-monitor',
      hash.digest('hex').slice(0, 16),
    );
    const executable = path.join(folder, 'Capri.GpuMonitor.exe');
    if (
      await access(executable).then(
        () => true,
        () => false,
      )
    )
      return executable;
    await mkdir(folder, { recursive: true });
    const temporary = path.join(folder, randomUUID() + '.exe');
    try {
      await this.runImpl(
        path.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        ),
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/r:System.Web.Extensions.dll',
          '/out:' + temporary,
          ...files,
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      );
      await rename(temporary, executable).catch(async (error) => {
        if (
          !(await access(executable).then(
            () => true,
            () => false,
          ))
        )
          throw error;
      });
      return executable;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  request(child) {
    return new Promise((resolve, reject) => {
      let text = '',
        settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout.off('data', data);
        child.off('close', closed);
        child.off('error', closed);
        if (this.cancel === cancel) this.cancel = null;
        error ? reject(error) : resolve(value);
      };
      const cancel = () => finish(Error('GPU monitoring stopped'));
      const closed = () => finish(Error('GPU monitor exited'));
      const data = (chunk) => {
        text += chunk;
        if (text.length > 1024 * 1024) return finish(Error('GPU sample too large'));
        const end = text.indexOf('\n');
        if (end < 0) return;
        try {
          finish(null, parseWindowsGpuSample(JSON.parse(text.slice(0, end))));
        } catch (error) {
          finish(error);
        }
      };
      const timer = setTimeout(() => finish(Error('GPU monitor timed out')), this.timeoutMs);
      this.cancel = cancel;
      child.stdout.on('data', data);
      child.once('close', closed);
      child.once('error', closed);
      child.stdin.write('sample\n', (error) => {
        if (error) finish(error);
      });
    });
  }
  sample() {
    if (this.pending) return this.pending;
    if (this.retryAt > this.now()) return Promise.reject(Error('GPU monitoring unavailable'));
    const generation = this.generation;
    this.pending = Promise.resolve()
      .then(async () => {
        this.executable ??= await this.prepare();
        if (generation !== this.generation) throw Error('GPU monitoring stopped');
        clearTimeout(this.idleTimer);
        if (!this.worker) {
          const child = this.spawnImpl(this.executable, [], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'ignore'],
          });
          child.stdout.setEncoding('utf8');
          child.stdin.on('error', () => {});
          child.on('error', () => {});
          child.once('close', () => {
            if (this.worker === child) this.worker = null;
          });
          this.worker = child;
        }
        const value = await this.request(this.worker);
        if (generation !== this.generation) throw Error('GPU monitoring stopped');
        this.idleTimer = setTimeout(() => this.stop(), this.idleMs);
        this.idleTimer.unref?.();
        return value;
      })
      .catch((error) => {
        if (generation === this.generation) {
          this.stop();
          this.retryAt = this.now() + 30000;
        }
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  stop() {
    this.generation++;
    clearTimeout(this.idleTimer);
    this.cancel?.();
    const child = this.worker;
    this.worker = null;
    if (child) {
      child.stdin.destroy();
      child.kill();
    }
  }
}
export const windowsGpuSampler = new WindowsGpuSampler();
