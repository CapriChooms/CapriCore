// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { release } from 'node:os';
import { promisify } from 'node:util';
import packs from '../../config/npu-models.json' with { type: 'json' };
import {
  downloadArtifact,
  noLinks,
  operationLock,
  safeFileName,
} from '../../packages/runtime/src/huggingface/artifacts.mjs';
import { NpuInference, npuPython } from '../../packages/runtime/src/providers/npu-inference.mjs';
import { readNpuSettings } from '../../packages/runtime/src/providers/npu-settings.mjs';

const run = promisify(execFile);
const powershell = (args, options) =>
  run(
    path.join(
      process.env.SystemRoot ?? 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    ['-NoProfile', '-NonInteractive', ...args],
    { windowsHide: true, maxBuffer: 256 * 1024, ...options },
  );
const amdRuntimeRequired = 'Install AMD Ryzen AI Software 1.9 or newer, then refresh devices.';
const driverRequired = 'Install or enable the NPU driver in Windows, then refresh devices.';
const windowsRequired = 'This NPU setup requires a newer version of Windows 11.';
const labels = { openvino: 'Intel NPU', vitis: 'AMD Ryzen AI NPU', qnn: 'Qualcomm NPU' };
const installLinks = {
  openvino: 'https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html',
  vitis: 'https://ryzenai.docs.amd.com/en/latest/inst.html',
};
const windowsBuild = () => Number(release().split('.').at(-1));
const amdNpuId = /VEN_1022&DEV_(?:1502|17F0|17F2|17F3|1B0B|1B0C)\b/i;

export function identifyNpus(rows) {
  const found = new Map();
  for (const row of rows) {
    const id = String(row.PNPDeviceID ?? '');
    const name = String(row.Name ?? '');
    const accelerator = row.PNPClass === 'ComputeAccelerator';
    const npuName = /\b(?:NPU|IPU Device|XDNA|AI Boost)\b/i.test(name);
    if (!accelerator && !npuName && !amdNpuId.test(id)) continue;
    const backend =
      /VEN_1022&|AMDI[0-9A-F]{4}/i.test(id) || /\b(?:AMD|Ryzen)\b/i.test(name)
        ? 'vitis'
        : /VEN_8086&/i.test(id) || /\bIntel\b/i.test(name)
          ? 'openvino'
          : null;
    if (!backend) continue;
    const driverReady = row.ConfigManagerErrorCode === 0;
    found.set(backend, Boolean(found.get(backend)) || driverReady);
  }
  return [...found].map(([backend, driverReady]) => ({ backend, driverReady }));
}

export async function discoverNpus() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return [];
  try {
    const { stdout } = await powershell(
      [
        '-Command',
        'Get-CimInstance Win32_PnPEntity -Filter "Present = TRUE" | ' +
          'Where-Object { $_.PNPClass -eq "ComputeAccelerator" -or ' +
          String.raw`$_.Name -match "\b(NPU|IPU Device|XDNA|AI Boost)\b" -or ` +
          '$_.PNPDeviceID -match "' +
          amdNpuId.source +
          '" } | ' +
          'Select-Object PNPClass,PNPDeviceID,Name,ConfigManagerErrorCode | ConvertTo-Json -Compress',
      ],
      { timeout: 6500 },
    );
    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    return identifyNpus(Array.isArray(rows) ? rows : [rows]);
  } catch {
    return [];
  }
}

