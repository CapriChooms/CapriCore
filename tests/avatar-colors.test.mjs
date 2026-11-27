// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_COLOR_DEFAULTS,
  PART,
  validateAvatarColors,
  avatarColorsAreDefault,
  rgbToHsv,
  hsvToRgb,
  inkOf,
  erode,
  segmentSprite,
  recolorSprite,
  recolorAtlas,
  avatarArtKey,
  withArtKey,
} from '../apps/desktop/renderer/avatar-colors.mjs';

const RED = [251, 0, 50, 255],
  DEEP = [213, 0, 40, 255],
  GREEN = [0, 248, 62, 255],
  STAR = [255, 255, 255, 255],
  BLACK = [0, 0, 0, 255];

function sprite(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  const put = (x, y, c) => rgba.set(c, (y * width + x) * 4);
  const rect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
  };
  const at = (x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  return { rgba, put, rect, at, width, height };
}
const custom = { enabled: true, greenBody: '#0000ff', redBody: '#ffff00', hair: '#00ffff' };

test('validateAvatarColors fills defaults and lowercases hex', () => {
  assert.deepEqual(validateAvatarColors(), AVATAR_COLOR_DEFAULTS);
  assert.deepEqual(validateAvatarColors({ enabled: true, hair: '#ABCDEF' }), {
    ...AVATAR_COLOR_DEFAULTS,
    enabled: true,
    hair: '#abcdef',
  });
});

test('validateAvatarColors rejects bad shapes with TypeError', () => {
  for (const bad of [
    null,
    [],
    'red',
    { extra: 1 },
    { enabled: 'yes' },
    { hair: 'red' },
    { hair: '#fff' },
    { hair: 12 },
    { redBody: '#gggggg' },
  ])
    assert.throws(() => validateAvatarColors(bad), TypeError, JSON.stringify(bad));
});

test('avatarColorsAreDefault: off or unchanged colors count as default', () => {
  assert.equal(avatarColorsAreDefault(AVATAR_COLOR_DEFAULTS), true);
  assert.equal(avatarColorsAreDefault({ ...custom, enabled: false }), true);
  assert.equal(avatarColorsAreDefault({ ...AVATAR_COLOR_DEFAULTS, enabled: true }), true);
  assert.equal(avatarColorsAreDefault(custom), false);
});

test('rgb <-> hsv round trip', () => {
  for (const [r, g, b] of [
    [251, 0, 50],
    [0, 248, 62],
    [10, 20, 200],
    [128, 128, 128],
    [0, 0, 0],
    [255, 255, 0],
  ]) {
    const { h, s, v } = rgbToHsv(r, g, b);
    assert.deepEqual(hsvToRgb(h, s, v), [r, g, b]);
  }
});

test('inkOf classifies the two inks and ignores everything else', () => {
  assert.equal(inkOf(...RED), 'red');
  assert.equal(inkOf(...DEEP), 'red');
  assert.equal(inkOf(...GREEN), 'green');
  assert.equal(inkOf(...BLACK), null);
  assert.equal(inkOf(...STAR), null);
  assert.equal(inkOf(251, 0, 50, 10), null, 'nearly transparent');
  assert.equal(inkOf(0, 0, 255, 255), null, 'blue is no ink');
  assert.equal(inkOf(200, 150, 150, 255), null, 'too pale');
});

test('erode peels one layer per round and clears thin lines', () => {
  const w = 7,
    h = 7,
    mask = new Uint8Array(w * h);
  for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) mask[y * w + x] = 1;
  assert.equal(
    erode(mask, w, h, 0).reduce((a, b) => a + b),
    25,
  );
  assert.equal(
    erode(mask, w, h, 1).reduce((a, b) => a + b),
    9,
  );
  assert.equal(
    erode(mask, w, h, 2).reduce((a, b) => a + b),
    1,
  );
  const line = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) line[3 * w + x] = 1;
  assert.equal(
    erode(line, w, h, 1).reduce((a, b) => a + b),
    0,
  );
});

