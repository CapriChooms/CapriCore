// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { assertPrivatePath, writePrivateBytesAtomic } from './safe-file.mjs';

export const deviceSelectionId = (value) =>
  typeof value === 'string' &&
  /^(?:auto|cpu|(?:cuda|rocm|vulkan):\d{1,2}:[a-f0-9]{16})$/.test(value);
export function deviceSettingsFile(root) {
  const file = path.join(root, 'data/desktop/model-devices.json');
  assertPrivatePath(file);
  return file;
}
export function readModelDevices(root, fallback = {}) {
  const file = deviceSettingsFile(root);
  if (!existsSync(file))
    return { schemaVersion: 1, language: fallback.language ?? 'auto', voice: 'auto' };
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1 || info.size > 4096)
    throw Error('Model device settings are unavailable.');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (
    value?.schemaVersion !== 1 ||
    Object.keys(value).some((key) => !['schemaVersion', 'language', 'voice'].includes(key)) ||
    !deviceSelectionId(value.language) ||
    !deviceSelectionId(value.voice)
  )
    throw Error('Invalid model device settings.');
  return value;
}
export function saveModelDevices(root, value) {
  if (
    !value ||
    Object.keys(value).some((key) => !['language', 'voice'].includes(key)) ||
    !deviceSelectionId(value.language) ||
    !deviceSelectionId(value.voice)
  )
    throw Error('Invalid model device selection.');
  const file = deviceSettingsFile(root),
    previous = existsSync(file) ? readFileSync(file) : null;
  writePrivateBytesAtomic(
    file,
    Buffer.from(JSON.stringify({ schemaVersion: 1, ...value }, null, 2) + '\n'),
  );
  return () => {
    if (previous) writePrivateBytesAtomic(file, previous);
    else {
      assertPrivatePath(file);
      unlinkSync(file);
    }
  };
}

/** Only child processes receive these overrides. The parent's environment stays intact. */
export function deviceEnvironment(device) {
  if (device.id === 'auto') return {};
  const env = {
    CUDA_VISIBLE_DEVICES: '-1',
    HIP_VISIBLE_DEVICES: '-1',
    ROCR_VISIBLE_DEVICES: '-1',
    GPU_DEVICE_ORDINAL: '-1',
    GGML_VK_VISIBLE_DEVICES: '-1',
    OLLAMA_VULKAN: '0',
    OLLAMA_LLM_LIBRARY: undefined,
  };
  if (device.id === 'cpu') return env;
  if (
    !deviceSelectionId(device.id) ||
    !Number.isInteger(device.ordinal) ||
    device.ordinal < 0 ||
    device.ordinal > 63
  )
    throw Error('Invalid model device.');
  if (device.backend === 'cuda') env.CUDA_VISIBLE_DEVICES = device.uuid || String(device.ordinal);
  else if (device.backend === 'rocm') {
    // Unset competing masks instead of an empty list (which can hide every
    // ROCm device). Node omits undefined environment values in the child.
    env.CUDA_VISIBLE_DEVICES = undefined;
    env.ROCR_VISIBLE_DEVICES = undefined;
    env.GPU_DEVICE_ORDINAL = undefined;
    env.HIP_VISIBLE_DEVICES = String(device.ordinal);
  } else if (device.backend === 'vulkan') {
    env.GGML_VK_VISIBLE_DEVICES = String(device.ordinal);
    env.OLLAMA_VULKAN = '1';
  } else throw Error('Unsupported GPU backend.');
  return env;
}

export function unrestrictedDeviceEnvironment(env) {
  const result = { ...env };
  for (const key of [
    'CUDA_VISIBLE_DEVICES',
    'HIP_VISIBLE_DEVICES',
    'ROCR_VISIBLE_DEVICES',
    'GPU_DEVICE_ORDINAL',
    'GGML_VK_VISIBLE_DEVICES',
    'OLLAMA_LLM_LIBRARY',
  ])
    delete result[key];
  return result;
}

/** Do not reserve a future voice model on a different explicitly selected GPU. */
export function modelsShareDevice(language, voice) {
  if (language === 'cpu' || voice === 'cpu') return false;
  if (language === 'auto' || voice === 'auto') return true;
  const [left, index] = language.split(':'),
    [right, other] = voice.split(':');
  if (left === right) return index === other;
  return !([left, right].includes('cuda') && [left, right].includes('rocm'));
}
