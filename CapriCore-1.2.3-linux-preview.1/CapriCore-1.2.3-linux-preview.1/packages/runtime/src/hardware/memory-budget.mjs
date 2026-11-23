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
  const freeVram = gpu ? finite(gpu.freeVramMiB) : null;
  const gpuBudget = gpu ? (freeVram ?? gpu.vramMiB) / 1024 : 0;
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
  else if (selection.voiceMode === 'qwen-ru') add(estimates.voiceQwenRussianCpu);
  else if (selection.voiceMode && selection.voiceMode !== 'off') {
    const voice = estimates[english ? 'voiceEnglish' : 'voiceMultilingual'];
    if (!gpu) add({ ram: voice.cpuRam, vram: [0, 0] });
    else {
      const part = { ram: [], vram: [] };
      for (let i = 0; i < 2; i++) {
        // The production voice keeps T3 on GPU but chooses CPU acoustic
        // decoding when less than 2.5 GiB remains after the backbone loads.
        const decoder =
          gpuBudget - vram[i] - voice.cpuDecoder.vram[i] < estimates.voiceDecoderPromotionGiB
            ? voice.cpuDecoder
            : voice;
        part.ram[i] = decoder.ram[i];
        part.vram[i] = decoder.vram[i];
      }
      add(part);
    }
  }
  const offload = Boolean(selection.downloadModels && gpu && vram[1] > gpuBudget);
  if (offload) {
    for (let i = 0; i < 2; i++) {
      // A small shortage is not a second, complete CPU copy of the LLM.
      // Full spill replaces (rather than duplicates) its host-only overhead.
      const fraction = Math.min(1, Math.max(0, vram[i] - gpuBudget) / model.vram[i]);
      ram[i] += fraction * Math.max(0, model.cpuRam[i] - model.hostRam[i]);
    }
  }
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
