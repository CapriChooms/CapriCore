// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import {
  loadMusicArtwork,
  musicArtworkSourceFiles,
  MUSIC_ARTWORK_MANIFEST,
} from '../apps/desktop/music-artwork.mjs';
import { requireCapriAvatar } from '../apps/desktop/avatar-catalog.mjs';

const folder = path.join(root, '.runtime/music-artwork-tests');
mkdirSync(folder, { recursive: true });
function fixture() {
  const directory = mkdtempSync(path.join(folder, 'case-'));
  for (const name of musicArtworkSourceFiles(root)) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    copyFileSync(path.join(root, name), path.join(directory, name));
  }
  return { directory, manifest: path.join(directory, MUSIC_ARTWORK_MANIFEST) };
}
const rewrite = (f, change) => {
  const data = JSON.parse(readFileSync(f.manifest, 'utf8'));
  change(data);
  writeFileSync(f.manifest, JSON.stringify(data));
};

test('reviewed music pack ships only two aligned masters and four small transparent note sprites', () => {
  const pack = loadMusicArtwork(root, { optional: false }),
    files = musicArtworkSourceFiles(root);
  assert.deepEqual(
    pack.frames.map(({ id }) => id),
    ['music-window', 'music-floor'],
  );
  assert.equal(pack.notes.length, 4);
  assert.equal(files.length, 7);
  assert(files.every((file) => file.startsWith('assets/default/capri-music-v1/')));
  assert(files.every((file) => !/original|context|prompt|preview|validation/u.test(file)));
  const catalog = requireCapriAvatar(root);
  assert(catalog.frames.some(({ id }) => id === 'music-floor'));
  assert.equal(catalog.musicFrames.length, 2);
  assert(!catalog.publicAnimation().frames.some(({ id }) => id.startsWith('music-')));
  assert(!catalog.publicSprites().some(({ id }) => id.startsWith('music-')));
  assert(!JSON.stringify(catalog.publicMusic()).includes(root));
});

test('optional old installations remain readable but required source music packs cannot disappear silently', () => {
  const missing = mkdtempSync(path.join(folder, 'missing-'));
  assert.equal(loadMusicArtwork(missing).frames.length, 0);
  assert.throws(() => musicArtworkSourceFiles(missing), /ENOENT/u);
});

test('music artwork rejects unknown paths, duplicate identities, invalid dimensions and generation metadata', () => {
  for (const change of [
    (m) => {
      m.frames[0].file = '../outside.png';
    },
    (m) => {
      m.frames[1].id = m.frames[0].id;
    },
    (m) => {
      m.canvas.width = 2048;
    },
    (m) => {
      m.prompt = 'Unreviewed authoring data';
    },
    (m) => {
      m.frames[0].mouth[3] = '36';
    },
    (m) => {
      m.notes[0].file = m.frames[0].file;
    },
  ]) {
    const f = fixture();
    rewrite(f, change);
    assert.throws(() => loadMusicArtwork(f.directory), /Invalid/u);
  }
});

test('every music master and note is checksum checked before it becomes an application resource', () => {
  for (const index of [0, 2]) {
    const f = fixture(),
      files = musicArtworkSourceFiles(f.directory),
      file = path.join(f.directory, files[index + 1]);
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(file, bytes);
    assert.throws(() => loadMusicArtwork(f.directory), /checksum|PNG/u);
  }
});

test('an artwork link cannot escape the reviewed runtime pack', () => {
  const f = fixture(),
    first = loadMusicArtwork(f.directory).frames[0],
    outside = path.join(f.directory, 'outside.png');
  copyFileSync(first.file, outside);
  unlinkSync(first.file);
  try {
    symlinkSync(outside, first.file, 'file');
  } catch (error) {
    if (error.code === 'EPERM') return;
    throw error;
  }
  assert.throws(() => loadMusicArtwork(f.directory), /Invalid|Linked/u);
});
