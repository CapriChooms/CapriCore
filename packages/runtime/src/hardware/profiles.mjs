/** Conservative planning estimates, not promises of measured latency or GPU support. */
import { profileRamRequirement } from './memory-budget.mjs';
import { PROFILE_CPU_DEFAULTS } from './cpu-execution.mjs';
export const PROFILES = Object.freeze([
  {
    id: 'minimal',
    model: 'qwen3.5:0.8b',
    alias: 'capri-qwen3.5:0.8b',
    ramGiB: 8,
    recommendedVramGiB: 0,
    contextTokens: 32768,
    cpuThreads: PROFILE_CPU_DEFAULTS.minimal,
    voice: 'off',
    description: 'CPU text mode; reduced quality and potentially long replies.',
  },
  {
    id: 'balanced',
    model: 'qwen3.5:2b',
    alias: 'capri-qwen3.5:2b',
    ramGiB: 16,
    recommendedVramGiB: 4,
    contextTokens: 32768,
    cpuThreads: PROFILE_CPU_DEFAULTS.balanced,
    voice: 'optional',
    description: 'Text-first default. Ollama may accelerate it when a supported GPU is available.',
  },
  {
    id: 'desktop',
    model: 'qwen3.5:4b',
    alias: 'capri-qwen3.5:4b',
    ramGiB: 24,
    recommendedVramGiB: 8,
    contextTokens: 32768,
    cpuThreads: PROFILE_CPU_DEFAULTS.desktop,
    voice: 'optional',
    description:
      'Recommended with at least 8 GiB confirmed discrete VRAM; CPU execution is slower.',
  },
  {
    id: 'quality',
    model: 'qwen3.5:9b',
    alias: 'capri-qwen3.5:9b',
    ramGiB: 32,
    recommendedVramGiB: 12,
    contextTokens: 32768,
    cpuThreads: PROFILE_CPU_DEFAULTS.quality,
    voice: 'optional',
    description:
      'Existing quality baseline; recommend 12+ GiB confirmed discrete VRAM. Speech uses additional resources.',
  },
]);
/** Allow bounded firmware/iGPU reservations without presenting usable RAM as installed RAM. */
export function meetsProfileRam(ramGiB, requiredGiB) {
  const reservation = Math.max(0.5, Math.min(2, requiredGiB / 16));
  return (
    Number.isFinite(ramGiB) &&
    Number.isFinite(requiredGiB) &&
    requiredGiB > 0 &&
    ramGiB >= requiredGiB - reservation
  );
}
export function recommendProfile(hardware) {
  const ram = hardware.ramBytes / 2 ** 30;
  if (!meetsProfileRam(ram, 8))
    return {
      supported: false,
      profile: null,
      reasons: ['The first supported profile requires at least 8 GiB RAM.'],
    };
  const gpus = hardware.gpus ?? [];
  // Shared/unknown memory and multiple cards never get counted as one large GPU.
  const vram = Math.max(
    0,
    ...gpus
      .filter((gpu) => gpu.memoryKind === 'dedicated' && Number.isFinite(gpu.vramMiB))
      .map((gpu) => gpu.vramMiB / 1024),
  );
  const id =
    meetsProfileRam(ram, profileRamRequirement(PROFILES[3], hardware)) && vram >= 12 - 0.125
      ? 'quality'
      : meetsProfileRam(ram, profileRamRequirement(PROFILES[2], hardware)) && vram >= 8 - 0.125
        ? 'desktop'
        : meetsProfileRam(ram, profileRamRequirement(PROFILES[1], hardware))
          ? 'balanced'
          : 'minimal';
  const profile = PROFILES.find((item) => item.id === id);
  return {
    supported: true,
    profile: {
      ...profile,
      cpuThreads: Math.max(
        1,
        Math.min(profile.cpuThreads, Math.floor((hardware.cpuThreads ?? 1) / 2) || 1),
      ),
    },
    reasons: [
      `Detected ${ram.toFixed(1)} GiB RAM.`,
      vram
        ? `Largest confirmed dedicated GPU: ${vram.toFixed(1)} GiB.`
        : 'Dedicated VRAM is unknown; a conservative text profile is selected.',
      'Ollama decides actual text acceleration. CUDA speech must be installed and checked separately.',
    ],
  };
}
export function selectProfile(id, hardware) {
  const profile = PROFILES.find((item) => item.id === id);
  if (!profile) throw new Error('Unknown hardware profile');
  const requiredRam = profileRamRequirement(profile, hardware);
  if (!meetsProfileRam(hardware.ramBytes / 2 ** 30, requiredRam))
    throw new Error(
      `${id} requires at least ${requiredRam} GiB RAM for the detected GPU/CPU configuration.`,
    );
  return {
    ...profile,
    cpuThreads: Math.max(
      1,
      Math.min(profile.cpuThreads, Math.floor((hardware.cpuThreads ?? 1) / 2) || 1),
    ),
  };
}
