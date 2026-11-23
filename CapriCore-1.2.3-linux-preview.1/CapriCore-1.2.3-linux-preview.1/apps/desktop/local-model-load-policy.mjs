// SPDX-License-Identifier: GPL-3.0-only
export const LOCAL_LOAD_DEFAULTS = Object.freeze({ enabled: true, percent: 85 });
export function localLoadSettings(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['enabled', 'percent'].includes(key)) ||
    typeof value.enabled !== 'boolean' ||
    !Number.isInteger(value.percent) ||
    value.percent < 10 ||
    value.percent > 100
  )
    throw new Error('Invalid local model load limit.');
  return { enabled: value.enabled, percent: value.percent };
}

/** GPU control is feedback through the model runner's CPU submission budget.
 * Windows enforces the CPU quota; GPU averages converge, not instantaneous peaks.
 */
export class LocalLoadPolicy {
  constructor() {
    this.cap = 10000;
    this.frames = 0;
    this.filteredGpu = null;
    this.filteredCpu = null;
    this.calibrated = false;
  }
  update(settings, sample) {
    const maximum = settings.enabled ? settings.percent * 100 : 10000;
    if (!settings.enabled || !sample?.members) {
      this.frames = 0;
      this.filteredGpu = null;
      this.filteredCpu = null;
      this.calibrated = false;
      return (this.cap = maximum);
    }
    this.cap = Math.min(this.cap, maximum);
    const gpu = sample.gpuPercent,
      cpu = sample.cpuPercent;
    if (
      !Number.isFinite(gpu) ||
      gpu < 0 ||
      gpu > 100 ||
      !Number.isFinite(cpu) ||
      cpu < 0 ||
      cpu > 100
    ) {
      this.frames = 0;
      this.filteredGpu = null;
      this.filteredCpu = null;
      this.calibrated = false;
      return (this.cap = maximum);
    }
    this.filteredGpu = this.filteredGpu === null ? gpu : this.filteredGpu * 0.6 + gpu * 0.4;
    this.filteredCpu = this.filteredCpu === null ? cpu : this.filteredCpu * 0.6 + cpu * 0.4;
    this.frames++;
    if (this.frames < 4) return this.cap;
    if (!this.calibrated && this.filteredGpu > settings.percent + 2 && this.filteredCpu > 0) {
      const desired = Math.max(
        1,
        Math.min(
          maximum,
          Math.round(((this.filteredCpu * 100 * settings.percent) / this.filteredGpu) * 0.98),
        ),
      );
      this.cap = desired;
      this.calibrated = true;
    } else if (this.calibrated && Math.abs(this.filteredGpu - settings.percent) > 2) {
      // CPU cycle quotas and elapsed-time CPU readings differ with turbo
      // and hybrid cores. After calibration regulate GPU feedback directly.
      // A busy game can temporarily drive the quota almost to zero. When it
      // ends, zero GPU/CPU samples and integer rounding must not trap us there.
      const quiet = this.filteredGpu < settings.percent / 3;
      const next = this.cap * Math.pow(settings.percent / Math.max(1, this.filteredGpu), 0.15);
      let adjusted = Math.round(
        Math.max(this.cap * 0.92, Math.min(this.cap * (quiet ? 1.25 : 1.08), next)),
      );
      if (next > this.cap && adjusted <= this.cap) adjusted = this.cap + (quiet ? 2 : 1);
      this.cap = Math.max(1, Math.min(maximum, adjusted));
    }
    return this.cap;
  }
}
