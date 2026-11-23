// SPDX-License-Identifier: GPL-3.0-only
import { cpus, machine, totalmem } from 'node:os';

export function windowsX64Emulation({
  platform = process.platform,
  arch = process.arch,
  hardwareArch = process.env.PROCESSOR_ARCHITEW6432 || machine(),
  cpu = cpus()[0]?.model ?? '',
} = {}) {
  // x64 emulation can report AMD64 even though the Windows host is ARM64.
  return (
    platform === 'win32' &&
    arch === 'x64' &&
    (/^(?:arm64|aarch64)$/i.test(hardwareArch) ||
      /\b(?:Snapdragon|Oryon|Microsoft SQ\d)\b/i.test(cpu))
  );
}

/** Planning budgets, not measured speed. Leave cold imports/prefill time on small PCs. */
export function responsiveness({
  ramBytes = totalmem(),
  availableRamBytes,
  resourceProfile,
  acceleration,
} = {}) {
  const lowMemory = Number.isFinite(ramBytes) && ramBytes > 0 && ramBytes <= 17 * 1024 ** 3;
  const memoryPressure =
    Number.isFinite(availableRamBytes) &&
    availableRamBytes >= 0 &&
    availableRamBytes < 6 * 1024 ** 3;
  const slow =
    lowMemory || memoryPressure || resourceProfile === 'minimal' || acceleration === 'cpu';
  return {
    sequentialModels: lowMemory || memoryPressure,
    firstTextTimeoutMs: slow ? 120000 : 30000,
    timeoutMs: slow ? 300000 : 180000,
    agentWarmupTimeoutMs: slow ? 180000 : 60000,
  };
}