function scene() {
  const s = sprite(200, 200); // hair area threshold: 2% of 40000 = 800 pixels
  s.rect(10, 10, 20, 20, RED); // hair by stars
  for (const [x, y] of [
    [14, 14],
    [20, 15],
    [25, 22],
    [16, 26],
  ])
    s.put(x, y, STAR);
  s.rect(60, 10, 10, 10, RED); // body panel
  s.rect(30, 20, 30, 1, RED); // 1px seam from hair to panel
  s.rect(10, 60, 10, 10, DEEP); // deep-red shadow shard: hair
  s.rect(100, 100, 30, 30, RED); // big area: hair by size
  s.rect(60, 60, 8, 8, GREEN);
  s.rect(150, 10, 10, 10, RED); // second body panel, outlined
  s.rect(149, 9, 12, 1, BLACK);
  return s;
}

test('segmentSprite separates hair, body red and green', () => {
  const s = scene(),
    parts = segmentSprite(s.rgba, s.width, s.height);
  const part = (x, y) => parts[y * s.width + x];
  assert.equal(part(18, 18), PART.hair, 'starred area');
  assert.equal(part(14, 14), PART.none, 'stars themselves are not recolored');
  assert.equal(part(65, 15), PART.redBody, 'panel joined only by a thin seam');
  assert.equal(part(15, 65), PART.hair, 'deep-red shard');
  assert.equal(part(115, 115), PART.hair, 'large area');
  assert.equal(part(64, 64), PART.green);
  assert.equal(part(155, 15), PART.redBody);
  assert.equal(part(149, 9), PART.none, 'outline');
  assert.equal(part(190, 190), PART.none, 'transparent');
});

test('segmentSprite follows concave areas left and upward', () => {
  const s = sprite(200, 200);
  s.rect(10, 10, 7, 21, RED); // left arm (scanned first)
  s.rect(30, 10, 7, 21, RED); // right arm
  s.rect(2, 24, 35, 7, RED); // bottom joining them, reaching left of the left arm
  for (const y of [12, 14, 16]) s.put(33, y, STAR); // stars only on the right arm
  const parts = segmentSprite(s.rgba, s.width, s.height);
  const part = (x, y) => parts[y * s.width + x];
  assert.equal(part(13, 11), PART.hair, 'left arm joins the starred area');
  assert.equal(part(3, 27), PART.hair, 'reached by growing left');
  assert.equal(part(35, 11), PART.hair, 'reached by growing up');
});

test('segmentSprite rejects wrong buffers', () => {
  assert.throws(() => segmentSprite(new Uint8Array(10), 2, 2), TypeError);
  assert.throws(() => segmentSprite([0, 0, 0, 0], 1, 1), TypeError);
});

test('segmentSprite on an empty sprite labels nothing', () => {
  const s = sprite(4, 4);
  assert.deepEqual([...segmentSprite(s.rgba, 4, 4)], new Array(16).fill(0));
});

test('recolorSprite maps each part to its color and keeps shading', () => {
  const s = scene();
  s.put(66, 16, [125, 0, 25, 255]); // a half-bright pixel on the panel
  const changed = recolorSprite(s.rgba, s.width, s.height, custom);
  assert.ok(changed > 0);
  assert.deepEqual(s.at(18, 18), [0, 255, 255, 255], 'hair -> cyan');
  assert.deepEqual(s.at(65, 15), [255, 255, 0, 255], 'body red -> yellow');
  assert.deepEqual(s.at(64, 64), [0, 0, 255, 255], 'green -> blue');
  const [r, g, b, a] = s.at(66, 16);
  assert.equal(a, 255);
  assert.equal(b, 0);
  assert.ok(r === g && r > 120 && r < 135, 'shaded yellow, got ' + [r, g, b]);
  const deep = s.at(15, 65);
  assert.ok(deep[0] === 0 && deep[1] === deep[2] && deep[1] < 230, 'darker cyan, got ' + deep);
  assert.deepEqual(s.at(14, 14), STAR);
  assert.deepEqual(s.at(149, 9), BLACK);
  assert.deepEqual(s.at(190, 190), [0, 0, 0, 0]);
});

test('recolorSprite with default or disabled colors changes nothing', () => {
  for (const colors of [AVATAR_COLOR_DEFAULTS, { ...custom, enabled: false }]) {
    const s = scene(),
      before = Uint8Array.from(s.rgba);
    assert.equal(recolorSprite(s.rgba, s.width, s.height, colors), 0);
    assert.deepEqual(s.rgba, before);
  }
  assert.throws(() => recolorSprite(new Uint8Array(4), 1, 1, { hair: 'pink' }), TypeError);
});

