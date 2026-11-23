// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { verifyPayload } from '../packages/updater/src/transaction.mjs';
import { REPOSITORY } from '../packages/updater/src/releases.mjs';

const parent = path.join(root, '.runtime/update-manifest-compat');
mkdirSync(parent, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const hardFailure = (error) => error.code !== 'UPDATE_INSTALLER_REQUIRED';
function fixture(extra = {}) {
  const directory = mkdtempSync(path.join(parent, 'case-'));
  const entries = {
    'package.json': JSON.stringify({ name: 'capri', version: '0.5.1' }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3 }),
    'config/release.json': JSON.stringify({
      schemaVersion: 1,
      repository: REPOSITORY,
      tag: 'v0.5.1',
    }),
    'packages/installer/windows/register.ps1': '# fixture registration only',
    ...extra,
  };
  const files = Object.entries(entries).map(([name, text]) => {
    const value = Buffer.from(text);
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), value);
    return { path: name, bytes: value.length, sha256: hash(value) };
  });
  const rewrite = (change) => {
    const manifest = { schemaVersion: 1, files: structuredClone(files) };
    change?.(manifest);
    writeFileSync(path.join(directory, 'SOURCE_MANIFEST.json'), JSON.stringify(manifest));
    return manifest;
  };
  rewrite();
  return { directory, files, rewrite, verify: () => verifyPayload(directory, 'v0.5.1') };
}

test('update payload accepts reviewed PNG/JSON asset families without an installed exporter catalogue', () => {
  const f = fixture({
    'assets/capri/intro-next/runtime-intro.json': JSON.stringify({ schemaVersion: 2 }),
    'assets/capri/intro-next/PNG/signal.png': 'synthetic PNG fixture bytes',
    'assets/capri/sprites/poses-vfuture/runtime-poses.json': JSON.stringify({ schemaVersion: 9 }),
    'assets/capri/sprites/poses-vfuture/PNG/sit-new.png': 'synthetic next pose bytes',
    'assets/fonts/next-family.woff2': 'synthetic reviewed font bytes',
    'assets/default/new-icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  assert.deepEqual(f.verify(), f.files);
});

test('all extracted files must be accounted for, including an otherwise allowed future source file', () => {
  for (const unlisted of [
    'apps/desktop/extra.mjs',
    'assets/capri/intro-next/PNG/extra.png',
    'data/unlisted-private-fact.md',
    '.runtime/cache/extra.bin',
  ]) {
    const f = fixture();
    mkdirSync(path.dirname(path.join(f.directory, unlisted)), { recursive: true });
    writeFileSync(path.join(f.directory, unlisted), 'unlisted fixture data');
    assert.throws(f.verify, hardFailure, unlisted);
  }
});

test('an unsupported reviewed asset format asks for the full installer instead of weakening source rules', () => {
  const f = fixture({ 'assets/capri/intro-next/PNG/signal.webp': 'future fixture image' });
  assert.throws(f.verify, (error) => error.code === 'UPDATE_INSTALLER_REQUIRED');
});

test('private, cached and operational state can never become updater-owned files', () => {
  for (const name of [
    'data/workspace/MEMORY.md',
    'logs/debug.log',
    '.runtime/updates/active.json',
    'config/inference.local.json',
    'apps/desktop/.env',
    'node_modules/something/index.mjs',
    'docs/audit/private-report.md',
    '.capri-install.json',
  ]) {
    const f = fixture();
    f.rewrite((manifest) => manifest.files.push({ path: name, bytes: 0, sha256: hash('') }));
    assert.throws(f.verify, hardFailure, name);
  }
});

test('Windows aliases, traversal, streams and duplicate case-folded paths are rejected before access', () => {
  for (const name of [
    '../data/secret',
    'apps/../data/secret',
    'apps/desktop/CON.txt',
    'apps/desktop/aux.txt',
    'apps/desktop/NUL',
    'apps/desktop/NUL .txt',
    'apps/desktop/CON .mjs',
    'apps/desktop/COM1 .txt',
    'apps/desktop/com1.log',
    'apps/desktop/Lpt9.foo',
    'apps/desktop/file.mjs:stream',
    'apps/desktop/file.mjs. ',
    'C:/outside/file.mjs',
    'apps\\desktop\\file.mjs',
  ]) {
    const f = fixture();
    f.rewrite((manifest) => manifest.files.push({ path: name, bytes: 0, sha256: hash('') }));
    assert.throws(f.verify, hardFailure, name);
  }
  const f = fixture();
  f.rewrite((manifest) =>
    manifest.files.push({ ...manifest.files[0], path: manifest.files[0].path.toUpperCase() }),
  );
  assert.throws(f.verify, hardFailure);
});

test('forward-compatible asset handling still enforces hashes, byte lengths and exact release identity', () => {
  const name = 'assets/capri/intro-next/PNG/signal.png';
  const changed = fixture({ [name]: 'original fixture image' });
  writeFileSync(path.join(changed.directory, name), 'tampered fixture image');
  assert.throws(changed.verify, /checksum|hash|size|manifest/i);

  const wrongHash = fixture({ [name]: 'unchanged fixture image' });
  wrongHash.rewrite((manifest) => {
    manifest.files.at(-1).sha256 = 'f'.repeat(64);
  });
  assert.throws(wrongHash.verify, /checksum|hash|manifest/i);

  const wrongSize = fixture({ [name]: 'unchanged fixture image' });
  wrongSize.rewrite((manifest) => {
    manifest.files.at(-1).bytes++;
  });
  assert.throws(wrongSize.verify, /checksum|size|manifest/i);

  const wrongRelease = fixture();
  assert.throws(() => verifyPayload(wrongRelease.directory, 'v0.5.2'), /release|identity|GitHub/i);

  const privateRepository = fixture({
    'config/release.json': JSON.stringify({
      schemaVersion: 1,
      repository: 'CapriChooms/Capri',
      tag: 'v0.5.1',
    }),
  });
  assert.throws(privateRepository.verify, /release|identity|GitHub/i);
});

test('unsupported future formats cannot turn tampering or malformed metadata into installer fallback', () => {
  const name = 'assets/capri/intro-next/PNG/signal.webp';
  for (const change of [
    (manifest) => {
      manifest.files.at(-1).sha256 = 'f'.repeat(64);
    },
    (manifest) => {
      manifest.files.at(-1).bytes = -1;
    },
    (manifest) => {
      manifest.files.push({ ...manifest.files.at(-1) });
    },
  ]) {
    const f = fixture({ [name]: 'future fixture image' });
    f.rewrite(change);
    assert.throws(f.verify, hardFailure);
  }
  const identity = fixture({ [name]: 'future fixture image' });
  assert.throws(() => verifyPayload(identity.directory, 'v0.5.2'), hardFailure);
  const extra = fixture({ [name]: 'future fixture image' });
  mkdirSync(path.join(extra.directory, 'apps'), { recursive: true });
  writeFileSync(path.join(extra.directory, 'apps/extra.mjs'), 'unlisted source');
  assert.throws(extra.verify, hardFailure);
});

test('an archive cannot smuggle an unlisted filesystem link into a valid payload', (t) => {
  const f = fixture();
  const target = path.join(f.directory, 'package.json');
  const link = path.join(f.directory, 'apps/desktop/unlisted-link.mjs');
  mkdirSync(path.dirname(link), { recursive: true });
  try {
    symlinkSync(target, link, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('Creating a local fixture symlink is unavailable.');
      return;
    }
    throw error;
  }
  assert.throws(f.verify, /link|unsafe|path/i);
  assert.equal(readFileSync(target, 'utf8').includes('0.5.1'), true);
});
