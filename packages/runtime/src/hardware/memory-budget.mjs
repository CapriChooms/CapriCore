// SPDX-License-Identifier: GPL-3.0-only
import estimates from '../../../../config/memory-estimates.json' with { type: 'json' };
export { estimates as MEMORY_ESTIMATES };
const largerDedicatedGpu = (selected, gpu) =>
  gpu.memoryKind === 'dedicated' &&
  Number.isFinite(gpu.vramMiB) &&
  gpu.vramMiB > 0 &&
  (!selected || gpu.vramMiB > selected.vramMiB)
    ? gpu
    : selected;
export function dedicatedGpu(hardware) {
  // Select the largest card in one pass, preserving the first equal-capacity
  // card without allocating/sorting a filtered copy for each estimate.
  return hardware.gpus == null ? null : hardware.gpus.reduce(largerDedicatedGpu, null);
}
export function profileRamRequirement(profile, hardware) {
  const gpu = dedicatedGpu(hardware),
    estimate = estimates.models[profile.id];
  // Nominal VRAM reporting can differ slightly from the physical card capacity.
  const threshold = profile.recommendedVramGiB || Math.ceil(estimate?.vram[1] ?? Infinity);
  return estimate && gpu && gpu.vramMiB / 1024 >= threshold - 0.125
    ? estimate.gpuSystemRamGiB
    : profile.ramGiB;
}
const finite = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
const round = (n) => (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10 || 0;
export function estimateMemoryBudget(selection, hardware) {
  const gpu = dedicatedGpu(hardware);
  const ram = [...estimates.base.ram],
    vram = gpu ? [...estimates.base.vram] : [0, 0];
  const add = (part) => {
    for (let i = 0; i < 2; i++) {
      ram[i] += part.ram[i];
      vram[i] += part.vram[i];
    }
  };
  const model = estimates.models[selection.profile];
  if (!model) throw new Error('Unknown model memory estimate');
  if (selection.downloadModels)
    add({ ram: gpu ? model.hostRam : model.cpuRam, vram: gpu ? model.vram : [0, 0] });
  const english = selection.conversationLanguage === 'en';
  if (selection.recognition)
    add(estimates[english ? 'recognitionEnglish' : 'recognitionMultilingual']);
  if (selection.router) add(estimates.router);
  if (selection.voiceMode === 'qwen') add(estimates.voiceQwenCpu);
  else if (selection.voiceMode && selection.voiceMode !== 'off')
    add(estimates[english ? 'voiceEnglish' : 'voiceMultilingual']);
  const freeVram = gpu ? finite(gpu.freeVramMiB) : null;
  const offload = Boolean(
    selection.downloadModels && gpu && vram[1] > (freeVram ?? gpu.vramMiB) / 1024,
  );
  if (offload) ram[1] += model.cpuRam[1];
  const row = (range, total, available) => ({
    estimate: range.map(round),
    total: finite(total),
    available: finite(available),
    remaining:
      finite(available) === null
        ? null
        : [round(available - range[1]), round(available - range[0])],
    exceedsAvailable:
      (finite(available) ?? finite(total)) !== null &&
      range[1] > (finite(available) ?? finite(total)),
  });
  return {
    contextTokens: estimates.contextTokens,
    mode: gpu ? 'gpu' : 'cpu',
    offload,
    ram: row(ram, hardware.ramBytes / 2 ** 30, hardware.availableRamBytes / 2 ** 30),
    vram: row(vram, gpu ? gpu.vramMiB / 1024 : NaN, freeVram === null ? NaN : freeVram / 1024),
  };
}
