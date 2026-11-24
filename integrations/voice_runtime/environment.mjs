// Select the pinned SDK bundle and Linux venv shared libraries before Python imports.
import { readFileSync, lstatSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

function linuxVenvLibraryPaths(root) {
  if (process.platform === 'win32') return [];
  const candidates = [
    path.join(root, '.runtime/voice-training-venv/lib/python3.11/site-packages/torch/lib'),
    path.join(root, '.runtime/asr-venv/lib/python3.11/site-packages/sherpa_onnx/lib'),
  ];
  const nvidiaDir = path.join(
    root,
    '.runtime/voice-training-venv/lib/python3.11/site-packages/nvidia',
  );
  if (existsSync(nvidiaDir)) {
    for (const entry of readdirSync(nvidiaDir)) {
      const libDir = path.join(nvidiaDir, entry, 'lib');
      if (existsSync(libDir)) candidates.push(libDir);
    }
  }
  return candidates.filter((dir) => existsSync(dir));
}

export function voiceRuntimeEnvironment(root, inherited = process.env) {
  const env = {};
  const extraLibs = linuxVenvLibraryPaths(root);
  if (extraLibs.length > 0) {
    env.LD_LIBRARY_PATH = [...extraLibs, inherited.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  try {
    const file = path.join(root, '.runtime/voice-runtime.json'),
      info = lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 8192) return env;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.profile !== 'amd') return env;
    env.ROCM_SDK_TARGET_FAMILY = 'custom';
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
    return env;
  }
}
