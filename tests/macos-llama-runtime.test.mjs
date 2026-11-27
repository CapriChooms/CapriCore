// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempDisposableSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  bundledLlamaPath,
  llamaBundleReady,
  LLAMA_METAL_FILES,
} from '../packages/runtime/src/host/llama-bundle.mjs';
import {
  parseLlamaDevices,
  languageDeviceLaunch,
} from '../packages/runtime/src/hardware/model-devices.mjs';
import { saveModelDevices } from '../packages/runtime/src/model-device-settings.mjs';

test('managed Metal runtime requires the real Darwin libraries beside the executable', () => {
  using folder = mkdtempDisposableSync(path.join(realpathSync(os.tmpdir()), 'capri-metal-'));
  const executable = bundledLlamaPath(folder.path, 'b12317', 'darwin');
  const directory = path.dirname(executable);
  mkdirSync(directory, { recursive: true });
  for (const name of LLAMA_METAL_FILES) writeFileSync(path.join(directory, name), 'fixture');
  assert.equal(llamaBundleReady(executable), true);
  writeFileSync(path.join(directory, 'libggml-metal.0.dylib'), '');
  assert.equal(llamaBundleReady(executable), false);
});

test('the reported MTL ordinal can be saved and passed back to llama.cpp for language only', async () => {
  using folder = mkdtempDisposableSync(path.join(realpathSync(os.tmpdir()), 'capri-mtl-device-'));
  const rows = parseLlamaDevices(
    '  MTL0: Apple M1 (5461 MiB, 5460 MiB free)\n  BLAS: Accelerate (0 MiB, 0 MiB free)',
    'metal',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Apple M1');
  assert.equal(rows[0].totalBytes, 5461 * 2 ** 20);
  saveModelDevices(folder.path, { language: rows[0].id, voice: 'cpu' });
  const launch = await languageDeviceLaunch(folder.path, 'llama-server', {
    probe: async () => rows,
  });
  assert.equal(launch.env.CAPRI_LLAMA_DEVICE, 'MTL0');
  assert.throws(() => saveModelDevices(folder.path, { language: 'cpu', voice: rows[0].id }));
});

test(
  'a bad local release archive never replaces an installed macOS engine',
  {
    skip: process.platform !== 'darwin' || process.arch !== 'arm64',
  },
  () => {
    using folder = mkdtempDisposableSync(
      path.join(realpathSync(os.tmpdir()), 'capri-mac-archive-'),
    );
    const executable = bundledLlamaPath(folder.path, 'b12317', 'darwin');
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, 'existing runtime');
    const archive = path.join(folder.path, 'bad.tar.gz');
    writeFileSync(archive, 'invalid archive');
    const script = fileURLToPath(
      new URL('../tools/setup/prepare-macos-llama.mjs', import.meta.url),
    );
    const result = spawnSync(process.execPath, [script, folder.path, archive], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pinned size or SHA-256/);
    assert.ok(existsSync(executable));
  },
);
