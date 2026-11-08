import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanCaches } from '../tools/maintenance/clean-cache.mjs';

const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.runtime/test-data');
mkdirSync(parent, { recursive: true });
function fixture(t) {
  const root = mkdtempSync(path.join(parent, 'cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'keep');
  };
  return { root, put, has: (name) => existsSync(path.join(root, name)) };
}

function junction(t, source, destination) {
  try {
    symlinkSync(source, destination, 'junction');
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('Environment does not permit filesystem links');
      return false;
    }
    throw error;
  }
}

test('cache cleanup previews by default and preserves user data, runtimes and ASR fixtures', (t) => {
  const f = fixture(t);
  const disposable = [
    '.runtime/test-data/result.txt',
    '.runtime/asr-verification/electron-example/profile',
    'integrations/example/__pycache__/module.pyc',
  ];
  const protectedFiles = [
    'data/workspace/PERSONALITY.md',
    'data/voices/capri/en/raw/voice.wav',
    '.runtime/asr-verification/english-reference.wav',
    '.runtime/asr-venv/Scripts/python.exe',
    '.runtime/design-reference/contact-sheet.png',
    '.downloads/model.zip',
  ];
  [...disposable, ...protectedFiles].forEach(f.put);
  const preview = cleanCaches(f.root);
  assert.equal(preview.applied, false);
  assert.equal(preview.files, 3);
  disposable.forEach((file) => assert.ok(f.has(file)));
  cleanCaches(f.root, { apply: true });
  disposable.forEach((file) => assert.equal(f.has(file), false));
  protectedFiles.forEach((file) => assert.ok(f.has(file)));
});

test('package caches require an explicit option', (t) => {
  const f = fixture(t);
  f.put('.runtime/uv-cache/wheel');
  assert.equal(cleanCaches(f.root).files, 0);
  assert.equal(cleanCaches(f.root, { packageCaches: true }).files, 1);
});

test('a linked cache ancestor prevents all deletion, including earlier planned targets', (t) => {
  const f = fixture(t);
  f.put('.ruff_cache/record');
  f.put('private/owner.txt');
  if (!junction(t, path.join(f.root, 'private'), path.join(f.root, '.runtime'))) return;
  assert.throws(() => cleanCaches(f.root, { apply: true }), /link/);
  assert.ok(f.has('.ruff_cache/record'));
  assert.ok(f.has('private/owner.txt'));
});

test('internal cache links are unlinked without traversing their private target', (t) => {
  const f = fixture(t);
  f.put('private/owner.txt');
  f.put('.runtime/test-data/generated.txt');
  if (!junction(t, path.join(f.root, 'private'), path.join(f.root, '.runtime/test-data/linked')))
    return;
  const result = cleanCaches(f.root, { apply: true });
  assert.equal(result.paths[0].links, 1);
  assert.equal(f.has('.runtime/test-data'), false);
  assert.ok(f.has('private/owner.txt'));
});
