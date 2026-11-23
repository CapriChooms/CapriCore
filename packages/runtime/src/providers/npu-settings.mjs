// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  readFileSync,
  lstatSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { assertPrivatePath, writePrivateBytesAtomic } from '../safe-file.mjs';

export const NPU_BACKENDS = Object.freeze(['openvino', 'vitis', 'qnn']);
export const NPU_DEFAULTS = Object.freeze({
  backend: 'openvino',
  modelPath: '',
  python: '',
  contextTokens: 8192,
});
const fail = (code = 'CAPRI_NPU_SETTINGS_INVALID') =>
  Object.assign(new Error('Native NPU settings are unavailable or invalid.'), { code });
export function npuSettings(value = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(NPU_DEFAULTS, key))
  )
    throw fail();
  const result = { ...NPU_DEFAULTS, ...value };
  if (
    !NPU_BACKENDS.includes(result.backend) ||
    !Number.isInteger(result.contextTokens) ||
    result.contextTokens < 1024 ||
    result.contextTokens > 32768
  )
    throw fail();
  for (const key of ['python', 'modelPath']) {
    const file = result[key];
    if (
      typeof file !== 'string' ||
      file.length > 2048 ||
      /[\x00-\x1f]/.test(file) ||
      (file && (!path.isAbsolute(file) || /^(?:\\\\|\/\/)/.test(file)))
    )
      throw fail();
    if (file) result[key] = path.resolve(file);
  }
  return result;
}
export function readNpuSettings(root) {
  const file = path.join(root, 'data/desktop/npu-model.json');
  assertPrivatePath(file);
  if (!existsSync(file)) return npuSettings();
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192) throw fail();
  return npuSettings(JSON.parse(readFileSync(file, 'utf8')));
}
export function saveNpuSettings(root, value) {
  const settings = npuSettings(value),
    file = path.join(root, 'data/desktop/npu-model.json');
  assertPrivatePath(file);
  const previous = existsSync(file) ? readFileSync(file) : null;
  writePrivateBytesAtomic(file, Buffer.from(JSON.stringify(settings, null, 2) + '\n'));
  return () => {
    if (previous) writePrivateBytesAtomic(file, previous);
    else {
      assertPrivatePath(file);
      unlinkSync(file);
    }
  };
}
const within = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};
/** Only local model data, never an executable model repository or external tensors. */
export function validateNpuModel(value) {
  const settings = npuSettings(value),
    folder = settings.modelPath;
  if (!folder || !existsSync(folder)) throw fail('CAPRI_NPU_MODEL_MISSING');
  const base = lstatSync(folder);
  if (!base.isDirectory() || base.isSymbolicLink()) throw fail('CAPRI_NPU_MODEL_INVALID');
  const canonical = realpathSync(folder);
  let entries = 0,
    bytes = 0;
  const walk = (directory, depth = 0) => {
    if (depth > 8) throw fail('CAPRI_NPU_MODEL_INVALID');
    for (const row of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 4096) throw fail('CAPRI_NPU_MODEL_INVALID');
      const file = path.join(directory, row.name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink() || !within(canonical, realpathSync(file)))
        throw fail('CAPRI_NPU_MODEL_INVALID');
      if (stat.isDirectory()) walk(file, depth + 1);
      else if (!stat.isFile() || stat.nlink !== 1) throw fail('CAPRI_NPU_MODEL_INVALID');
      else if (/\.(?:exe|dll|pyd|py|ps1|cmd|bat|js|mjs|cjs)$/i.test(row.name))
        throw fail('CAPRI_NPU_MODEL_INVALID');
      else bytes += stat.size;
    }
  };
  walk(folder);
  const read = (name) => {
    const file = path.join(folder, name),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw fail('CAPRI_NPU_MODEL_INVALID');
    return readFileSync(file, 'utf8');
  };
  const checkReferences = (value) => {
    if (Array.isArray(value)) return value.forEach(checkReferences);
    if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (
          /^(?:filename|.*_path|external_data|external_data_file|location)$/i.test(key) &&
          typeof item === 'string'
        ) {
          if (
            path.isAbsolute(item) ||
            /^[A-Za-z]:|^\\\\|^\/\//.test(item) ||
            !within(folder, path.resolve(folder, item))
          )
            throw fail('CAPRI_NPU_MODEL_INVALID');
        }
        if (/^(?:custom_ops_library|custom_op_library|custom_ops_library_path)$/i.test(key))
          throw fail('CAPRI_NPU_MODEL_INVALID');
        checkReferences(item);
      }
  };
  if (settings.backend === 'openvino') {
    for (const name of [
      'openvino_model.xml',
      'openvino_tokenizer.xml',
      'openvino_detokenizer.xml',
    ]) {
      const xml = read(name);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('CAPRI_NPU_MODEL_INVALID');
      if (!existsSync(path.join(folder, name.replace(/\.xml$/, '.bin'))))
        throw fail('CAPRI_NPU_MODEL_INVALID');
    }
  } else {
    const config = JSON.parse(read('genai_config.json'));
    checkReferences(config);
    const providers = JSON.stringify(
      config.model?.decoder?.session_options?.provider_options ?? [],
    );
    const expected = settings.backend === 'vitis' ? /vitisai|ryzenai/i : /qnn/i;
    if (
      !expected.test(providers) ||
      /DirectML|DmlExecutionProvider|CUDAExecutionProvider/i.test(providers)
    )
      throw fail('CAPRI_NPU_PROVIDER_MISMATCH');
  }
  return { settings, bytes, files: entries };
}

export const npuBackendForDevice = (id) =>
  /^npu-(openvino|vitis|qnn):\d{1,2}:[a-f0-9]{16}$/.exec(id ?? '')?.[1] ?? null;
