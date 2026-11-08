import test from 'node:test';
import assert from 'node:assert/strict';
import {
  placeInWorkArea,
  placeVisibleInWorkArea,
  spriteHit,
  validateRegions,
  visibleWindowBounds,
} from '../apps/desktop/geometry.mjs';

test('corner placement respects the taskbar, negative monitor coordinates and missing monitors', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 },
    size = { width: 380, height: 680 };
  assert.deepEqual(placeInWorkArea(null, area, size), { x: -396, y: 344, ...size });
  assert.deepEqual(placeInWorkArea({ x: 5000, y: -3000 }, area, size), { x: -380, y: 0, ...size });
  assert.deepEqual(placeInWorkArea(null, { x: 0, y: 0, width: 320, height: 480 }, size), {
    x: 0,
    y: 0,
    width: 320,
    height: 480,
  });
});

test('sprite hit mask accepts opaque artwork while allowing clicks through transparent pixels', () => {
  const rectangle = { x: 20, y: 30, width: 200, height: 200 },
    image = { width: 2, height: 2 };
  const mask = Uint8Array.from([255, 0, 1, 128]);
  assert.equal(spriteHit({ x: 40, y: 50 }, rectangle, mask, image), true);
  assert.equal(spriteHit({ x: 180, y: 50 }, rectangle, mask, image), false);
  assert.equal(spriteHit({ x: 40, y: 200 }, rectangle, mask, image), false);
  assert.equal(spriteHit({ x: 180, y: 200 }, rectangle, mask, image), true);
  assert.equal(spriteHit({ x: 220, y: 230 }, rectangle, mask, image), false);
});

test('miniature placement constrains the visible panel on a stacked monitor', () => {
  const area = { x: -1280, y: -900, width: 1280, height: 850 };
  const size = { width: 480, height: 660 };
  const compact = { x: 140, y: 490, width: 326, height: 164 };
  const placed = placeVisibleInWorkArea({ ...size, x: -1500, y: -1500 }, area, size, compact);
  assert.deepEqual(placed, { ...size, x: -1420, y: -1390 });
  assert.deepEqual(visibleWindowBounds(placed, compact), { ...compact, x: -1280, y: -900 });
  assert.deepEqual(placeVisibleInWorkArea(placed, area, size), { ...size, x: -1280, y: -900 });
});

test('IPC hit regions cannot expand interaction outside the companion window', () => {
  const sprite = { x: 0, y: 20, width: 100, height: 100 };
  assert.deepEqual(validateRegions({ controls: [], sprite }, { width: 380, height: 680 }), {
    controls: [],
    sprite,
  });
  for (const invalid of [
    { ...sprite, x: -1 },
    { ...sprite, width: Infinity },
    { ...sprite, width: 5000 },
  ]) {
    assert.throws(() =>
      validateRegions({ controls: [], sprite: invalid }, { width: 380, height: 680 }),
    );
  }
  const footprint = { x: 90, y: 500, width: 290, height: 181 };
  const bounds = { width: 380, height: 680 };
  assert.deepEqual(validateRegions({ controls: [], sprite, footprint }, bounds).footprint, {
    ...footprint,
    height: 180,
  });
  assert.throws(() =>
    validateRegions({ controls: [], sprite, footprint: { ...footprint, y: -5 } }, bounds),
  );
});

test('CRT hit testing samples the curved image and rejects out-of-range texture pixels', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 },
    image = { width: 100, height: 100 };
  const alpha = new Uint8Array(10000);
  alpha.fill(255, 0, 10000);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 10; x++) alpha[y * 100 + x] = 0;
  const curved = { ...rect, lens: { ...rect, curve: 0.036 } };
  assert.equal(spriteHit({ x: 10.2, y: 50 }, rect, alpha, image), true);
  assert.equal(spriteHit({ x: 10.2, y: 50 }, curved, alpha, image), false);
  assert.equal(spriteHit({ x: 50, y: 50 }, curved, alpha, image), true);
  assert.equal(spriteHit({ x: 99.9, y: 99.9 }, curved, alpha, image), false);
  assert.deepEqual(
    validateRegions({ controls: [], sprite: curved }, { width: 100, height: 100 }).sprite.lens,
    curved.lens,
  );
  for (const lens of [
    { ...curved.lens, curve: NaN },
    { ...curved.lens, x: -1 },
    { ...curved.lens, curve: 0.9 },
  ]) {
    assert.throws(() =>
      validateRegions({ controls: [], sprite: { ...rect, lens } }, { width: 100, height: 100 }),
    );
  }
});
