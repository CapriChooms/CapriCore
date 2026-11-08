// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
/** Select the pinned SDK bundle, not a GPU ISA override. Required before Python .pth imports. */
export function voiceRuntimeEnvironment(root) {
  try {
    const file = path.join(root, '.runtime/voice-runtime.json'),
      info = lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 8192) return {};
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value.profile === 'amd' ? { ROCM_SDK_TARGET_FAMILY: 'custom' } : {};
  } catch {
    return {};
  }
}