function officialAmdPython() {
  const base = path.join(
    process.env.ProgramW6432 ?? process.env.ProgramFiles ?? 'C:/Program Files',
    'RyzenAI',
  );
  try {
    for (const entry of readdirSync(noLinks(base), { withFileTypes: true })
      .filter(
        (item) =>
          item.isDirectory() &&
          /^ryzen-ai-(?:1\.(?:9|\d{2,})|[2-9]\d*\.\d+)\.\d+$/i.test(item.name),
      )
      .sort((left, right) => right.name.localeCompare(left.name, 'en', { numeric: true }))) {
      const python = path.join(base, entry.name, 'Scripts/python.exe');
      try {
        const info = lstatSync(noLinks(python));
        if (info.isFile()) return python;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } catch {
    // Unreadable vendor locations are never used to launch an interpreter.
  }
  return '';
}

export async function prepareIntelNpu(root) {
  await powershell(
    [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools/setup/setup-npu.ps1'),
      '-ProjectRoot',
      root,
    ],
    { timeout: 900000 },
  ).catch(() => {
    throw new Error('Intel NPU runtime preparation failed. Check the connection and try again.');
  });
}

async function downloadPack(root, backend, pack, onProgress, download = downloadArtifact) {
  const base = path.join(root, 'data/models/npu', backend, pack.revision.slice(0, 12));
  const folder = noLinks(path.join(base, 'model'));
  const unlock = operationLock(base);
  try {
    mkdirSync(folder, { recursive: true });
    const total = pack.files.reduce((sum, file) => sum + file.bytes, 0);
    let completed = 0;
    for (const spec of pack.files) {
      const relative = safeFileName(spec.path);
      const target = noLinks(path.join(folder, relative));
      if (spec.bytes === 0) {
        mkdirSync(path.dirname(target), { recursive: true });
        try {
          writeFileSync(target, '', { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const info = lstatSync(target);
          if (!info.isFile() || info.nlink !== 1 || info.size !== 0) throw error;
        }
      } else {
        const blob = await download(
          {
            ...spec,
            url: `https://huggingface.co/${pack.repo}/resolve/${pack.revision}/${relative.split('/').map(encodeURIComponent).join('/')}`,
          },
          path.join(base, 'transfer'),
          {
            onProgress: (progress) =>
              onProgress(Math.floor((100 * (completed + progress.completed)) / total)),
            existingFile: target,
          },
        );
        if (blob !== target) {
          mkdirSync(path.dirname(target), { recursive: true });
          renameSync(blob, target);
        }
      }
      completed += spec.bytes;
      onProgress(Math.floor((100 * completed) / total));
    }
    return folder;
  } finally {
    unlock();
  }
}

export class NpuSetupService {
  constructor({
    root,
    discover = discoverNpus,
    amdPython = officialAmdPython,
    build = windowsBuild,
    installIntel = prepareIntelNpu,
    downloadModel = downloadPack,
    Inference = NpuInference,
  }) {
    Object.assign(this, {
      root,
      discover,
      amdPython,
      build,
      installIntel,
      downloadModel,
      Inference,
    });
  }

  async options() {
    let saved;
    try {
      const config = readNpuSettings(this.root);
      if (existsSync(config.modelPath) && existsSync(npuPython(this.root, config)))
        saved = new this.Inference({ root: this.root, config });
    } catch {
      // Keep CPU/GPU selectable if the optional NPU settings are damaged.
    }
    const result = (await this.discover())
      .filter(({ backend }) => Object.hasOwn(packs, backend) && backend !== saved?.config.backend)
      .map(({ backend, driverReady }) => {
        const pack = packs[backend];
        const prerequisite = !driverReady
          ? driverRequired
          : this.build() < (backend === 'vitis' ? 26100 : 22621)
            ? windowsRequired
            : backend === 'vitis' && !this.amdPython()
              ? amdRuntimeRequired
              : null;
        return {
          id: 'npu-setup-' + backend,
          name: labels[backend],
          backend: 'npu',
          available: !prerequisite,
          npuSetup: backend,
          model: pack.name,
          bytes: pack.files.reduce((sum, file) => sum + file.bytes, 0),
          reason: prerequisite,
          installLink:
            prerequisite !== windowsRequired && Boolean(prerequisite && installLinks[backend]),
        };
      });
    if (saved)
      result.unshift({
        id: saved.deviceId,
        name: labels[saved.config.backend],
        backend: 'npu',
        available: true,
      });
    return result;
  }

  openInstallGuide(backend, open) {
    if (!Object.hasOwn(installLinks, backend)) throw new Error('Unknown NPU installer.');
    return open(installLinks[backend]);
  }

  async prepare(deviceId) {
    if (this.status) throw new Error('NPU setup is already running.');
    this.status = { stage: 'runtime' };
    let candidate;
    try {
      const device = (await this.options()).find(({ id }) => id === deviceId);
      if (!device?.available) throw new Error(device?.reason ?? driverRequired);
      let config;
      if (device.npuSetup) {
        const backend = device.npuSetup;
        const pack = packs[backend];
        const python = backend === 'vitis' ? this.amdPython() : '';
        if (backend === 'vitis' && !python) throw new Error(amdRuntimeRequired);
        if (backend === 'openvino' && !npuPython(this.root, { backend, python }))
          await this.installIntel(this.root);
        const runtime = new this.Inference({
          root: this.root,
          config: { backend, python, modelPath: '' },
        });
        try {
          const probe = await runtime.probe();
          if (backend === 'openvino' && !probe.available) throw new Error(driverRequired);
        } finally {
          runtime.stop();
        }
        this.status = { stage: 'download', percent: 0 };
        const modelPath = await this.downloadModel(this.root, backend, pack, (percent) => {
          this.status = { stage: 'download', percent };
        });
        config = { backend, python, modelPath, contextTokens: pack.contextTokens };
      } else {
        config = readNpuSettings(this.root);
      }
      this.status = { stage: 'test' };
      candidate = new this.Inference({ root: this.root, config });
      if (!(await candidate.test())?.ready)
        throw new Error('The NPU could not generate a test reply.');
      return { config, deviceId: candidate.deviceId };
    } finally {
      candidate?.stop();
      this.status = null;
    }
  }
}
