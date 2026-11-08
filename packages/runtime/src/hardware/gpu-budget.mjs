// SPDX-License-Identifier: GPL-3.0-only
const MiB = 1024 ** 2;
/** Ollama subtracts this overhead from the CURRENT free memory on every load.
 * Voice-first startup makes its real residency visible to the scheduler. Only
 * reserve future voice allocations when the voice has not been loaded yet. */
export function gpuBudget({
  acceleration,
  voiceExpected = false,
  voiceReady = false,
  gpus = [],
} = {}) {
  const overheadBytes =
    acceleration === 'cpu' ? 0 : (768 + (voiceExpected && !voiceReady ? 3072 : 0)) * MiB;
  return {
    overheadBytes,
    voiceReady,
    voiceExpected,
    devices: gpus.map(({ id, name, freeBytes, totalBytes }) => ({
      id,
      name,
      freeBytes,
      totalBytes,
      availableForModelBytes: Math.max(0, freeBytes - overheadBytes),
    })),
  };
}
