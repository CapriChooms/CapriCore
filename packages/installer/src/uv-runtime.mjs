// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { noLinks, readJson } from './policy.mjs';
import { fetchArtifact, fileHash } from './download.mjs';
import { runCommand } from './commands.mjs';
import { writeJsonAtomic } from '../../runtime/src/atomic-json.mjs';
import { processStartedAt } from '../../runtime/src/host/processes.mjs';

function owned(root, relative) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) throw Error('The uv runtime must stay inside Capri.');
  noLinks(file);
  return file;
}

/** Verified local uv only. Does not install Python, models, packages or a voice. */
export async function ensureUv({
  root,
  env,
  signal,
  execute = runCommand,
  download = fetchArtifact,
  emit = () => {},
  ownerStamp = () => processStartedAt(process.pid),
} = {}) {
  if (!path.isAbsolute(root)) throw Error('Runtime preparation needs an absolute Capri folder.');
  root = path.resolve(root);
  signal?.throwIfAborted();
  const started = performance.now();
  const report = (runtimePhase) =>
    emit({
      stage: 'dependencies',
      progress: 0,
      runtimePhase,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    });
  const spec = readJson(owned(root, 'config/installer.json')).artifacts.uv;
  if (
    spec.directory !== 'uv' ||
    !/^\d+\.\d+\.\d+$/u.test(spec.version) ||
    spec.url !==
      `https://github.com/astral-sh/uv/releases/download/${spec.version}/uv-x86_64-pc-windows-msvc.zip` ||
    !/^[a-f0-9]{64}$/u.test(spec.sha256) ||
    !Number.isSafeInteger(spec.bytes) ||
    spec.bytes <= 0 ||
    spec.bytes > 64 * 1024 ** 2
  )
    throw Error('Invalid pinned uv runtime.');
  const executable = owned(root, '.runtime/uv/uv.exe'),
    receipt = owned(root, '.runtime/installer/uv.json');
  report('receipt-check');
  let ready = false;
  try {
    const installed = readJson(receipt);
    ready =
      installed.sha256 === spec.sha256 &&
      installed.executableSha256 === (await fileHash(executable));
  } catch {}
  if (!ready) {
    const cache = owned(root, '.runtime/installer');
    mkdirSync(cache, { recursive: true });
    report('archive-fetch');
    const archive = await download(spec, path.join(cache, 'downloads'), { signal });
    signal?.throwIfAborted();
    report('archive-ready');
    report('owner-check');
    const stamp = ownerStamp();
    if (!/^[0-9]+$/u.test(stamp ?? ''))
      throw Error('The runtime preparation owner could not be verified.');
    report('owner-ready');
    const args = [
      '-Archive',
      archive,
      '-Destination',
      owned(root, '.runtime/uv'),
      '-MaximumBytes',
      String(128 * 1024 ** 2),
    ];
    report('extract-start');
    await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        owned(root, 'tools/setup/owned-speech.ps1'),
        '-Component',
        'archive',
        '-OwnerPid',
        String(process.pid),
        '-OwnerStamp',
        stamp,
        '-ArgumentsBase64',
        Buffer.from(JSON.stringify(args), 'utf8').toString('base64'),
      ],
      { cwd: root, env, signal, timeoutMs: 10 * 60 * 1000 },
    );
    signal?.throwIfAborted();
    report('extract-done');
    report('verify-start');
    noLinks(executable);
    if (!existsSync(executable)) throw Error('The required uv runtime could not be installed.');
    writeJsonAtomic(receipt, {
      sha256: spec.sha256,
      version: spec.version,
      executableSha256: await fileHash(executable),
    });
  }
  signal?.throwIfAborted();
  report('ready');
  return executable;
}
