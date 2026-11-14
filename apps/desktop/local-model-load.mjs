// SPDX-License-Identifier: GPL-3.0-only
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { access, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertPrivatePath,
  writePrivateBytesAtomic,
} from '../../packages/runtime/src/safe-file.mjs';
import {
  LOCAL_LOAD_DEFAULTS,
  localLoadSettings,
  LocalLoadPolicy,
} from './local-model-load-policy.mjs';
const run = promisify(execFile);

/** A private helper acts only on verified descendants of this installation's
 * managed language worker. The UI, memory worker and other applications stay outside its job.
 */
export class LocalModelLoad {
  constructor({
    root,
    dataRoot = root,
    ownerPid = process.pid,
    platform = process.platform,
    spawnImpl = spawn,
    runImpl = run,
    now = Date.now,
  } = {}) {
    Object.assign(this, { root, ownerPid, platform, spawnImpl, runImpl, now });
    this.file = path.join(dataRoot, 'data/desktop/local-model-load.json');
    this.settings = { ...LOCAL_LOAD_DEFAULTS };
    this.policy = new LocalLoadPolicy();
    this.jobs = new Map();
    this.state = platform === 'win32' ? 'idle' : 'unsupported';
    this.active = false;
    try {
      assertPrivatePath(this.file);
      if (existsSync(this.file)) {
        const info = lstatSync(this.file);
        if (!info.isFile() || info.nlink !== 1 || info.size > 4096) throw Error();
        const saved = JSON.parse(readFileSync(this.file, 'utf8'));
        if (
          saved.schemaVersion !== 1 ||
          Object.keys(saved).some((key) => !['schemaVersion', 'settings'].includes(key))
        )
          throw Error();
        this.settings = localLoadSettings(saved.settings);
      }
    } catch {
      this.warning = 'Saved load limit could not be restored. Defaults are in use.';
    }
  }
  snapshot() {
    return {
      ...this.settings,
      supported: this.platform === 'win32',
      state: this.state,
      gpuAvailable: Number.isFinite(this.sample?.gpuPercent),
      warning: this.warning ?? null,
    };
  }
  set(value) {
    const next = localLoadSettings(value);
    assertPrivatePath(this.file);
    writePrivateBytesAtomic(
      this.file,
      Buffer.from(JSON.stringify({ schemaVersion: 1, settings: next }, null, 2) + '\n'),
    );
    if (this.settings.enabled && next.enabled) {
      // Retarget an already calibrated runner rather than releasing its quota
      // for a fresh two-second calibration on every slider movement.
      this.policy.cap = Math.max(
        1,
        Math.min(
          next.percent * 100,
          Math.round((this.policy.cap * next.percent) / this.settings.percent),
        ),
      );
    } else this.policy = new LocalLoadPolicy();
    this.settings = next;
    this.warning = null;
    if (!next.enabled) void this.stop();
    else this.send();
    this.nextSync = 0;
    return this.snapshot();
  }
  marker() {
    const native = path.join(this.root, 'data/run/llama-chat.json');
    const file = existsSync(native) ? native : path.join(this.root, 'data/run/ollama.json');
    assertPrivatePath(file);
    if (!existsSync(file)) return null;
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || info.size > 65536) return null;
    const bytes = readFileSync(file);
    if (bytes.length > 65536) return null;
    const value = JSON.parse(bytes);
    const normalize = (name) => path.resolve(name).toLowerCase();
    if (
      !Number.isInteger(value.pid) ||
      value.pid < 1 ||
      !/^\d{1,20}$/.test(value.startedAt) ||
      typeof value.executable !== 'string' ||
      !path.isAbsolute(value.executable) ||
      !/^(?:llama-server|ollama)\.exe$/i.test(path.basename(value.executable)) ||
      typeof value.projectRoot !== 'string' ||
      normalize(value.projectRoot) !== normalize(this.root)
    )
      return null;
    return value;
  }
  async prepare() {
    const source = path.join(this.root, 'apps/desktop/native/CapriLocalLoad.cs');
    const hash = createHash('sha256')
      .update(await readFile(source))
      .digest('hex')
      .slice(0, 16);
    const folder = path.join(this.root, '.runtime/local-model-load', hash);
    const executable = path.join(folder, 'Capri.LocalLoad.exe');
    if (
      await access(executable).then(
        () => true,
        () => false,
      )
    )
      return executable;
    await mkdir(folder, { recursive: true });
    const temporary = path.join(folder, 'compile-' + randomUUID() + '.exe');
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
          source,
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
  send(adapt = false) {
    const worker = this.worker;
    if (!worker || worker.exitCode !== null || worker.stdin.destroyed) return;
    const cap = adapt
      ? this.policy.update(this.settings, this.sample)
      : Math.min(this.policy.cap, this.settings.enabled ? this.settings.percent * 100 : 10000);
    worker.stdin.write(JSON.stringify({ cap }) + '\n', () => {});
  }
  start(executable, marker) {
    const worker = this.spawnImpl(
      executable,
      [String(marker.pid), marker.startedAt, marker.executable, String(this.ownerPid)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    this.worker = worker;
    const lease = { executable, marker };
    this.workerLease = lease;
    this.workerKey = marker.pid + '/' + marker.startedAt;
    this.state = 'starting';
    this.sample = null;
    this.policy = new LocalLoadPolicy();
    let pending = '';
    worker.stdin.on('error', () => {});
    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (chunk) => {
      if (worker !== this.worker) return;
      pending += chunk;
      if (pending.length > 65536) {
        worker.stdin.end('{"stop":true}\n');
        return;
      }
      let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        try {
          const value = JSON.parse(line);
          if (value.error) throw Error();
          if (value.ready === true) {
            if (typeof value.jobHandle !== 'string' || !/^[1-9]\d{0,18}$/.test(value.jobHandle))
              throw Error();
            lease.jobHandle = value.jobHandle;
            // Keep one host-owned handle per supervisor even between turns.
            // Otherwise Windows removes the name when the helper exits, and a
            // new turn would nest another CPU job around the same model runner.
            if (!this.jobs.has(this.workerKey))
              this.jobs.set(this.workerKey, { executable, marker, jobHandle: value.jobHandle });
            this.state = 'active';
            if (this.warning === 'Local model load control is unavailable.') this.warning = null;
            this.send();
            continue;
          }
          if (
            !Number.isInteger(value.members) ||
            value.members < 0 ||
            value.members > 64 ||
            !Number.isFinite(value.cpuPercent) ||
            value.cpuPercent < 0 ||
            value.cpuPercent > 100 ||
            (value.gpuPercent !== null &&
              (!Number.isFinite(value.gpuPercent) ||
                value.gpuPercent < 0 ||
                value.gpuPercent > 100))
          )
            throw Error();
          this.sample = value;
          this.state = value.members ? 'active' : 'waiting';
          this.send(true);
        } catch {
          this.state = 'unavailable';
          this.warning = 'Local model load control is unavailable.';
          worker.stdin.end('{"stop":true}\n');
        }
      }
    });
    worker.on('error', () => {
      if (worker === this.worker) {
        this.state = 'unavailable';
        this.warning = 'Local model load control is unavailable.';
      }
    });
    worker.once('close', () => {
      if (worker !== this.worker) return;
      this.worker = null;
      this.sample = null;
      this.nextSync = this.now() + 5000;
      if (!this.stopping && this.active && this.settings.enabled) {
        this.state = 'unavailable';
        this.warning = 'Local model load control is unavailable.';
      } else if (this.state !== 'unavailable') this.state = 'idle';
      if (!this.stopping) void this.reset(lease);
    });
    return worker;
  }
  /** Called by the existing desktop tick. No polling or helper while idle/API-only. */
  synchronize(active) {
    this.active = active;
    if (this.closed || this.platform !== 'win32' || !active || !this.settings.enabled) {
      if (this.worker) void this.stop();
      return;
    }
    if (this.stopping || this.syncing || this.now() < (this.nextSync ?? 0)) return;
    this.nextSync = this.now() + 1500;
    this.syncing = (async () => {
      try {
        const marker = this.marker();
        if (!marker) {
          if (this.worker) await this.stop();
          return;
        }
        if (this.workerKey !== marker.pid + '/' + marker.startedAt && this.worker)
          await this.stop();
        if (!this.worker) {
          const executable = await this.prepare();
          if (this.closed || !this.active || !this.settings.enabled) return;
          this.start(executable, marker);
        } else this.send();
      } catch {
        this.state = 'unavailable';
        this.warning = 'Local model load control is unavailable.';
      }
    })().finally(() => {
      this.syncing = null;
    });
  }
  async stop() {
    if (this.stopping) return this.stopping;
    const worker = this.worker;
    const lease = this.workerLease;
    if (!worker) return;
    this.stopping = new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        worker.kill();
        done();
      }, 2500);
      worker.once('close', done);
      if (!worker.stdin.destroyed) worker.stdin.end('{"stop":true}\n');
      else done();
    }).finally(async () => {
      await this.reset(lease);
      if (this.worker === worker) this.worker = null;
      this.workerKey = null;
      this.sample = null;
      this.state = this.platform === 'win32' ? 'idle' : 'unsupported';
      this.stopping = null;
    });
    return this.stopping;
  }
  async reset(lease, release = false) {
    if (!lease) return;
    if (lease.resetting) return lease.resetting;
    const { executable, marker } = lease;
    const anchor = this.jobs.get(marker.pid + '/' + marker.startedAt);
    const closeHandle = release || anchor?.jobHandle !== lease.jobHandle;
    lease.resetting = this.runImpl(
      executable,
      [
        String(marker.pid),
        marker.startedAt,
        marker.executable,
        String(this.ownerPid),
        '--reset',
        ...(lease.jobHandle && closeHandle ? [lease.jobHandle] : []),
      ],
      { windowsHide: true, timeout: 4000, maxBuffer: 4096 },
    ).catch(() => {});
    return lease.resetting;
  }
  async close() {
    this.closed = true;
    await this.stop();
    await Promise.all([...this.jobs.values()].map((job) => this.reset(job, true)));
    this.jobs.clear();
  }
}
