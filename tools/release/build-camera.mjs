// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchArtifact } from '../../packages/installer/src/download.mjs';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import {
  CALL_CAMERA_FILES,
  CAMERA_RUNTIME_FOLDER,
  CAMERA_LICENSE_FILE,
} from '../../apps/desktop/call-camera-protocol.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const zigFolder = 'zig-x86_64-windows-0.15.2';
const zigSpec = {
  url: `https://ziglang.org/download/0.15.2/${zigFolder}.zip`,
  sha256: '3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c',
  bytes: 92614574,
};

async function compiler(cache) {
  const existing = path.join(cache, zigFolder, 'zig.exe');
  noLinks(existing);
  if (existsSync(existing)) return existing;
  const archive = await fetchArtifact(zigSpec, cache);
  using staging = mkdtempDisposableSync(path.join(cache, 'extract-'));
  await run('tar.exe', ['-xf', archive, '-C', staging.path], {
    windowsHide: true,
    timeout: 120000,
  });
  const candidate = path.join(staging.path, zigFolder);
  noLinks(path.join(candidate, 'zig.exe'));
  if (!existsSync(path.join(candidate, 'zig.exe'))) throw new Error('Zig archive is incomplete.');
  if (!existsSync(existing)) renameSync(candidate, path.dirname(existing));
  return existing;
}

export async function buildCamera(destination = path.join(root, CAMERA_RUNTIME_FOLDER)) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Capri Camera builds on Windows x64.');
  const cache = path.join(root, '.runtime/camera-build-tools');
  noLinks(cache);
  noLinks(destination);
  mkdirSync(cache, { recursive: true });
  mkdirSync(destination, { recursive: true });
  const zig = await compiler(cache);
  const source = path.join(root, 'apps/desktop/native/camera');
  const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(cache, 'cache') };
  using staging = mkdtempDisposableSync(path.join(destination, 'build-'));
  const compile = async (target, file, flags) => {
    try {
      await run(
        zig,
        [
          'c++',
          '-target',
          target,
          '-std=c++17',
          '-O2',
          '-DNOMINMAX',
          '-o',
          path.join(staging.path, file),
          ...flags,
        ],
        { env, windowsHide: true, timeout: 180000, cwd: staging.path },
      );
    } catch (error) {
      throw new Error(
        `Capri Camera compilation failed for ${target}.\n${error.stderr ?? error.message}`,
      );
    }
  };
  const [host, x64, x86] = CALL_CAMERA_FILES;
  await compile('x86_64-windows-gnu', host, [
    '-municode',
    path.join(source, 'camera-host.cpp'),
    '-lole32',
    '-ladvapi32',
  ]);
  for (const [target, file] of [
    ['x86_64-windows-gnu', x64],
    ['x86-windows-gnu', x86],
  ])
    await compile(target, file, [
      '-shared',
      path.join(source, 'camera-filter.cpp'),
      path.join(source, 'camera-filter.def'),
      '-lole32',
      '-lstrmiids',
      '-luuid',
    ]);
  const notices = [
    ['Zig', 'LICENSE'],
    ['LLVM libc++', 'lib/libcxx/LICENSE.TXT'],
    ['LLVM libc++abi', 'lib/libcxxabi/LICENSE.TXT'],
    ['LLVM libunwind', 'lib/libunwind/LICENSE.TXT'],
    ['MinGW-w64', 'lib/libc/mingw/COPYING'],
  ].map(
    ([name, license]) =>
      `${name}\n\n${readFileSync(path.join(path.dirname(zig), license), 'utf8').trim()}`,
  );
  writeFileSync(path.join(staging.path, CAMERA_LICENSE_FILE), notices.join('\n\n') + '\n');
  for (const file of [...CALL_CAMERA_FILES, CAMERA_LICENSE_FILE]) {
    const target = path.join(destination, file);
    noLinks(target);
    renameSync(path.join(staging.path, file), target);
  }
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(await buildCamera());
