// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  readModelDevices,
  deviceEnvironment,
  unrestrictedDeviceEnvironment,
} from '../model-device-settings.mjs';
const run = promisify(execFile);
const validName = (name) =>
  typeof name === 'string' &&
  name.length > 0 &&
  name.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(name);
export function modelDevice(backend, ordinal, name, extra = {}) {
  if (
    !['cuda', 'rocm', 'vulkan'].includes(backend) ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > 63 ||
    !validName(name)
  )
    return null;
  return {
    id: `${backend}:${ordinal}:${createHash('sha256')
      .update(backend + '\n' + ordinal + '\n' + name)
      .digest('hex')
      .slice(0, 16)}`,
    backend,
    ordinal,
    name,
    available: true,
    ...extra,
  };
}
export function parseLlamaDevices(text, backend) {
  const prefix = { cuda: 'CUDA', rocm: 'ROCm', vulkan: 'Vulkan' }[backend];
  if (!prefix || typeof text !== 'string' || text.length > 65536) return [];
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(CUDA|ROCm|Vulkan)(\d+): (.+) \((\d+) MiB, \d+ MiB free\)\s*$/.exec(line);
    if (!match || match[1] !== prefix) return [];
    const value = modelDevice(backend, Number(match[2]), match[3], {
      totalBytes: Number(match[4]) * 1024 ** 2,
    });
    return value ? [value] : [];
  });
}
export async function probeLanguageDevices(ollama, { runImpl = run } = {}) {
  if (!ollama || !existsSync(ollama)) return [];
  if (/^llama-server(?:\.exe)?$/i.test(path.basename(ollama))) {
    try {
      const env = unrestrictedDeviceEnvironment(process.env);
      for (const key of Object.keys(env)) if (/^(?:LLAMA_|GGML_|VK_)/i.test(key)) delete env[key];
      const result = await runImpl(ollama, ['--list-devices'], {
        env,
        windowsHide: true,
        timeout: 7000,
        maxBuffer: 65536,
        encoding: 'utf8',
      });
      return parseLlamaDevices(result.stdout + '\n' + result.stderr, 'vulkan');
    } catch {
      return [];
    }
  }
  const folder = path.join(path.dirname(ollama), 'lib/ollama'),
    executable = path.join(folder, 'llama-server.exe');
  if (!existsSync(executable)) return [];
  const found = new Map();
  // Ask the shipped backend itself. DXGI/Task Manager and CUDA/Vulkan indices differ.
  for (const [backend, subdir, dll] of [
    ['cuda', 'cuda_v13', 'ggml-cuda.dll'],
    ['cuda', 'cuda_v12', 'ggml-cuda.dll'],
    ['rocm', 'rocm', 'ggml-hip.dll'],
    ['vulkan', 'vulkan', 'ggml-vulkan.dll'],
  ]) {
    if (backend === 'cuda' && [...found.values()].some((x) => x.backend === 'cuda')) continue;
    const plugin = path.join(folder, subdir, dll);
    if (!existsSync(plugin)) continue;
    try {
      const env = unrestrictedDeviceEnvironment(process.env);
      env.GGML_BACKEND_PATH = plugin;
      env.PATH = [path.dirname(plugin), folder, env.PATH ?? env.Path ?? ''].join(path.delimiter);
      const result = await runImpl(executable, ['--list-devices'], {
        env,
        windowsHide: true,
        timeout: 7000,
        maxBuffer: 65536,
        encoding: 'utf8',
      });
      for (const device of parseLlamaDevices(result.stdout + '\n' + result.stderr, backend))
        found.set(device.id, device);
    } catch {
      /* An absent/incompatible backend is not an available device. */
    }
  }
  return [...found.values()];
}
export function migrateLanguageDevice(id, devices) {
  const [, backend, ordinal] = /^(cuda|rocm):(\d{1,2}):[a-f0-9]{16}$/.exec(id) ?? [];
  if (!backend) return devices;
  const matches = devices.filter(
    (item) =>
      item.backend === 'vulkan' && modelDevice(backend, Number(ordinal), item.name)?.id === id,
  );
  return matches.length === 1 ? [...devices, { ...matches[0], id }] : devices;
}
export function parseVoiceDevices(text) {
  const packet = JSON.parse(text);
  if (
    !['cuda', 'rocm'].includes(packet.backend) ||
    !Array.isArray(packet.devices) ||
    packet.devices.length > 64
  )
    throw Error('Invalid voice device inventory.');
  return packet.devices.flatMap((row, index) => {
    if (row.ordinal !== index) throw Error('Invalid voice device ordinal.');
    const rawUuid = typeof row.uuid === 'string' ? row.uuid.replace(/^GPU-/i, '') : '';
    const uuid =
      packet.backend === 'cuda' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(rawUuid)
        ? 'GPU-' + rawUuid
        : undefined;
    const value = modelDevice(packet.backend, row.ordinal, row.name, {
      totalBytes: Number.isSafeInteger(row.totalBytes) ? row.totalBytes : null,
      available: row.available === true,
      ...(row.available !== true
        ? { reason: 'The installed voice runtime cannot execute on this GPU.' }
        : {}),
      ...(uuid ? { uuid } : {}),
    });
    return value ? [value] : [];
  });
}
export async function probeVoiceDevices(
  root,
  python,
  { env = {}, qwen = false, runImpl = run } = {},
) {
  if (!python || !existsSync(python)) return [];
  try {
    const result = await runImpl(
      python,
      ['-m', 'integrations.voice_runtime.device_inventory', ...(qwen ? ['--qwen'] : [])],
      {
        cwd: root,
        env: {
          ...unrestrictedDeviceEnvironment(process.env),
          ...env,
          PYTHONUTF8: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        },
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 65536,
        encoding: 'utf8',
      },
    );
    return parseVoiceDevices(result.stdout);
  } catch {
    return [];
  }
}
export function resolveModelDevice(id, devices) {
  if (id === 'auto' || id === 'cpu') return { id };
  const selected = devices.find((x) => x.id === id && x.available);
  if (!selected)
    throw Error(
      'The selected GPU is unavailable or its device order changed. Choose an available device in Language model settings.',
    );
  return selected;
}
export async function languageDeviceLaunch(root, ollama, { probe = probeLanguageDevices } = {}) {
  const id = readModelDevices(root).language;
  // Native NPU dialogue has its own worker. Ollama remains CPU-only for embeddings.
  if (id.startsWith('npu-')) return { key: id, env: deviceEnvironment({ id: 'cpu' }) };
  const selected = resolveModelDevice(id, id === 'auto' || id === 'cpu' ? [] : await probe(ollama));
  return { key: id, env: deviceEnvironment(selected) };
}
export async function voiceDeviceLaunch(
  root,
  python,
  runtimeEnv,
  { probe = probeVoiceDevices, qwen = false } = {},
) {
  const id = readModelDevices(root).voice;
  const selected = resolveModelDevice(
    id,
    id === 'auto' || id === 'cpu' ? [] : await probe(root, python, { env: runtimeEnv, qwen }),
  );
  return {
    key: id,
    env: {
      ...deviceEnvironment(selected),
      CAPRI_VOICE_COMPUTE_DEVICE: id === 'cpu' ? 'cpu' : id === 'auto' ? 'auto' : 'cuda:0',
      ...(selected.uuid ? { CAPRI_VOICE_GPU_UUID: selected.uuid } : {}),
    },
  };
}
