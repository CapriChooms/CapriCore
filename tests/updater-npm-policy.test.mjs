// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { npmDependencySignature } from '../packages/updater/src/npm-policy.mjs';
const pkg = {
  name: 'capri',
  version: '1.0.0',
  workspaces: ['apps/desktop', 'packages/runtime'],
  devDependencies: { electron: '45.0.0' },
  scripts: { postinstall: 'node reviewed.mjs' },
};
const lock = {
  name: 'capri',
  version: '1.0.0',
  lockfileVersion: 3,
  packages: {
    '': { version: '1.0.0', devDependencies: { electron: '45.0.0' } },
    'apps/desktop': { version: '1.0.0' },
    'packages/runtime': { version: '1.0.0' },
    'node_modules/electron': { version: '45.0.0', integrity: 'sha512-reviewed' },
  },
};
test('a Capri-only version bump keeps the same locked dependencies without deleting Electron', () => {
  const nextPkg = structuredClone(pkg),
    nextLock = structuredClone(lock);
  nextPkg.version = nextLock.version = '1.0.1';
  for (const key of ['', ...pkg.workspaces]) nextLock.packages[key].version = '1.0.1';
  assert.equal(npmDependencySignature(pkg, lock), npmDependencySignature(nextPkg, nextLock));
  assert.equal(pkg.version, '1.0.0');
});
test('third-party versions, integrity hashes, dependency declarations and hooks still require synchronization', () => {
  const current = npmDependencySignature(pkg, lock);
  for (const mutate of [
    (p, l) => (l.packages['node_modules/electron'].version = '45.0.1'),
    (p, l) => (l.packages['node_modules/electron'].integrity = 'sha512-changed'),
    (p) => (p.devDependencies.electron = '45.0.1'),
    (p) => (p.scripts.postinstall = 'node changed.mjs'),
  ]) {
    const nextPkg = structuredClone(pkg),
      nextLock = structuredClone(lock);
    mutate(nextPkg, nextLock);
    assert.notEqual(current, npmDependencySignature(nextPkg, nextLock));
  }
});
