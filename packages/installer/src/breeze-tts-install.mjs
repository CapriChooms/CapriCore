// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import upstream from '../../../config/breeze-tts-upstream.json' with { type: 'json' };
import { writeJsonAtomic } from '../../runtime/src/atomic-json.mjs';
import { processStartedAt } from '../../runtime/src/host/processes.mjs';
import { downloadArtifact, operationLock } from '../../runtime/src/huggingface/artifacts.mjs';
import { runCommand } from './commands.mjs';
import { fetchArtifact, fileHash } from './download.mjs';
import { assertDiskSpace, diskFree, noLinks, readJson } from './policy.mjs';

const { version, runtime, model } = upstream;
const bundleDirectory = (root) => path.resolve(root, 'data/speech/breeze-tts');
const receiptName = 'installed.json';
const receipt = {
  schemaVersion: 1,
  version,
  runtime: runtime.sha256,
  executable: runtime.executableSha256,
  model: model.sha256,
};
const supported = process.platform === 'win32' && process.arch === 'x64';
const archiveInstaller = fileURLToPath(
  new URL('../../../tools/setup/owned-speech.ps1', import.meta.url),
);

function hasFile(folder, name, bytes) {
  const file = path.join(folder, name);
  noLinks(file);
  const info = lstatSync(file);
  return info.isFile() && info.size === bytes;
}

export function installedBreezeTts(root) {
  if (!supported) return null;
  const cwd = path.join(bundleDirectory(root), version);
  try {
    const file = path.join(cwd, receiptName);
    noLinks(file);
    const saved = readJson(file);
    if (
      !Object.entries(receipt).every(([key, value]) => saved[key] === value) ||
      !Object.entries(runtime.files).every(([name, bytes]) => hasFile(cwd, name, bytes)) ||
      !hasFile(cwd, model.path, model.bytes)
    )
      return null;
    return {
      executable: path.join(cwd, 'breeze-cli.exe'),
      model: path.join(cwd, model.path),
      cwd,
    };
  } catch {
    return null;
  }
}

async function unpackArchive(archive, destination, signal) {
  const ownerStamp = processStartedAt(process.pid);
  if (!/^\d+$/u.test(ownerStamp ?? ''))
    throw new Error('The Breeze installer owner could not be verified.');
  const parameters = [
    '-Archive',
    archive,
    '-Destination',
    destination,
    '-MaximumBytes',
    String(300 * 1024 ** 2),
  ];
  await runCommand(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      archiveInstaller,
      '-Component',
      'archive',
      '-OwnerPid',
      String(process.pid),
      '-OwnerStamp',
      ownerStamp,
      '-ArgumentsBase64',
      Buffer.from(JSON.stringify(parameters), 'utf8').toString('base64'),
    ],
    { cwd: destination, signal, timeoutMs: 3 * 60_000 },
  );
}

export async function installBreezeTts({
  root,
  signal,
  progress = () => {},
  downloadRuntime = fetchArtifact,
  downloadModel = downloadArtifact,
} = {}) {
  signal?.throwIfAborted();
  if (!supported) throw new Error('Breeze TTS requires 64-bit Windows.');
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new Error('Breeze installation needs an absolute Capri folder.');
  if (!existsSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/vulkan-1.dll')))
    throw Object.assign(new Error('Breeze TTS requires a Vulkan-capable graphics driver.'), {
      code: 'CAPRI_BREEZE_VULKAN_DRIVER',
    });
  const base = bundleDirectory(root);
  const target = path.join(base, version);
  const stage = path.join(base, '.install');
  const previous = path.join(stage, 'previous');
  const pending = path.join(stage, 'ready');
  const extraction = path.join(stage, 'release');
  const cleanup = () => {
    noLinks(stage);
    rmSync(stage, { force: true, recursive: true, maxRetries: 3 });
  };
  noLinks(base);
  const unlock = operationLock(base);
  let clean = false;
  try {
    noLinks(target);
    noLinks(previous);
    // Restore the previous directory if the process stopped during the commit.
    if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
    cleanup();
    const installed = installedBreezeTts(root);
    if (installed) return installed;
    const total = runtime.bytes + model.bytes;
    assertDiskSpace(base, diskFree(base), total + 300 * 1024 ** 2);
    clean = true;
    mkdirSync(extraction, { recursive: true });
    mkdirSync(pending);
    progress({ received: 0, total });
    const archive = await downloadRuntime(runtime, path.join(stage, 'runtime'), {
      signal,
      progress: ({ received }) => progress({ received, total }),
    });
    signal?.throwIfAborted();
    await unpackArchive(archive, extraction, signal);
    const unpacked = path.join(extraction, runtime.directory);
    for (const [name, bytes] of Object.entries(runtime.files)) {
      if (!hasFile(unpacked, name, bytes)) throw new Error('Invalid Breeze runtime archive.');
      renameSync(path.join(unpacked, name), path.join(pending, name));
    }
    if ((await fileHash(path.join(pending, 'breeze-cli.exe'), signal)) !== runtime.executableSha256)
      throw new Error('Breeze executable checksum verification failed.');

    progress({ received: runtime.bytes, total });
    const weights = await downloadModel(model, path.join(stage, 'weights'), {
      signal,
      onProgress: ({ completed }) => progress({ received: runtime.bytes + completed, total }),
    });
    signal?.throwIfAborted();
    renameSync(weights, path.join(pending, model.path));
    if (!hasFile(pending, model.path, model.bytes)) throw new Error('Invalid Breeze model file.');
    writeJsonAtomic(path.join(pending, receiptName), receipt);

    if (existsSync(target)) renameSync(target, previous);
    try {
      renameSync(pending, target);
    } catch (error) {
      clean = false;
      if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
      clean = true;
      throw error;
    }
    const ready = installedBreezeTts(root);
    if (!ready) throw new Error('Breeze installation could not be verified.');
    progress({ received: total, total });
    return ready;
  } finally {
    try {
      if (clean) cleanup();
    } finally {
      unlock();
    }
  }
}
