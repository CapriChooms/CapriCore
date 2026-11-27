// SPDX-License-Identifier: GPL-3.0-only
import { availableParallelism } from 'node:os';
export const PROFILE_CPU_DEFAULTS = Object.freeze({
  minimal: 2,
  balanced: 4,
  desktop: 4,
  quality: 8,
});

/** Built-in profiles have conservative thread defaults for small computers.
 * CPU execution scales to half the host, capped at eight. Non-default thread
 * counts, GPU execution, model choice and context capacity stay unchanged.
 */
export function cpuExecutionProfile(config, logicalThreads = availableParallelism()) {
  const preset = PROFILE_CPU_DEFAULTS[config.resourceProfile];
  if (
    config.acceleration !== 'cpu' ||
    !Number.isInteger(preset) ||
    (config.cpuThreads !== undefined && config.cpuThreads !== preset)
  )
    return config;
  const threads = Math.min(8, Math.max(1, Math.floor(logicalThreads / 2)));
  return config.cpuThreads === threads ? config : { ...config, cpuThreads: threads };
}

/** Thread budget a hardware profile starts with on a host with `logicalThreads`.
 * Half the logical threads, capped at the profile's ceiling. The minimal
 * profile's ceiling is eight, as cpuExecutionProfile uses; the other profiles
 * keep their presets, so their results do not change.
 */
export function profileCpuThreads(profile, logicalThreads) {
  const half = Math.floor((logicalThreads ?? 1) / 2) || 1;
  const ceiling = profile.id === 'minimal' ? 8 : profile.cpuThreads;
  return Math.max(1, Math.min(ceiling, half));
}
