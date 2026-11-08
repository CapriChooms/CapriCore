// SPDX-License-Identifier: GPL-3.0-only
import { totalmem } from 'node:os';

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
