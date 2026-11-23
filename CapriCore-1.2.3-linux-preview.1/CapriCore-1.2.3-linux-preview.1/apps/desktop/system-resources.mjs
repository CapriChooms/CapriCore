// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { memoryUsage } from '../../packages/runtime/src/hardware/memory.mjs';

const run = promisify(execFile);

export async function resourceDiskUsage(volumePath, readVolume = statfs) {
  try {
    const { blocks, bfree, bsize } = await readVolume(volumePath);
    return memoryUsage(blocks * bsize, bfree * bsize);
  } catch {
    return null;
  }
}

function cpuTimes() {
  const cores = cpus();
  return {
    cores: cores.length,
    idle: cores.reduce((sum, { times }) => sum + times.idle, 0),
    total: cores.reduce(
      (sum, { times }) => sum + Object.values(times).reduce((total, ticks) => total + ticks, 0),
      0,
    ),
  };
}

function loadPercent(previous, current) {
  if (!previous || previous.cores !== current.cores) return null;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  return total > 0 && idle >= 0 && idle <= total ? (100 * (total - idle)) / total : null;
}

export function celsiusFromDecikelvin(value) {
  if (!/^\d+$/.test(value)) return null;
  const celsius = Number(value) / 10 - 273.15;
  return celsius >= -20 && celsius <= 150 ? Math.round(celsius * 10) / 10 : null;
}

const cpuTemperatureId = /^\/(?:amd|intel|generic)cpu\/\d+\/temperature\/\d+$/i;

export function cpuPackageTemperature(sensors) {
  let best = null;
  let priority = -1;
  for (const { id, name, value } of sensors) {
    if (!cpuTemperatureId.test(id) || typeof name !== 'string') continue;
    const label = name.trim();
    const rank = /^(?:CPU )?Package$|^(?:Core|CPU) \((?:Tctl\/Tdie|Tdie)\)$/i.test(label)
      ? 2
      : /^CPU Die \(average\)$|^Core (?:Max|Average)$/i.test(label)
        ? 1
        : /^(?:CPU )?Core #?\d+$|^(?:CPU )?CCD\d+ \(Tdie\)$/i.test(label)
          ? 0
          : -1;
    if (rank < 0 || rank < priority) continue;
    const formatted =
      typeof value === 'string' && /^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*(?:°C)?\s*$/u.exec(value);
    const reading = formatted ? Number(formatted[1].replace(',', '.')) : value;
    if (!Number.isFinite(reading) || reading < -20 || reading > 150) continue;
    if (rank > priority || reading > best) {
      best = reading;
      priority = rank;
    }
  }
  return best === null ? null : Math.round(best * 10) / 10;
}

export function libreCpuTemperature(tree) {
  const sensors = [];
  const pending = [tree];
  for (let inspected = 0; pending.length && inspected < 4096; inspected++) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.Type === 'Temperature' && typeof node.SensorId === 'string')
      sensors.push({ id: node.SensorId, name: node.Text, value: node.RawValue ?? node.Value });
    if (Array.isArray(node.Children)) {
      for (const child of node.Children) {
        if (pending.length >= 4096) break;
        pending.push(child);
      }
    }
  }
  return cpuPackageTemperature(sensors);
}

async function readLibreCpuTemperature() {
  try {
    const response = await fetch('http://127.0.0.1:8085/data.json', {
      redirect: 'error',
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 512 * 1024) return null;
      chunks.push(chunk);
    }
    return libreCpuTemperature(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return null;
  }
}

export async function readCpuTemperature() {
  if (process.platform !== 'win32') return null;
  const executable = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  // ACPI also reports skin, board and virtual zones. Use the CPU package
  // provider when present or an explicitly CPU-named firmware zone.
  const script = String.raw`
    $ErrorActionPreference = 'SilentlyContinue'
    $libre = [bool](Get-Process -Name LibreHardwareMonitor,LibreHardwareMonitor.Windows.Forms)
    $sensors = @(foreach ($namespace in 'LibreHardwareMonitor','OpenHardwareMonitor') {
      Get-CimInstance -Namespace "root/$namespace" -ClassName Sensor -Filter "SensorType = 'Temperature'" |
        Where-Object Identifier -Match '^/(amd|intel|generic)cpu/\d+/temperature/\d+$' |
        Select-Object @{Name='id';Expression={$_.Identifier}},@{Name='name';Expression={$_.Name}},@{Name='value';Expression={$_.Value}}
    })
    $acpi = Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature |
      Where-Object { $_.Active -and $_.InstanceName -match '^ACPI\\ThermalZone\\(?:CPU(?:T|Z|TZ|\d+)?|CPUTEMP|TCPU|TZCP)(?:_\d+)?$' } |
      Measure-Object -Property CurrentTemperature -Maximum |
      Select-Object -ExpandProperty Maximum
    @{libre=$libre; sensors=$sensors; acpi=[string]$acpi} | ConvertTo-Json -Compress
  `;
  const { stdout } = await run(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 2400, maxBuffer: 16384 },
  );
  const { libre, sensors, acpi } = JSON.parse(stdout);
  return (
    (libre ? await readLibreCpuTemperature() : null) ??
    cpuPackageTemperature(sensors) ??
    celsiusFromDecikelvin(acpi)
  );
}

/** Sample on demand, sharing a bounded sensor read with concurrent callers. */
export class CpuSampler {
  constructor({ readTimes = cpuTimes, readTemperature = readCpuTemperature, now = Date.now } = {}) {
    Object.assign(this, { readTimes, readTemperature, now });
    this.temperatureCelsius = null;
    this.temperatureSampledAt = null;
    this.nextTemperatureAt = 0;
  }

  async sample({ awaitTemperature = true } = {}) {
    const current = this.readTimes();
    const utilization = loadPercent(this.previous, current);
    if (!this.previous || current.total !== this.previous.total) this.previous = current;
    if (!this.pending && this.now() >= this.nextTemperatureAt) {
      this.pending = Promise.resolve()
        .then(this.readTemperature)
        .catch(() => null)
        .then((reading) => {
          this.temperatureCelsius = Number.isFinite(reading) ? reading : null;
          this.temperatureSampledAt = this.temperatureCelsius === null ? null : this.now();
          this.nextTemperatureAt = this.now() + (this.temperatureCelsius === null ? 60000 : 10000);
        })
        .finally(() => (this.pending = null));
    }
    if (awaitTemperature) await this.pending;
    return {
      utilization,
      temperatureCelsius: this.temperatureCelsius,
      temperatureSampledAt: this.temperatureSampledAt,
    };
  }

  stop() {
    this.previous = null;
  }
}
