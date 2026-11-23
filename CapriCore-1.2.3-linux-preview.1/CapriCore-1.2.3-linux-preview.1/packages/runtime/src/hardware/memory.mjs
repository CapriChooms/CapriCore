// SPDX-License-Identifier: GPL-3.0-only
import { freemem, totalmem } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { findExecutable } from '../host/paths.mjs';
import { windowsGpuSampler } from './windows-gpu.mjs';

const run = promisify(execFile);
const MiB = 1024 ** 2;
export function memoryUsage(total, free) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0 || free > total)
    return null;
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: total - free,
    percent: (100 * (total - free)) / total,
  };
}
function measurement(text, min, max) {
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}
export function parseGpuMemory(stdout, { telemetry = false } = {}) {
  return String(stdout)
    .trim()
    .split(/\r?\n/)
    .flatMap((line) => {
      const fields = line.split(',').map((part) => part.trim());
      const index = fields.shift(),
        uuid = fields.shift();
      const utilization = telemetry ? measurement(fields.pop(), 0, 100) : null;
      const temperatureCelsius = telemetry ? measurement(fields.pop(), -20, 150) : null;
      const free = fields.pop(),
        total = fields.pop();
      const name = fields.join(', ');
      const usage =
        /^\d+(?:\.\d+)?$/.test(total) && /^\d+(?:\.\d+)?$/.test(free)
          ? memoryUsage(Number(total) * MiB, Number(free) * MiB)
          : null;
      return usage && /^\d+$/.test(index) && uuid && name
        ? [
            {
              id: uuid,
              index: Number(index),
              name,
              vendor: 'nvidia',
              ...usage,
              ...(telemetry ? { utilization, temperatureCelsius } : {}),
            },
          ]
        : [];
    });
}
async function readNvidiaMemory() {
  const executable = findExecutable('nvidia-smi', {
    extra: [
      process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32/nvidia-smi.exe') : null,
    ],
  });
  if (!executable) return [];
  const { stdout } = await run(
    executable,
    [
      '--query-gpu=index,uuid,name,memory.total,memory.free,temperature.gpu,utilization.gpu',
      '--format=csv,noheader,nounits',
    ],
    { windowsHide: true, timeout: 2500, maxBuffer: 65536 },
  );
  return parseGpuMemory(stdout, { telemetry: true });
}

export function mergeGpuReadings(nvidia, windows) {
  return [...nvidia, ...windows.filter((gpu) => gpu.vendor !== 'nvidia' || !nvidia.length)];
}
async function readGpuMemory() {
  const [driver, native] = await Promise.allSettled([
    readNvidiaMemory(),
    process.platform === 'win32' ? windowsGpuSampler.sample() : Promise.resolve([]),
  ]);
  return mergeGpuReadings(
    driver.status === 'fulfilled' ? driver.value : [],
    native.status === 'fulfilled' ? native.value : [],
  );
}

/** Read-only, bounded and shared by all callers. No timer or model loads.
 * An unavailable/failed driver is unknown, never zero usage or a stale sample. */
export class MemorySampler {
  constructor({
    readGpu = readGpuMemory,
    ram = () => memoryUsage(totalmem(), freemem()),
    now = Date.now,
  } = {}) {
    Object.assign(this, { readGpu, ram, now });
    this.nextGpuAt = 0;
    this.gpus = [];
  }
  async sample({ fresh = false } = {}) {
    if (!this.pending && (fresh || this.now() >= this.nextGpuAt)) {
      this.pending = Promise.resolve()
        .then(() => this.readGpu())
        .then(
          (gpus) => {
            this.gpus = gpus;
            this.gpuSampledAt = this.now();
            this.nextGpuAt = this.now() + (gpus.length ? 2000 : 30000);
          },
          () => {
            this.gpus = [];
            this.gpuSampledAt = null;
            this.nextGpuAt = this.now() + 30000;
          },
        )
        .finally(() => {
          this.pending = null;
        });
    }
    await this.pending;
    return {
      sampledAt: this.now(),
      gpuSampledAt: this.gpuSampledAt ?? null,
      ram: this.ram(),
      gpus: this.gpus.map((gpu) => ({ ...gpu })),
    };
  }
}
export const memorySampler = new MemorySampler();
