// SPDX-License-Identifier: GPL-3.0-only
// The Settings gallery is its own window. Its art comes back in the saved Capri
// colors, so the eyes it paints when Capri looks away must use those colors too.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Image = class {
  set src(url) {
    this.url = url;
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
globalThis.fetch = async () => ({ ok: false });
globalThis.document = { createElement: () => ({ setAttribute() {}, hidden: true }) };

const { AvatarGallery } = await import('../apps/desktop/renderer/avatar-gallery.mjs');
const { avatarFaceArt, setAvatarFaceArt } = await import(
  '../apps/desktop/renderer/avatar-face-rig.mjs'
);
const { blinkPalette } = await import('../apps/desktop/renderer/avatar-layered-blink.mjs');
const { faceAnimations } = await import('../apps/desktop/renderer/avatar-face-expressions.mjs');

const BLUE = { enabled: true, greenBody: '#0000ff', redBody: '#ffffff', hair: '#0000ff' };

function recordingContext() {
  const fills = [];
  const context = new Proxy(
    { fills },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => {
        if (key === 'fillStyle') fills.push(value);
        target[key] = value;
        return true;
      },
    },
  );
  return context;
}

// Paints one frame of the gallery's gaze clip at a moment the eyes look away.
async function paintedLookAway(gallery) {
  const clip = faceAnimations.gaze;
  let time = 0;
  while (time < clip.duration && !clip.sample(time).gaze?.some(Boolean)) time += 10;
  assert.ok(time < clip.duration, 'the gaze clip has a moment where the eyes look away');
  const { paint } = await AvatarGallery.prototype.timeline.call(
    gallery,
    { kind: 'layered-face', id: 'gaze' },
    null,
  );
  const context = recordingContext();
  paint(context, time);
  return context.fills;
}

test('loading the gallery adopts the saved Capri colors for the face art', () => {
  const gallery = {};
  AvatarGallery.prototype.load.call(gallery, { frames: [] }, [], { avatarColors: BLUE });
  assert.equal(avatarFaceArt(), '0000ffffffff0000ff');
  assert.equal(gallery.effects.avatarColors, BLUE);
});

test('look-away eyes in the gallery paint the ring in the custom color, not default green', async () => {
  const gallery = {};
  AvatarGallery.prototype.load.call(gallery, { frames: [] }, [], { avatarColors: BLUE });
  const fills = await paintedLookAway(gallery);
  assert.ok(fills.length > 0, 'the frame paints the eyes');
  assert.ok(!fills.includes(blinkPalette.green), 'no default green ring: ' + fills.join(' '));
  assert.ok(fills.includes(blinkPalette.ink), 'the dark eye ink is unchanged');
});

test('default or missing colors keep the default palette and clear an old key', async () => {
  setAvatarFaceArt('0000ffffffff0000ff');
  const gallery = {};
  AvatarGallery.prototype.load.call(gallery, { frames: [] }, [], {});
  assert.equal(avatarFaceArt(), '');
  assert.ok((await paintedLookAway(gallery)).includes(blinkPalette.green));
  AvatarGallery.prototype.load.call(gallery, { frames: [] }, [], undefined);
  assert.equal(avatarFaceArt(), '');
});

test('invalid saved colors fall back to the defaults instead of throwing', () => {
  setAvatarFaceArt('0000ffffffff0000ff');
  AvatarGallery.prototype.load.call({}, { frames: [] }, [], {
    avatarColors: { enabled: true, greenBody: 'not-a-color' },
  });
  assert.equal(avatarFaceArt(), '');
});
