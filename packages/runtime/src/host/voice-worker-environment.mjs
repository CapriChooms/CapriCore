// SPDX-License-Identifier: GPL-3.0-only
/** Omit session tokens and interpreter overrides from the inference worker and device probe. */
export function voiceWorkerEnvironment(inherited = process.env) {
  const allowed = new Set([
    'systemroot',
    'windir',
    'systemdrive',
    'path',
    'temp',
    'tmp',
    'home',
    'userprofile',
    'localappdata',
    'appdata',
    'programdata',
    'programfiles',
    'programfiles(x86)',
    'comspec',
    'cuda_visible_devices',
    'hip_visible_devices',
    'rocr_visible_devices',
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(inherited).filter(([key]) => allowed.has(key.toLowerCase())),
    ),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
  };
}
