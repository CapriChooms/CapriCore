// SPDX-License-Identifier: GPL-3.0-only
import { PROFILES, selectProfile, meetsProfileRam } from './profiles.mjs';
import { profileRamRequirement } from './memory-budget.mjs';

/** Optional model choices are not automatic hardware recommendations. */
export const MODEL_CHOICES = Object.freeze([
  ...PROFILES.map((profile) => ({ ...profile, family: 'Qwen3.5' })),
  {
    id: 'ministral-3-3b',
    family: 'Ministral 3',
    model: 'ministral-3:3b',
    alias: 'ministral-3:3b',
    ramGiB: 16,
    recommendedVramGiB: 6,
    contextTokens: 32768,
    contextLimit: 262144,
    cpuThreads: 4,
    voice: 'optional',
    capabilities: ['tools', 'vision'],
    experimental: true,
    description: 'Alternative vision and tool model. Character and tool reliability can differ.',
  },
  {
    id: 'gemma4-e2b',
    family: 'Gemma 4',
    model: 'gemma4:e2b',
    alias: 'gemma4:e2b',
    ramGiB: 24,
    recommendedVramGiB: 12,
    contextTokens: 32768,
    contextLimit: 131072,
    cpuThreads: 4,
    voice: 'optional',
    capabilities: ['tools', 'vision', 'thinking'],
    experimental: true,
    description:
      'Alternative multimodal model. Download size and memory use exceed its active parameter count.',
  },
  {
    id: 'api',
    family: 'API',
    model: 'api',
    alias: 'api',
    ramGiB: 0,
    recommendedVramGiB: 0,
    contextTokens: 32768,
    contextLimit: 131072,
    cpuThreads: 0,
    voice: 'off',
    capabilities: [],
    experimental: false,
    description: 'No local models. Use an external OpenAI-compatible API provider instead.',
  },
]);

export function selectModelChoice(id, hardware) {
  if (PROFILES.some((profile) => profile.id === id)) return selectProfile(id, hardware);
  const choice = MODEL_CHOICES.find((profile) => profile.id === id);
  if (!choice) throw new Error('Unknown language model.');
  if (
    choice.id !== 'api' &&
    !meetsProfileRam(hardware.ramBytes / 2 ** 30, profileRamRequirement(choice, hardware))
  )
    throw new Error('This model needs more system RAM.');
  return {
    ...choice,
    cpuThreads:
      choice.id === 'api'
        ? 0
        : Math.max(
          1,
          Math.min(choice.cpuThreads, Math.floor((hardware.cpuThreads ?? 1) / 2) || 1),
        ),
  };
}
