// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { lstatSync } from 'node:fs';
import { noLinks } from '../huggingface/artifacts.mjs';

export const LLAMA_VULKAN_FILES = Object.freeze([
  'llama-server.exe',
  'llama-server-impl.dll',
  'llama-common.dll',
  'llama.dll',
  'mtmd.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-x64.dll',
  'ggml-vulkan.dll',
  'libomp.dll',
]);

export function llamaBundleReady(executable) {
  return LLAMA_VULKAN_FILES.every((name) => {
    try {
      const info = lstatSync(noLinks(path.join(path.dirname(executable), name)));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  });
}
