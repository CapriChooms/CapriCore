// SPDX-License-Identifier: GPL-3.0-only
// The face rig draws from its own images and atlases, so a Capri colors change
// must tag their URLs and drop face art loaded in the old colors.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const loads = [];
globalThis.Image = class {
  set src(url) {
    this.url = url;
    loads.push(url);
    const pose = url.startsWith('/avatar-blink-pose.png');
    this.width = pose ? 1254 : 156;
    this.height = pose ? 1254 : 103;
  }
  get src() {
    return this.url;
  }
  decode() {
    return Promise.resolve();
  }
};
globalThis.Path2D = class {
  constructor() {
    return new Proxy(this, { get: () => () => {} });
  }
};
globalThis.fetch = async (url) =>
  url.endsWith('gestures.json') ? { ok: true, json: async () => ({}) } : { ok: false };
globalThis.document = { createElement: () => ({ setAttribute() {}, hidden: true }) };

const { avatarFaceArt, loadAvatarFaceRig, loadAvatarGestureFaces, setAvatarFaceArt } = await import(
  '../apps/desktop/renderer/avatar-face-rig.mjs'
);
const { AvatarMouthLayer } = await import('../apps/desktop/renderer/avatar-mouth.mjs');
const { faceFrames } = await import('../apps/desktop/renderer/avatar-face-expressions.mjs');

const KEY = '0000ffffff0000ffff',
  OTHER = '00ff00ff0000ffff00';

test('setAvatarFaceArt takes only a new string key', () => {
  assert.equal(avatarFaceArt(), '');
  assert.equal(setAvatarFaceArt(undefined), false);
  assert.equal(setAvatarFaceArt(''), false);
  assert.equal(setAvatarFaceArt(KEY), true);
  assert.equal(avatarFaceArt(), KEY);
  assert.equal(setAvatarFaceArt(KEY), false);
  assert.equal(setAvatarFaceArt(''), true);
  assert.equal(avatarFaceArt(), '');
});

test('face images and atlases are fetched with the color key', async () => {
  loads.length = 0;
  await loadAvatarFaceRig();
  await loadAvatarGestureFaces();
  assert.deepEqual(loads.sort(), [
    '/avatar-blink-eyes.png',
    '/avatar-blink-pose.png',
    '/avatar-face-gestures.png',
    '/avatar-face-poses.png',
  ]);
  setAvatarFaceArt(KEY);
  loads.length = 0;
  await loadAvatarFaceRig();
  await loadAvatarGestureFaces();
  assert.deepEqual(
    loads.sort(),
    [
      '/avatar-blink-eyes.png',
      '/avatar-blink-pose.png',
      '/avatar-face-gestures.png',
      '/avatar-face-poses.png',
    ].map((url) => url + '?c=' + KEY),
  );
});

test('a color change drops the loaded face art; the same key keeps it', () => {
  const rig = loadAvatarFaceRig(),
    gestures = loadAvatarGestureFaces();
  setAvatarFaceArt(avatarFaceArt());
  assert.equal(loadAvatarFaceRig(), rig);
  assert.equal(loadAvatarGestureFaces(), gestures);
  setAvatarFaceArt(OTHER);
  assert.notEqual(loadAvatarFaceRig(), rig);
  assert.notEqual(loadAvatarGestureFaces(), gestures);
});

test('the mouth layer ignores a rig loaded in old colors and reloads', async () => {
  const sprite = { after() {}, naturalWidth: 1254, complete: true, currentSrc: 'x' };
  let ready = 0;
  const layer = new AvatarMouthLayer(sprite, { onReady: () => ready++ });
  const frameId = Object.keys(faceFrames)[0];
  setAvatarFaceArt(KEY);
  layer.update({}, 'closed', frameId);
  assert.equal(layer.rigArt, KEY);
  const stale = layer.loading;
  setAvatarFaceArt(OTHER);
  await stale;
  assert.equal(layer.rig, null);
  assert.equal(ready, 0);
  layer.update({}, 'closed', frameId);
  assert.equal(layer.rigArt, OTHER);
  assert.notEqual(layer.loading, stale);
  await layer.loading;
  assert.equal(typeof layer.rig, 'function');
  assert.equal(ready, 1);
});
