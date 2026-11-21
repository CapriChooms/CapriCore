// SPDX-License-Identifier: GPL-3.0-only
import benchmark from './model-language-benchmark.json' with { type: 'json' };
import { MODEL_CHOICES } from './model-catalog.mjs';
import { dedicatedGpu, profileRamRequirement } from './memory-budget.mjs';
import { meetsProfileRam } from './profiles.mjs';

/** Keep measured language recommendations within the same hardware envelope as Setup. */
export function recommendModelsForLanguage(language, hardware, { baseLanguage } = {}) {
  if (!Number.isFinite(hardware?.ramBytes)) return [];
  // A regional variant can use its base language's shortlist until a variant
  // benchmark is available. Never add inferred results to the score catalog.
  const measured = Object.hasOwn(benchmark.scores, language) ? language : baseLanguage;
  if (!Object.hasOwn(benchmark.recommendations, measured)) return [];
  const vramGiB = (dedicatedGpu(hardware)?.vramMiB ?? 0) / 1024;
  return benchmark.recommendations[measured]
    .filter((id) => {
      const profile = MODEL_CHOICES.find((item) => item.id === id);
      return (
        profile &&
        meetsProfileRam(hardware.ramBytes / 2 ** 30, profileRamRequirement(profile, hardware)) &&
        (profile.recommendedVramGiB <= 4 || vramGiB >= profile.recommendedVramGiB - 0.125)
      );
    })
    .slice(0, 2);
}
