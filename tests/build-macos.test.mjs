// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  macProfileRoot,
  macSupportRoot,
  prepareMacRuntime,
} from '../tools/release/macos-runtime.mjs';
import { removeNpmLocalFiles } from '../tools/release/build-macos.mjs';

function fixture(folder) {
  const source = path.join(folder, 'Capri.app/Contents/Resources/capri');
  mkdirSync(path.join(source, 'config/workspace'), { recursive: true });
  mkdirSync(path.join(source, 'apps'));
  writeFileSync(path.join(source, 'apps/entry'), 'desktop');
  writeFileSync(path.join(source, 'config/core.json'), 'default v1');
  writeFileSync(path.join(source, 'config/workspace/default'), 'template v1');
  return { source, support: path.join(folder, 'Application Support') };
}

test(
  'a moved Mac app uses its new resources and keeps private state and modified defaults',
  { skip: process.platform === 'win32' },
  () => {
    using temp = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-mac-app-'));
    const { source, support } = fixture(temp.path);
    prepareMacRuntime(source, support);
    assert.equal(readFileSync(path.join(support, 'apps/entry'), 'utf8'), 'desktop');
    writeFileSync(path.join(support, 'data/fixture'), 'synthetic');
    writeFileSync(path.join(support, 'config/core.local.json'), 'owner override');
    writeFileSync(path.join(support, 'config/core.json'), 'edited');
    const moved = path.join(temp.path, 'Renamed Capri.app');
    renameSync(path.join(temp.path, 'Capri.app'), moved);
    const next = path.join(moved, 'Contents/Resources/capri');
    writeFileSync(path.join(next, 'apps/entry'), 'updated desktop');
    writeFileSync(path.join(next, 'config/core.json'), 'default v2');
    writeFileSync(path.join(next, 'config/workspace/default'), 'template v2');

    prepareMacRuntime(next, support);
    prepareMacRuntime(next, support);
    assert.equal(readFileSync(path.join(support, 'apps/entry'), 'utf8'), 'updated desktop');
    assert.equal(readFileSync(path.join(support, 'data/fixture'), 'utf8'), 'synthetic');
    assert.equal(
      readFileSync(path.join(support, 'config/core.local.json'), 'utf8'),
      'owner override',
    );
    assert.equal(readFileSync(path.join(support, 'config/core.json'), 'utf8'), 'edited');
    assert.equal(
      readFileSync(path.join(support, 'config/workspace/default'), 'utf8'),
      'template v2',
    );
    assert.equal(existsSync(path.join(next, 'data')), false);
  },
);

test(
  'Mac setup rejects foreign links and leaves their targets intact',
  { skip: process.platform === 'win32' },
  () => {
    using temp = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-mac-links-'));
    const { source, support } = fixture(temp.path);
    const outside = path.join(temp.path, 'outside');
    mkdirSync(outside);
    mkdirSync(support);
    const config = path.join(support, 'config');
    symlinkSync(outside, config);
    assert.throws(() => prepareMacRuntime(source, support), /private directory/);
    assert.equal(existsSync(path.join(outside, 'core.json')), false);
    rmSync(config);
    const pointer = path.join(support, '.capri-bundle');
    symlinkSync(outside, pointer);
    assert.throws(() => prepareMacRuntime(source, support), /Unrecognized Capri bundle/);
    assert.equal(realpathSync(pointer), outside);
  },
);

test('production dependencies omit dotenv and npm settings and retain third-party notices', () => {
  using temp = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-deps-'));
  const dep = path.join(temp.path, 'node_modules', 'fixture');
  mkdirSync(dep, { recursive: true });
  for (const name of ['.env', '.env.local', '.npmrc', 'LICENSE', 'index.js']) {
    writeFileSync(path.join(dep, name), 'fixture');
  }
  removeNpmLocalFiles(path.dirname(dep));
  assert.equal(existsSync(path.join(dep, '.env')), false);
  assert.equal(existsSync(path.join(dep, '.env.local')), false);
  assert.equal(existsSync(path.join(dep, '.npmrc')), false);
  assert.equal(readFileSync(path.join(dep, 'LICENSE'), 'utf8'), 'fixture');
  assert.equal(readFileSync(path.join(dep, 'index.js'), 'utf8'), 'fixture');
});

test('Mac support root resolves under the supplied home', () => {
  using temp = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-home-'));
  assert.equal(
    macSupportRoot(temp.path),
    path.join(temp.path, 'Library', 'Application Support', 'CapriCore'),
  );
});

test('opening a second app can claim the existing profile before changing any resource link', () => {
  using temp = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-profile-'));
  const support = macSupportRoot(temp.path);
  const profile = macProfileRoot(support);
  assert.equal(profile, path.join(support, 'data/desktop/profile'));
  assert.equal(existsSync(profile), true);
  assert.equal(existsSync(path.join(support, '.capri-bundle')), false);
});
