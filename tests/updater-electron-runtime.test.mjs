// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { ensureElectronRuntime } from '../packages/installer/src/electron-runtime.mjs';
import {
  ELECTRON_RUNTIME_FILES,
  electronBundleReady,
} from '../packages/runtime/src/host/electron-bundle.mjs';
const parent = path.resolve('.runtime/electron-update-unit');
mkdirSync(parent, { recursive: true });
function put(root, file, value) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}
function bundle(root) {
  for (const file of ELECTRON_RUNTIME_FILES) put(root, 'dist/' + file, 'verified fixture');
  put(root, 'dist/version', '45.0.0');
}
function fixture() {
  const root = mkdtempSync(path.join(parent, 'case-'));
  put(root, 'package.json', JSON.stringify({ devDependencies: { electron: '45.0.0' } }));
  put(
    root,
    'config/installer.json',
    JSON.stringify({
      artifacts: {
        electron: {
          version: '45.0.0',
          sha256: 'a'.repeat(64),
          bytes: 10,
          url: 'https://github.com/electron/electron/releases/download/v45.0.0/electron.zip',
        },
      },
    }),
  );
  const directory = path.join(root, 'node_modules/electron');
  put(directory, 'package.json', JSON.stringify({ version: '45.0.0' }));
  const calls = [];
  const options = {
    download: async (spec, cache) => {
      calls.push(['download', spec.sha256, cache]);
      return path.join(root, 'verified.zip');
    },
    command: async (file, args) => {
      calls.push(['extract', file]);
      bundle(path.dirname(args[args.indexOf('-Destination') + 1]));
    },
  };
  return { root, directory, calls, options };
}
test('an intact desktop is retained without a download and receives a valid executable entry', async () => {
  const f = fixture();
  bundle(f.directory);
  assert.equal(await ensureElectronRuntime(f.root, f.options), false);
  assert.deepEqual(f.calls, []);
  assert.equal(readFileSync(path.join(f.directory, 'path.txt'), 'utf8'), 'electron.exe');
});
test('a package-only npm install is repaired with the pinned archive before restart', async () => {
  const f = fixture();
  assert.equal(electronBundleReady(f.directory, '45.0.0'), false);
  assert.equal(await ensureElectronRuntime(f.root, f.options), true);
  assert.equal(electronBundleReady(f.directory, '45.0.0'), true);
  assert.equal(f.calls[0][0], 'download');
  assert.equal(f.calls[0][1], 'a'.repeat(64));
  assert.equal(f.calls[1][0], 'extract');
});
test('an unverified download or incomplete archive cannot replace the previous runtime', async () => {
  const f = fixture();
  put(f.directory, 'dist/retained.txt', 'previous incomplete files');
  f.options.download = async () => {
    throw Error('checksum failure');
  };
  await assert.rejects(ensureElectronRuntime(f.root, f.options), /checksum/);
  assert.equal(
    readFileSync(path.join(f.directory, 'dist/retained.txt'), 'utf8'),
    'previous incomplete files',
  );
  f.options.download = async () => path.join(f.root, 'archive.zip');
  f.options.command = async (_file, args) =>
    put(args[args.indexOf('-Destination') + 1], 'version', '45.0.0');
  await assert.rejects(ensureElectronRuntime(f.root, f.options), /incomplete/);
  assert.equal(existsSync(path.join(f.directory, 'dist/retained.txt')), true);
});
test('a dependency version mismatch fails before downloading or replacing anything', async () => {
  const f = fixture();
  put(f.directory, 'package.json', JSON.stringify({ version: '46.0.0' }));
  await assert.rejects(ensureElectronRuntime(f.root, f.options), /differs/);
  assert.deepEqual(f.calls, []);
});
