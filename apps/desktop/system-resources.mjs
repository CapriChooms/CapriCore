// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

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

async function readCpuTemperature() {
  if (process.platform !== 'win32') return null;
  const executable = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  // ACPI also reports skin, board and virtual zones. Only use a CPU-named zone.
  const script = String.raw`
    Get-CimInstance -Namespace root/WMI -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop |
      Where-Object { $_.Active -and $_.InstanceName -match '^ACPI\\ThermalZone\\CPU(?:T|Z|TZ|\d+)?(?:_\d+)?$' } |
      Select-Object -ExpandProperty CurrentTemperature |
      Measure-Object -Maximum |
      Select-Object -ExpandProperty Maximum
  `;
  const { stdout } = await run(
    executable,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 2400, maxBuffer: 16384 },
  );
  return celsiusFromDecikelvin(stdout.trim());
}

/** Sample on demand, sharing a bounded sensor read with concurrent callers. */
export class CpuSampler {
  constructor({ readTimes = cpuTimes, readTemperature = readCpuTemperature, now = Date.now } = {}) {
    Object.assign(this, { readTimes, readTemperature, now });
    this.temperatureCelsius = null;
    this.temperatureSampledAt = null;
    this.nextTemperatureAt = 0;
  }

  async sample() {
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
    await this.pending;
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