test('avatarArtKey is empty for defaults and 18 hex digits otherwise', () => {
  assert.equal(avatarArtKey(undefined), '');
  assert.equal(avatarArtKey(null), '');
  assert.equal(avatarArtKey({ bogus: true }), '');
  assert.equal(avatarArtKey({ ...custom, enabled: false }), '');
  assert.equal(avatarArtKey(custom), '0000ffffff0000ffff');
});

test('withArtKey tags only capri sprite URLs', () => {
  const key = '0000ffffff0000ffff';
  assert.equal(
    withArtKey('capri://desktop/sprites/capri-neutral.png', key),
    'capri://desktop/sprites/capri-neutral.png?c=' + key,
  );
  assert.equal(
    withArtKey('capri://desktop/sprites/capri-neutral.png?c=' + key, ''),
    'capri://desktop/sprites/capri-neutral.png',
  );
  assert.equal(
    withArtKey('capri://desktop/sprites/a.png?c=aaaaaaaaaaaaaaaaaa', key),
    'capri://desktop/sprites/a.png?c=' + key,
  );
  assert.equal(
    withArtKey('capri://desktop/sprites/a.png', 'not-a-key'),
    'capri://desktop/sprites/a.png',
  );
  assert.equal(withArtKey('capri://desktop/music/01.png', key), 'capri://desktop/music/01.png');
  assert.equal(
    withArtKey('https://example.com/sprites/a.png', key),
    'https://example.com/sprites/a.png',
  );
  assert.equal(withArtKey(undefined, key), undefined);
});

// A small red panel cut by the crop's top or side edge is hair in a face crop;
// the same panel inside the crop, or touching only the bottom, stays body red.
test('segmentSprite with cropEdges treats red areas cut by the top or sides as hair', () => {
  // 80x80: the 2% hair-size rule needs 128 pixels, so 6x6 panels stay small.
  const s = sprite(80, 80);
  s.rect(0, 0, 80, 80, BLACK);
  s.rect(0, 10, 6, 6, RED); // left edge
  s.rect(15, 15, 6, 6, RED); // inside
  s.rect(30, 74, 6, 6, RED); // bottom edge (collar)
  const whole = segmentSprite(s.rgba, 80, 80);
  const crop = segmentSprite(s.rgba, 80, 80, { cropEdges: true });
  const at = (parts, x, y) => parts[y * 80 + x];
  assert.equal(at(whole, 2, 12), PART.redBody);
  assert.equal(at(crop, 2, 12), PART.hair);
  assert.equal(at(crop, 17, 17), PART.redBody);
  assert.equal(at(crop, 32, 76), PART.redBody);
});

test('recolorAtlas recolors each registered crop on its own and leaves the rest', () => {
  const s = sprite(140, 70);
  s.rect(0, 0, 140, 70, BLACK);
  s.rect(0, 5, 6, 6, RED); // crop A, left edge: hair
  s.rect(25, 25, 6, 6, RED); // crop A, inside: body
  s.rect(100, 25, 6, 6, RED); // outside every crop: untouched
  const before = s.at(102, 27);
  const n = recolorAtlas(
    s.rgba,
    140,
    70,
    { a: [0, 0, 0, 0, 70, 70], bad: [100, 50, 0, 0, 70, 70], junk: 'x' },
    custom,
  );
  assert.ok(n > 0);
  assert.deepEqual(s.at(2, 7).slice(0, 3), [0, 255, 255]);
  assert.deepEqual(s.at(27, 27).slice(0, 3), [255, 255, 0]);
  assert.deepEqual(s.at(102, 27), before);
});

test('recolorAtlas needs entries and changes nothing for default colors', () => {
  const s = sprite(10, 10);
  s.rect(0, 0, 10, 10, RED);
  assert.throws(() => recolorAtlas(s.rgba, 10, 10, null, custom), TypeError);
  assert.equal(recolorAtlas(s.rgba, 10, 10, { a: [0, 0, 0, 0, 10, 10] }, AVATAR_COLOR_DEFAULTS), 0);
});
