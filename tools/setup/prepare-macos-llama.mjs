// SPDX-License-Identifier: GPL-3.0-only
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempDisposableSync,
  readdirSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import lock from '../../config/upstream-lock.json' with { type: 'json' };
import {
  bundledLlamaPath,
  LLAMA_METAL_FILES,
} from '../../packages/runtime/src/host/llama-bundle.mjs';
import {
  fileHash,
  noLinks,
  operationLock,
} from '../../packages/runtime/src/huggingface/artifacts.mjs';

const [root, archive, ...extra] = process.argv.slice(2);
if (!root || extra.length || process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(
    'Usage on Apple Silicon: node tools/setup/prepare-macos-llama.mjs <runtime root> [release archive]',
  );
}
mkdirSync(path.resolve(root), { recursive: true });
const target = path.dirname(bundledLlamaPath(realpathSync(root), lock.llama.version, 'darwin'));
const cache = path.dirname(target);
const release = operationLock(cache);
try {
  using stage = mkdtempDisposableSync(path.join(cache, '.macos-llama-'));
  const source = path.join(stage.path, 'release.tar.gz');
  const prefix = `llama-${lock.llama.version}`;
  if (archive) copyFileSync(archive, source);
  else {
    const url = `https://github.com/ggml-org/llama.cpp/releases/download/${lock.llama.version}/${prefix}-bin-macos-arm64.tar.gz`;
    execFileSync(
      '/usr/bin/curl',
      [
        '--disable',
        '--fail',
        '--location',
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '--retry',
        '3',
        '--max-time',
        '180',
        '--max-filesize',
        String(lock.llama.macosArm64ArchiveBytes),
        '--output',
        source,
        url,
      ],
      { stdio: 'inherit' },
    );
  }
  if (
    lstatSync(source).size !== lock.llama.macosArm64ArchiveBytes ||
    (await fileHash(source)) !== lock.llama.macosArm64ArchiveSha256
  ) {
    throw new Error('The macOS llama.cpp archive differs from its pinned size or SHA-256.');
  }
  execFileSync('/usr/bin/tar', ['-xzf', source, '-C', stage.path]);
  const unpacked = path.join(stage.path, prefix);
  const ready = path.join(stage.path, 'ready');
  mkdirSync(ready);
  // dyld resolves these install names at @rpath beside the server. Copy only
  // their regular payloads, so distribution tools need not preserve symlinks.
  const files = [...LLAMA_METAL_FILES, 'LICENSE'];
  for (const name of files) {
    const original = realpathSync(path.join(unpacked, name));
    if (path.dirname(original) !== unpacked || !lstatSync(original).isFile())
      throw new Error(`Unexpected release payload for ${name}.`);
    copyFileSync(original, path.join(ready, name));
  }
  noLinks(target);
  const previous = path.join(stage.path, 'previous');
  if (existsSync(target)) {
    if (
      readdirSync(target).some(
        (name) => !files.includes(name) || !lstatSync(path.join(target, name)).isFile(),
      )
    ) {
      throw new Error(`Unexpected entries in the managed runtime directory: ${target}`);
    }
    renameSync(target, previous);
  }
  try {
    renameSync(ready, target);
  } catch (error) {
    if (existsSync(previous)) renameSync(previous, target);
    throw error;
  }
  console.log(path.join(target, 'llama-server'));
} finally {
  release();
}
