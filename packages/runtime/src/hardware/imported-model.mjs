// SPDX-License-Identifier: GPL-3.0-only
export function validateImportedProfile(profile) {
  if (
    !profile ||
    !/^hf-[a-f0-9]{24}$/.test(profile.id) ||
    profile.source !== 'huggingface' ||
    profile.model !== `capri-${profile.id}:latest` ||
    profile.alias !== profile.model ||
    !Number.isInteger(profile.contextLimit) ||
    profile.contextLimit < 8192 ||
    profile.contextLimit > 262144 ||
    !Number.isInteger(profile.contextTokens) ||
    profile.contextTokens < 8192 ||
    profile.contextTokens > profile.contextLimit ||
    !Number.isInteger(profile.cpuThreads) ||
    profile.cpuThreads < 1 ||
    profile.cpuThreads > 256 ||
    !Number.isFinite(profile.ramGiB) ||
    profile.ramGiB <= 0 ||
    profile.ramGiB > 4096 ||
    !Number.isSafeInteger(profile.sizeBytes) ||
    profile.sizeBytes <= 0 ||
    profile.sizeBytes > 4 * 1024 ** 4 ||
    !Array.isArray(profile.capabilities) ||
    profile.capabilities.some((value) => !['vision', 'tools', 'thinking'].includes(value))
  )
    throw new Error('Invalid imported model profile.');
  return profile;
}
