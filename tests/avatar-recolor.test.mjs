// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AvatarRecolor,
  FACE_ATLASES,
  FACE_IMAGES,
  MAX_CACHED,
  SPRITE_PATH,
  swapRedBlue,
  taggedSpriteRequest,
} from '../apps/desktop/main/avatar-recolor.mjs';
import { resourceResponse } from '../apps/desktop/main/protocol.mjs';

const custom = { enabled: true, greenBody: '#0000ff', redBody: '#ffff00', hair: '#00ffff' };
const KEY = '0000ffffff0000ffff';

// A stand-in for Electron's nativeImage: 1x1 images, BGRA bitmaps.
function fakeImage({ bgra = [3, 2, 1, 4], width = 1, height = 1, fail = false } = {}) {
  const calls = { decode: 0, encode: [] };
  return {
    calls,
    createFromBuffer() {
      calls.decode++;
      if (fail) throw Error('bad png');
      return { getSize: () => ({ width, height }), toBitmap: () => Buffer.from(bgra) };
    },
    createFromBitmap(buffer, size) {
      calls.encode.push({ bytes: [...buffer], size });
      return { toPNG: () => Buffer.from('png:' + [...buffer].join(',')) };
    },
  };
}

test('taggedSpriteRequest accepts only a ?c= key on sprite paths', () => {
  assert.equal(taggedSpriteRequest('/sprites/capri-neutral.png', '?c=' + KEY), true);
  assert.equal(taggedSpriteRequest('/sprites/capri-neutral.png', '?c=' + KEY + '&x=1'), false);
  assert.equal(taggedSpriteRequest('/sprites/capri-neutral.png', '?c=ABCDEF0000ffffff00'), false);
  assert.equal(taggedSpriteRequest('/sprites/capri-neutral.png', '?x=' + KEY), false);
  assert.equal(taggedSpriteRequest('/index.html', '?c=' + KEY), false);
  assert.equal(taggedSpriteRequest('/sprites/../index.html', '?c=' + KEY), false);
  assert.ok(SPRITE_PATH.test('/sprites/capri-idle-blink_half.png'));
  assert.ok(!SPRITE_PATH.test('/sprites/Capri.png'));
});

test('swapRedBlue swaps bytes 0 and 2 of every pixel', () => {
  assert.deepEqual(
    [...swapRedBlue(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))],
    [3, 2, 1, 4, 7, 6, 5, 8],
  );
  assert.deepEqual([...swapRedBlue(new Uint8Array(0))], []);
});

test('AvatarRecolor needs getColors and image', () => {
  assert.throws(() => new AvatarRecolor({ image: fakeImage() }), TypeError);
  assert.throws(() => new AvatarRecolor({ getColors: () => custom }), TypeError);
});

test('non-sprite paths and default colors pass through untouched', () => {
  const image = fakeImage(),
    bytes = Buffer.from('original');
  let colors = custom;
  const recolor = new AvatarRecolor({ getColors: () => colors, image, recolor: () => 0 });
  assert.equal(recolor.transform('/index.html', bytes), bytes);
  assert.equal(recolor.transform('/music/01-eighth-cyan.png', bytes), bytes);
  colors = { ...custom, enabled: false };
  assert.equal(recolor.transform('/sprites/a.png', bytes), bytes);
  assert.equal(recolor.key(), '');
  assert.equal(image.calls.decode, 0);
});

test('recolor sees RGBA and the result is written back as BGRA', () => {
  const image = fakeImage({ bgra: [3, 2, 1, 4] });
  let seen;
  const recolor = new AvatarRecolor({
    getColors: () => custom,
    image,
    recolor: (pixels, width, height, colors) => {
      seen = { pixels: [...pixels], width, height, colors };
      pixels.set([10, 20, 30, 40]);
    },
  });
  const out = recolor.transform('/sprites/a.png', Buffer.from('x'));
  assert.deepEqual(seen, { pixels: [1, 2, 3, 4], width: 1, height: 1, colors: custom });
  assert.deepEqual(image.calls.encode, [
    { bytes: [30, 20, 10, 40], size: { width: 1, height: 1 } },
  ]);
  assert.equal(String(out), 'png:30,20,10,40');
});

test('results are cached per color choice and path', () => {
  const image = fakeImage();
  let colors = custom;
  const recolor = new AvatarRecolor({ getColors: () => colors, image, recolor: () => 1 });
  const first = recolor.transform('/sprites/a.png', Buffer.from('x'));
  assert.equal(recolor.transform('/sprites/a.png', Buffer.from('x')), first);
  assert.equal(image.calls.decode, 1);
  recolor.transform('/sprites/b.png', Buffer.from('x'));
  colors = { ...custom, hair: '#123456' };
  recolor.transform('/sprites/a.png', Buffer.from('x'));
  assert.equal(image.calls.decode, 3);
});

test('the cache holds at most MAX_CACHED sprites, oldest dropped first', () => {
  const image = fakeImage();
  const recolor = new AvatarRecolor({ getColors: () => custom, image, recolor: () => 1 });
  for (let i = 0; i <= MAX_CACHED; i++) recolor.transform(`/sprites/s${i}.png`, Buffer.from('x'));
  assert.equal(recolor.cache.size, MAX_CACHED);
  assert.ok(!recolor.cache.has(KEY + '/sprites/s0.png'));
  assert.ok(recolor.cache.has(KEY + `/sprites/s${MAX_CACHED}.png`));
});

