// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import {
  ACTIVE_AVATAR_CATALOG,
  ACTIVE_AVATAR_POSES,
  AVATAR_REPAIR_MESSAGE,
  AVATAR_SOURCE_REPAIR_MESSAGE,
  loadInstalledAvatar,
  requireCapriAvatar,
} from '../apps/desktop/avatar-catalog.mjs';
import { createDesktopResources } from '../apps/desktop/main/resources.mjs';
import { resourceResponse } from '../apps/desktop/main/protocol.mjs';
import { musicArtworkSourceFiles } from '../apps/desktop/music-artwork.mjs';

const parent = path.join(root, '.runtime/avatar-installation-unit');
mkdirSync(parent, { recursive: true });
function fixture(withCapri = false) {
  const folder = mkdtempSync(path.join(parent, 'case-'));
  const copy = (name) => {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    copyFileSync(path.join(root, name), path.join(folder, name));
  };
  for (const file of ['assets/default/sprite-set.json', 'assets/default/avatar.png']) copy(file);
  if (withCapri) {
    const catalog = requireCapriAvatar(root);
    for (const file of [
      ACTIVE_AVATAR_CATALOG,
      ACTIVE_AVATAR_POSES,
      ...musicArtworkSourceFiles(root),
      ...catalog.frames.map((f) => path.relative(root, f.file)),
    ])
      copy(file);
  }
  return folder;
}

test('installed Capri serves the active portrait and reviewed pose PNGs', async () => {
  const { catalog, diagnostics, warning } = loadInstalledAvatar(root);
  assert.equal(warning, null);
  assert.equal(diagnostics.mode, 'capri');
  assert.equal(diagnostics.frames, 38);
  assert.equal(catalog.desktopPoseFrames.length, 10);
  assert.equal(catalog.animated, true);
  const spriteFile = catalog.sprites.find((sprite) => sprite.id === catalog.defaultId).file;
  const resources = createDesktopResources({
    root,
    directory: path.join(root, 'apps/desktop'),
    catalog,
    spriteFile,
  });
  const active = new Set([...catalog.portraitFrames, ...catalog.desktopPoseFrames]);
  for (const frame of catalog.frames) {
    const response = resourceResponse({ url: frame.url, method: 'GET' }, resources);
    if (!active.has(frame)) {
      assert.equal(response.status, 404, frame.id);
      continue;
    }
    assert.equal(response.status, 200, frame.id);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(frame.file));
  }
  assert.equal(
    resourceResponse(
      { url: 'capri://desktop/sprites/arms_crossed-neutral.png', method: 'GET' },
      resources,
    ).status,
    404,
  );
  const response = resourceResponse(
    { url: 'capri://desktop/sprite.png', method: 'GET' },
    resources,
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(spriteFile));
  assert.notDeepEqual(
    readFileSync(spriteFile),
    readFileSync(path.join(root, 'assets/default/avatar.png')),
  );
  const headpat = resourceResponse(
    { url: 'capri://desktop/headpat-face.png', method: 'GET' },
    resources,
  );
  assert.equal(headpat.status, 200);
  assert.equal(headpat.headers.get('content-type'), 'image/png');
  assert.deepEqual(
    Buffer.from(await headpat.arrayBuffer()),
    readFileSync(path.join(root, 'assets/default/capri-headpat.png')),
  );
});

test('a missing character catalog is explicitly diagnosed and installing the pack restores Capri', () => {
  const folder = fixture();
  const missing = loadInstalledAvatar(folder);
  assert.equal(missing.diagnostics.mode, 'fallback');
  assert.equal(missing.diagnostics.failure.code, 'ENOENT');
  assert.equal(missing.warning, AVATAR_REPAIR_MESSAGE);
  assert.equal(missing.catalog.animated, false);
  assert.throws(() => requireCapriAvatar(folder), /Run Capri Setup again/);
  assert.throws(
    () => requireCapriAvatar(folder, { source: true }),
    (error) => {
      assert.equal(error.message, AVATAR_SOURCE_REPAIR_MESSAGE);
      assert.equal(error.code, 'CAPRI_ARTWORK_SOURCE_INVALID');
      assert.equal(error.cause.code, 'ENOENT');
      return true;
    },
  );
  const pack = requireCapriAvatar(root);
  for (const name of [
    ACTIVE_AVATAR_CATALOG,
    ACTIVE_AVATAR_POSES,
    ...musicArtworkSourceFiles(root),
    ...pack.frames.map((f) => path.relative(root, f.file)),
  ]) {
    const target = path.join(folder, name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, name), target);
  }
  assert.equal(loadInstalledAvatar(folder).diagnostics.mode, 'capri');
  assert.equal(loadInstalledAvatar(folder).warning, null);
});

test('a missing frame or checksum mismatch cannot be mistaken for a valid installed avatar', () => {
  const folder = fixture(true);
  const catalog = requireCapriAvatar(folder);
  const frame = catalog.frames[0];
  const original = readFileSync(frame.file);
  unlinkSync(frame.file);
  assert.throws(() => requireCapriAvatar(folder), /artwork is missing or damaged/);
  assert.equal(loadInstalledAvatar(folder).diagnostics.mode, 'fallback');
  const damaged = Buffer.from(original);
  damaged[damaged.length - 1] ^= 1;
  writeFileSync(frame.file, damaged);
  const result = loadInstalledAvatar(folder);
  assert.equal(result.diagnostics.mode, 'fallback');
  assert.match(result.diagnostics.failure.message, /checksum mismatch/);
  writeFileSync(frame.file, original);
  assert.equal(loadInstalledAvatar(folder).diagnostics.mode, 'capri');
});
