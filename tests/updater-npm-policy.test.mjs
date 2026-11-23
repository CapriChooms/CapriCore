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
    '': {
      version: '1.0.0',
      workspaces: [...pkg.workspaces],
      devDependencies: { electron: '45.0.0' },
    },
    'apps/desktop': { name: 'capri-desktop', version: '1.0.0' },
    'packages/runtime': { name: '@capri/runtime', version: '1.0.0' },
    'node_modules/capri-desktop': { resolved: 'apps/desktop', link: true },
    'node_modules/@capri/runtime': { resolved: 'packages/runtime', link: true },
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

test('adding modular Capri workspaces needs an install, but later workspace-only version bumps do not', () => {
  const modularPkg = structuredClone(pkg),
    modularLock = structuredClone(lock);
  for (const id of ['core', 'skill-sdk', 'skills']) {
    const location = 'packages/' + id;
    const name = '@capri/' + id;
    modularPkg.workspaces.push(location);
    modularLock.packages[''].workspaces.push(location);
    modularLock.packages[location] = { name, version: '1.0.0' };
    modularLock.packages['node_modules/' + name] = { resolved: location, link: true };
  }
  const current = npmDependencySignature(modularPkg, modularLock);
  assert.notEqual(current, npmDependencySignature(pkg, lock));
  for (const location of modularPkg.workspaces) modularLock.packages[location].version = '1.0.1';
  assert.equal(current, npmDependencySignature(modularPkg, modularLock));
});

test('an unverified workspace declaration does not hide a version change', () => {
  for (const invalidate of [
    (p) => p.workspaces.splice(0, 1),
    (_p, l) => l.packages[''].workspaces.splice(0, 1),
    (_p, l) => (l.packages['apps/desktop'].name = 'third-party-desktop'),
    (_p, l) => (l.packages['apps/desktop'].integrity = 'sha512-external'),
    (_p, l) =>
      (l.packages['node_modules/capri-desktop'].resolved = 'https://registry.example/file'),
    (_p, l) => (l.packages['node_modules/capri-desktop'].link = false),
  ]) {
    const nextPkg = structuredClone(pkg),
      nextLock = structuredClone(lock);
    invalidate(nextPkg, nextLock);
    const current = npmDependencySignature(nextPkg, nextLock);
    nextLock.packages['apps/desktop'].version = '1.0.1';
    assert.notEqual(current, npmDependencySignature(nextPkg, nextLock));
  }
});
