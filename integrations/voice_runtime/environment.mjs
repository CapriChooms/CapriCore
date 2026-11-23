// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
/** Select the pinned SDK bundle, not a GPU ISA override. Required before Python .pth imports. */
export function voiceRuntimeEnvironment(root, inherited = process.env) {
  try {
    const file = path.join(root, '.runtime/voice-runtime.json'),
      info = lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 8192) return {};
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.profile !== 'amd') return {};
    const env = { ROCM_SDK_TARGET_FAMILY: 'custom' };
    for (const key of ['HIP_VISIBLE_DEVICES', 'CUDA_VISIBLE_DEVICES'])
      if (typeof inherited[key] === 'string') env[key] = inherited[key];
    if (
      env.HIP_VISIBLE_DEVICES === undefined &&
      env.CUDA_VISIBLE_DEVICES === undefined &&
      Number.isInteger(value.hipVisibleDevice) &&
      value.hipVisibleDevice >= 0 &&
      value.hipVisibleDevice < 8
    )
      env.HIP_VISIBLE_DEVICES = String(value.hipVisibleDevice);
    return env;
  } catch {
    return {};
  }
}
