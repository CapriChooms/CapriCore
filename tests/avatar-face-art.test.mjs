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

// While the eyes look around, the rig paints them instead of drawing the eye
// image; the painted iris ring must use the palette of the current colors.
const { avatarFacePalette } = await import('../apps/desktop/renderer/avatar-face-rig.mjs');
const { blinkPalette, prepareLayeredBlink } = await import(
  '../apps/desktop/renderer/avatar-layered-blink.mjs'
);
const { PART, artKeyColors, recolorInk } = await import(
  '../apps/desktop/renderer/avatar-colors.mjs'
);

function paintedFills(palette, state) {
  const fills = [],
    images = [];
  const context = new Proxy(
    {},
    {
      get: (target, name) =>
        name === 'drawImage'
          ? (image) => images.push(image)
          : name in target
            ? target[name]
            : () => {},
      set: (target, name, value) => {
        if (name === 'fillStyle') fills.push(value);
        target[name] = value;
        return true;
      },
    },
  );
  const eyes = { width: 156, height: 103 };
  const draw = palette
    ? prepareLayeredBlink({ width: 1254, height: 1254 }, eyes, palette)
    : prepareLayeredBlink({ width: 1254, height: 1254 }, eyes);
  draw(context, 1254, state, 'eye-art');
  return { fills, drewEyes: images.includes(eyes) };
}

test('avatarFacePalette paints the iris ring in the green-body color of the key', () => {
  setAvatarFaceArt('');
  assert.deepEqual(avatarFacePalette(), blinkPalette);
  const palette = avatarFacePalette(KEY);
  assert.equal(palette.green, recolorInk(blinkPalette.green, PART.green, artKeyColors(KEY)));
  assert.notEqual(palette.green, blinkPalette.green);
  assert.deepEqual({ ...palette, green: blinkPalette.green }, blinkPalette);
  setAvatarFaceArt(KEY);
  assert.deepEqual(avatarFacePalette(), palette);
  setAvatarFaceArt('');
});

test('eyes looking around are painted with the given palette', () => {
  const palette = avatarFacePalette(KEY);
  const looking = paintedFills(palette, { gaze: [3, -1] });
  assert.equal(looking.drewEyes, false);
  assert.ok(looking.fills.includes(palette.green));
  assert.ok(!looking.fills.includes(blinkPalette.green));
  // Without a palette the original colors are painted.
  assert.ok(paintedFills(undefined, { gaze: [3, -1] }).fills.includes(blinkPalette.green));
  // Eyes at rest come from the (recolored) eye image instead.
  const resting = paintedFills(palette, {});
  assert.equal(resting.drewEyes, true);
  assert.ok(!resting.fills.includes(palette.green));
});

test('the face rig paints looking eyes in the colors it was loaded in', async () => {
  const fills = [];
  const context = () =>
    new Proxy(
      {},
      {
        get: (target, name) =>
          name === 'getImageData'
            ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
            : name in target
              ? target[name]
              : () => {},
        set: (target, name, value) => {
          if (name === 'fillStyle') fills.push(value);
          target[name] = value;
          return true;
        },
      },
    );
  const createElement = document.createElement;
  document.createElement = () => ({ getContext: context });
  try {
    for (const key of [OTHER, '']) {
      setAvatarFaceArt(key);
      const rig = await loadAvatarFaceRig();
      assert.equal(loadAvatarFaceRig(), loadAvatarFaceRig());
      fills.length = 0;
      rig({}, 'neutral').paint(context(), { gaze: [3, -1] });
      assert.ok(fills.includes(avatarFacePalette(key).green), key);
    }
    assert.notEqual(avatarFacePalette(OTHER).green, avatarFacePalette('').green);
  } finally {
    document.createElement = createElement;
  }
});