test('a failed or empty decode falls back to the original bytes', (t) => {
  t.mock.method(console, 'warn', () => {});
  const bytes = Buffer.from('original');
  const broken = new AvatarRecolor({ getColors: () => custom, image: fakeImage({ fail: true }) });
  assert.equal(broken.transform('/sprites/a.png', bytes), bytes);
  assert.equal(broken.cache.size, 0);
  assert.equal(console.warn.mock.callCount(), 1);
  const empty = new AvatarRecolor({
    getColors: () => custom,
    image: fakeImage({ width: 0, height: 0 }),
  });
  assert.equal(empty.transform('/sprites/a.png', bytes), bytes);
});

function resources() {
  const dir = mkdtempSync(path.join(tmpdir(), 'capri-colors-'));
  const sprite = path.join(dir, 'a.png'),
    page = path.join(dir, 'index.html');
  writeFileSync(sprite, 'sprite-bytes');
  writeFileSync(page, 'page-bytes');
  const map = new Map([
    ['/sprites/a.png', { file: sprite, type: 'image/png' }],
    ['/index.html', { file: page, type: 'text/html' }],
  ]);
  return { map, dir };
}
const get = (url) => ({ url, method: 'GET' });

test('protocol serves a tagged sprite through transform', async (t) => {
  const { map, dir } = resources();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transform = (pathname, raw) => Buffer.from(pathname + ':' + raw);
  const tagged = resourceResponse(get('capri://desktop/sprites/a.png?c=' + KEY), map, {
    transform,
  });
  assert.equal(tagged.status, 200);
  assert.equal(await tagged.text(), '/sprites/a.png:sprite-bytes');
  const plain = resourceResponse(get('capri://desktop/sprites/a.png'), map);
  assert.equal(await plain.text(), 'sprite-bytes');
});

test('protocol refuses query strings anywhere but tagged sprites', async (t) => {
  const { map, dir } = resources();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const url of [
    'capri://desktop/index.html?c=' + KEY,
    'capri://desktop/sprites/a.png?c=nothex',
    'capri://desktop/sprites/a.png?x=1',
    'capri://desktop/sprites/a.png?c=' + KEY + '#frag',
  ])
    assert.equal(resourceResponse(get(url), map).status, 404, url);
});

test('companion settings carry and validate avatarColors', async () => {
  const { COMPANION_DEFAULTS, validateCompanionSettings } = await import(
    '../apps/desktop/companion-settings.mjs'
  );
  assert.equal(COMPANION_DEFAULTS.avatarColors.enabled, false);
  const saved = validateCompanionSettings({
    ...COMPANION_DEFAULTS,
    avatarColors: { enabled: true, hair: '#ABCDEF' },
  });
  assert.equal(saved.avatarColors.hair, '#abcdef');
  assert.equal(saved.avatarColors.redBody, '#fb0032');
  assert.deepEqual(
    validateCompanionSettings({ ...COMPANION_DEFAULTS, avatarColors: undefined }).avatarColors,
    COMPANION_DEFAULTS.avatarColors,
  );
  assert.throws(() =>
    validateCompanionSettings({ ...COMPANION_DEFAULTS, avatarColors: { hair: 'pink' } }),
  );
});

test('face images and atlases (Capri 1.3.0 face rig) are avatar art too', () => {
  for (const pathname of [...FACE_IMAGES, ...FACE_ATLASES])
    assert.equal(taggedSpriteRequest(pathname, '?c=' + KEY), true, pathname);
  assert.equal(taggedSpriteRequest('/avatar-face-poses.json', '?c=' + KEY), false);
  assert.equal(taggedSpriteRequest('/capri-wave.webp', '?c=' + KEY), false);
});

test('blink images go through the sprite recolor, atlases through the atlas recolor with their entries', () => {
  const seen = [];
  const recolor = new AvatarRecolor({
    getColors: () => custom,
    image: fakeImage(),
    recolor: () => seen.push('sprite'),
    atlas: (_p, _w, _h, entries) => seen.push(['atlas', entries]),
    atlasEntries: (pathname) =>
      pathname === '/avatar-face-poses.png' ? { a: [0, 0, 0, 0, 1, 1] } : null,
  });
  recolor.transform('/avatar-blink-pose.png', Buffer.from('x'));
  recolor.transform('/avatar-face-poses.png', Buffer.from('x'));
  assert.deepEqual(seen, ['sprite', ['atlas', { a: [0, 0, 0, 0, 1, 1] }]]);
  // An atlas without registrations is served unchanged.
  const bytes = Buffer.from('raw');
  assert.equal(recolor.transform('/avatar-face-gestures.png', bytes), bytes);
});

test('without a registration source an atlas is served unchanged', () => {
  const image = fakeImage();
  const recolor = new AvatarRecolor({ getColors: () => custom, image });
  const bytes = Buffer.from('raw');
  assert.equal(recolor.transform('/avatar-face-poses.png', bytes), bytes);
  assert.equal(image.calls.encode.length, 0);
  assert.equal(recolor.cache.size, 0);
});

test('an atlas crop is recolored by the real atlas recolor', () => {
  // One body-red pixel (BGRA) in a 1x1 crop; too small to survive the
  // erosion, so it takes the chosen red-body color (yellow, BGRA 0,255,255).
  const image = fakeImage({ bgra: [50, 0, 251, 255] });
  const recolor = new AvatarRecolor({
    getColors: () => custom,
    image,
    atlasEntries: () => ({ a: [0, 0, 0, 0, 1, 1] }),
  });
  recolor.transform('/avatar-face-gestures.png', Buffer.from('x'));
  assert.deepEqual(image.calls.encode[0].bytes, [0, 255, 255, 255]);
});
