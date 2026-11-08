// SPDX-License-Identifier: GPL-3.0-only
const bytes = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/** /api/ps counters only. Never retain names, digests, paths or server extras. */
export function summarizeModelResidency(value, selectedModel) {
  if (!Array.isArray(value?.models) || value.models.length > 32)
    return { available: false, models: [] };
  return {
    available: true,
    models: value.models.slice(0, 8).map((item) => {
      const totalBytes = bytes(item?.size),
        gpuBytes = bytes(item?.size_vram);
      const comparable = totalBytes > 0 && gpuBytes !== null && gpuBytes <= totalBytes;
      return {
        selected:
          typeof selectedModel === 'string' &&
          (item?.name === selectedModel || item?.model === selectedModel),
        totalBytes,
        gpuBytes,
        offload: !comparable
          ? 'unknown'
          : gpuBytes === 0
            ? 'cpu'
            : gpuBytes === totalBytes
              ? 'gpu'
              : 'partial',
        contextTokens:
          Number.isSafeInteger(item?.context_length) &&
          item.context_length > 0 &&
          item.context_length <= 4 * 1024 * 1024
            ? item.context_length
            : null,
      };
    }),
    truncated: value.models.length > 8,
  };
}

/** Explicit diagnostic action only: no model startup and no background polling. */
export async function probeResourceUsage({ model, readModels, readProcess }) {
  const [models, process] = await Promise.allSettled([
    Promise.resolve().then(readModels),
    Promise.resolve().then(readProcess),
  ]);
  const reading = process.status === 'fulfilled' ? process.value : null;
  return {
    localModels: summarizeModelResidency(
      models.status === 'fulfilled' ? models.value : null,
      model,
    ),
    capriProcesses: {
      workingSetBytes: bytes(reading?.ramBytes),
      gpuBytes: bytes(reading?.vramBytes),
      basis:
        'Sum of owned process working sets; shared pages may be counted more than once. This is not total system RAM.',
    },
    modelCounterBasis:
      'Ollama resident allocation counters, not physical process RAM or peak usage. GPU capacity alone does not prove GPU offload.',
  };
}
