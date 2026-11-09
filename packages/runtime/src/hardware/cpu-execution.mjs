// SPDX-License-Identifier: GPL-3.0-only
import { availableParallelism } from 'node:os';
import { PROFILES } from './profiles.mjs';

/** Built-in profiles have conservative thread defaults for small computers.
 * CPU execution scales to half the host, capped at eight. Non-default thread
 * counts, GPU execution, model choice and context capacity stay unchanged.
 */
export function cpuExecutionProfile(config, logicalThreads = availableParallelism()) {
  const profile = PROFILES.find((item) => item.id === config.resourceProfile);
  if (
    config.acceleration !== 'cpu' ||
    !profile ||
    (config.cpuThreads !== undefined && config.cpuThreads !== profile.cpuThreads)
  )
    return config;
  const threads = Math.min(8, Math.max(1, Math.floor(logicalThreads / 2)));
  return config.cpuThreads === threads ? config : { ...config, cpuThreads: threads };
}
