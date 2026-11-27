import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SPRITE_SOURCE_NAME,
  readSpriteSource,
  spriteSourcePath,
} from '../tools/assets/sprite-source.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(repo, 'tools/assets/build-sprite-catalog.mjs');
const runtimeCatalog = path.join(repo, 'assets/capri/sprites/v1/runtime-sprite-set.json');

function scratch(use) {
  const folder = mkdtempSync(path.join(tmpdir(), 'capri-sprite-source-'));
  try {
    return use(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test('the source path is the sprite set inside the given folder', () => {
  assert.equal(spriteSourcePath('/a/b'), path.join('/a/b', SPRITE_SOURCE_NAME));
});

test('a present source sprite set is parsed', () => {
  scratch((folder) => {
    writeFileSync(path.join(folder, SPRITE_SOURCE_NAME), '{"sprites":[],"sequences":[]}');
    assert.deepEqual(readSpriteSource(folder), { sprites: [], sequences: [] });
  });
});

test('a missing source sprite set fails with a clear message and its own code', () => {
  scratch((folder) => {
    assert.throws(
      () => readSpriteSource(folder),
      (error) =>
        error.code === 'SPRITE_SOURCE_MISSING' &&
        error.message.includes(SPRITE_SOURCE_NAME) &&
        error.message.includes('not part of the public source release') &&
        error.message.includes('runtime-sprite-set.json is used as-is'),
    );
  });
});

test('a read failure other than a missing file is rethrown unchanged', () => {
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  assert.throws(
    () =>
      readSpriteSource('/unused', () => {
        throw denied;
      }),
    (error) => error === denied,
  );
});

test('a source sprite set that is not JSON is rejected with the parse error', () => {
  scratch((folder) => {
    writeFileSync(path.join(folder, SPRITE_SOURCE_NAME), '{not json');
    assert.throws(() => readSpriteSource(folder), SyntaxError);
  });
});

test('the build command exits 1 with the message and leaves the committed catalog untouched', () => {
  const before = createHash('sha256').update(readFileSync(runtimeCatalog)).digest('hex');
  const run = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' });
  const after = createHash('sha256').update(readFileSync(runtimeCatalog)).digest('hex');
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /complete-sprite-set\.json is not part of the public source release/);
  assert.equal(run.stdout, '');
  assert.equal(after, before);
});
