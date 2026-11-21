// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import {
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempDisposableSync,
  readdirSync,
} from 'node:fs';
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

/** llama.cpp scans its executable directory and working directory for plugins. */
export function createLlamaRuntimeView(executable, scratch, { allowGpu, baseline }) {
  const source = path.dirname(executable);
  const files = LLAMA_VULKAN_FILES.filter((name) => allowGpu || name !== 'ggml-vulkan.dll');
  if (!baseline)
    files.push(
      ...readdirSync(source).filter((name) =>
        /^ggml-cpu-(?!x64\.dll$)[a-z0-9-]+\.dll$/i.test(name),
      ),
    );
  noLinks(scratch);
  mkdirSync(scratch, { recursive: true });
  const view = mkdtempDisposableSync(path.join(scratch, 'worker-'));
  try {
    for (const name of files) {
      const file = noLinks(path.join(source, name));
      if (!lstatSync(file).isFile()) throw new Error('Local engine library is missing.');
      const target = path.join(view.path, name);
      try {
        linkSync(file, target);
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
        copyFileSync(file, target);
      }
    }
    return { executable: path.join(view.path, 'llama-server.exe'), remove: view.remove };
  } catch (error) {
    view.remove();
    throw error;
  }
}
