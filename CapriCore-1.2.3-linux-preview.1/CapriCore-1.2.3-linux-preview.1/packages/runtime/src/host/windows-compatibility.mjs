// SPDX-License-Identifier: GPL-3.0-only
import { release } from 'node:os';
/** App baseline and vendor runtime requirements are deliberately independent. */
export function windowsCompatibility({ platform = process.platform, version = release() } = {}) {
  if (platform !== 'win32')
    return { supported: false, reason: 'Capri desktop requires Windows x64.' };
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.|$)/.exec(version);
  const build = match ? Number(match[3]) : 0;
  const supported = Number(match?.[1]) >= 10 && build >= 17763;
  return {
    supported,
    build,
    legacy: supported && build < 19045,
    qualification: build >= 19045 ? 'current' : supported ? 'experimental' : 'unsupported',
    minimumBuild: 17763,
    recommendedBuild: 19045,
    features: {
      desktop: supported,
      coding: supported,
      api: supported,
      graphicsCapture: supported && build >= 18362,
      npu: supported && build >= 22621,
      ollamaVendorSupported: supported && build >= 19045,
    },
    reason: !supported
      ? 'Windows 10 1809 (build 17763) x64 or newer is required.'
      : build < 19045
        ? 'Older Windows mode is experimental. AI runtimes and GPU drivers may require a newer Windows build. API mode skips the local conversation model but still uses the local memory service.'
        : '',
  };
}
