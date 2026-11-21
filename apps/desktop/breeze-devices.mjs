// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { modelDevice } from '../../packages/runtime/src/hardware/model-devices.mjs';

const execute = promisify(execFile);

export function breezeEnvironment(folder, ordinal) {
  const env = { TEMP: folder, TMP: folder };
  for (const key of ['SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'])
    if (process.env[key]) env[key] = process.env[key];
  if (ordinal !== undefined) env.GGML_VK_VISIBLE_DEVICES = String(ordinal);
  return env;
}

function vulkanRows(stderr) {
  if (typeof stderr !== 'string') return [];
  return Array.from(
    stderr.matchAll(/^ggml_vulkan: \d{1,2} = ([^\r\n]{1,256}) \(([^\r\n)]{1,128})\) \| uma:/gm),
    ([, name, driver]) => ({ name, key: name + '\n' + driver }),
  );
}

async function inspect(engine, { run, signal, ordinal }) {
  // The pinned CLI initializes Vulkan before opening the model. A missing file
  // exposes the inventory without reading weights or synthesizing speech.
  const missing = path.join(engine.cwd, 'capri-device-probe-' + randomUUID() + '.gguf');
  try {
    await run(engine.executable, [missing, '--text', 'probe'], {
      cwd: engine.cwd,
      env: breezeEnvironment(process.env.TEMP ?? engine.cwd, ordinal),
      signal,
      windowsHide: true,
      timeout: 4000,
      maxBuffer: 65536,
      encoding: 'utf8',
    });
  } catch (error) {
    const stderr = error.stderr;
    if (error.code === 1 && typeof stderr === 'string' && stderr.includes('failed to load model'))
      return stderr;
  }
  return '';
}

export async function probeBreezeDevices(engine, { run = execute } = {}) {
  if (!engine) return [];
  const signal = AbortSignal.timeout(7000);
  const visible = vulkanRows(await inspect(engine, { run, signal }));
  const devices = [];
  // ggml reports compacted indices, but the visibility mask uses physical
  // Vulkan indices. Match the default inventory against individually masked probes.
  for (let ordinal = 0; visible.length && ordinal < 64 && !signal.aborted; ordinal++) {
    const stderr = await inspect(engine, { run, signal, ordinal });
    if (!stderr || stderr.includes('Invalid device index')) break;
    const [row] = vulkanRows(stderr);
    if (!row) continue;
    const match = visible.findIndex(({ key }) => key === row.key);
    if (match === -1) continue;
    visible.splice(match, 1);
    const device = modelDevice('vulkan', ordinal, row.name);
    if (device) devices.push(device);
  }
  return devices;
}

export function breezeDeviceMatches(id, stderr) {
  const [, ordinal] = id.split(':');
  const rows = vulkanRows(stderr);
  return rows.length === 1 && modelDevice('vulkan', Number(ordinal), rows[0].name)?.id === id;
}
