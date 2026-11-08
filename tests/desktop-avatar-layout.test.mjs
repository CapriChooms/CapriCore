import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AVATAR_LAYOUT,
  avatarRect,
  avatarFacePoint,
  centerAvatarFace,
  clippedAvatarRect,
  moveAvatar,
  zoomAvatar,
  validateAvatarLayout,
} from '../apps/desktop/avatar-layout.mjs';
import { spriteDragHit, spriteHit, validateRegions } from '../apps/desktop/geometry.mjs';
import { requireCapriAvatar } from '../apps/desktop/avatar-catalog.mjs';
import { avatarPoseLandmarks } from '../apps/desktop/renderer/avatar-mouth.mjs';
import { root } from '../packages/runtime/src/host/paths.mjs';

const viewport = { x: 16, y: 50, width: 428, height: 420 };

test('the home camera centers the authored face of every portrait and music pose at every zoom', () => {
  const catalog = requireCapriAvatar(root);
  const frames = [...catalog.publicAnimation().frames, ...catalog.publicMusic().frames];
  for (const frame of frames) {
    for (const [width, height] of [
      [428, 420],
      [428, 160],
      [264, 264],
    ]) {
      const area = {
        x: 16,
        y: 40,
        width,
        height,
        baseSize: Math.min(430, width, height),
        centerFaces: true,
      };
      for (const zoom of [0.6, 1.15, 2, 3]) {
        for (const pan of [0, 1]) {
          const initial = { x: pan, y: pan, zoom };
          const landmarks = avatarPoseLandmarks(frame.id)?.face;
          const centered = centerAvatarFace(initial, area, frame, landmarks);
          const point = avatarFacePoint(centered, area, frame, landmarks);
          assert.ok(
            Math.abs(point.x - area.x - width / 2) < 1e-7,
            frame.id + ' horizontal face center',
          );
          assert.ok(
            Math.abs(point.y - area.y - height / 2) < 1e-7,
            frame.id + ' vertical face center',
          );
          assert.equal(centered.zoom, zoom);
          validateAvatarLayout(centered);
        }
      }
    }
  }
});

test('the default avatar is centred and larger, with independent movement inside its area', () => {
  const rect = avatarRect(DEFAULT_AVATAR_LAYOUT, viewport);
  assert.equal(rect.x + rect.width / 2, viewport.x + viewport.width / 2);
  assert.ok(rect.width > 298);
  const moved = avatarRect(moveAvatar(DEFAULT_AVATAR_LAYOUT, viewport, -25, -70), viewport);
  assert.ok(Math.abs(moved.x - rect.x + 25) < 0.001);
  assert.ok(Math.abs(moved.y - rect.y + 70) < 0.001);
  assert.equal(moved.width, rect.width);
  const edge = avatarRect(moveAvatar(DEFAULT_AVATAR_LAYOUT, viewport, -100000, 100000), viewport);
  assert.ok(edge.x < viewport.x);
  assert.ok(edge.x + edge.width > viewport.x + viewport.width / 2);
  assert.equal(edge.y + edge.height, viewport.y + viewport.height);
});

test('both portrait pan axes keep their range around a perfect fit and at higher zoom', () => {
  for (const area of [
    { x: 20, y: 35, width: 264, height: 264, baseSize: 264 },
    { x: 20, y: 35, width: 440, height: 205, baseSize: 205 },
    { x: 20, y: 35, width: 288, height: 160, baseSize: 320 },
  ]) {
    let previous = { x: area.width * 0.4, y: area.height * 0.4 };
    for (const zoom of [0.6, 0.75, 1, 1.15, 1.5, 2, 2.2, 2.5, 3]) {
      const layout = { x: 0.5, y: 0.5, zoom };
      const first = avatarRect(moveAvatar(layout, area, -10000, -10000), area);
      const last = avatarRect(moveAvatar(layout, area, 10000, 10000), area);
      const range = { x: last.x - first.x, y: last.y - first.y };
      assert.ok(range.x >= previous.x - 1e-8);
      assert.ok(range.y >= previous.y - 1e-8);
      const original = avatarRect(layout, area);
      const moved = avatarRect(moveAvatar(layout, area, 21, -26), area);
      assert.ok(Math.abs(moved.x - original.x - 21) < 1e-8);
      assert.ok(Math.abs(moved.y - original.y + 26) < 1e-8);
      previous = range;
    }
  }
});

test('portrait drag accepts transparent artwork gaps and padding within the clipped canvas only', () => {
  const rect = { x: 20, y: 20, width: 100, height: 100 };
  const mask = {
    alpha: new Uint8Array(100),
    imageSize: { width: 10, height: 10 },
    visibleBounds: { x: 3, y: 3, width: 4, height: 4 },
  };
  const gap = { x: 70, y: 70 };
  assert.equal(spriteHit(gap, rect, mask.alpha, mask.imageSize), false);
  assert.equal(spriteDragHit(gap, rect, mask), true);
  assert.equal(spriteDragHit({ x: 42, y: 60 }, rect, mask), true);
  assert.equal(spriteDragHit({ x: 28, y: 60 }, rect, mask), false);
  assert.equal(spriteDragHit(gap, { ...rect, enabled: false }, mask), false);
  const crop = clippedAvatarRect(
    rect,
    { width: 110, height: 110 },
    { x: 75, y: 20, width: 35, height: 90 },
  );
  assert.equal(spriteDragHit(gap, crop, mask), false);
  assert.equal(spriteDragHit({ x: 78, y: 60 }, crop, mask), true);
});

test('zoom preserves the image point beneath the pointer until an area edge is reached', () => {
  const layout = { x: 0.5, y: 0.5, zoom: 0.6 };
  const rect = avatarRect(layout, viewport);
  const point = { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.3 };
  const next = zoomAvatar(layout, viewport, 0.8, point);
  const enlarged = avatarRect(next, viewport);
  assert.ok(Math.abs((point.x - enlarged.x) / enlarged.width - 0.4) < 0.0001);
  assert.ok(Math.abs((point.y - enlarged.y) / enlarged.height - 0.3) < 0.0001);
  assert.equal(zoomAvatar(layout, viewport, 100).zoom, 3);
  assert.equal(zoomAvatar(layout, viewport, -100).zoom, 0.6);
});

test('large zoom stays recoverable on small screens; clipped masks retain original PNG coordinates', () => {
  const full = { x: -100, y: -100, width: 400, height: 400 };
  const cropped = clippedAvatarRect(full, { width: 200, height: 200 });
  assert.deepEqual(cropped.source, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  const image = { width: 4, height: 4 },
    alpha = new Uint8Array(16);
  alpha[1 * 4 + 1] = 255;
  assert.equal(spriteHit({ x: 10, y: 10 }, cropped, alpha, image), true);
  assert.equal(spriteHit({ x: 160, y: 160 }, cropped, alpha, image), false);
  const bounded = clippedAvatarRect(
    full,
    { width: 200, height: 200 },
    { x: 20, y: 30, width: 100, height: 120 },
  );
  assert.equal(bounded.x, 20);
  assert.equal(bounded.y, 30);
  assert.equal(bounded.width, 100);
  assert.doesNotThrow(() =>
    validateRegions({ controls: [], sprite: bounded }, { width: 200, height: 200 }),
  );
  for (const zoom of [0.6, 1.15, 2.2]) {
    const area = { x: 16, y: 40, width: 288, height: 180 };
    const rect = avatarRect({ x: 0.5, y: 0.5, zoom }, area);
    assert.ok(rect.x < area.x + area.width && rect.x + rect.width > area.x);
    assert.ok(rect.y < area.y + area.height && rect.y + rect.height > area.y);
  }
});

test('placement and crop validation reject non-finite coordinates and invalid scale or source areas', () => {
  for (const value of [
    null,
    {},
    { x: Infinity, y: 0, zoom: 1 },
    { x: -1, y: 0, zoom: 1 },
    { x: 0, y: 0, zoom: 100 },
  ]) {
    assert.throws(() => validateAvatarLayout(value));
  }
  for (const source of [
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 2, height: 1 },
    { x: NaN, y: 0, width: 1, height: 1 },
  ]) {
    assert.throws(() =>
      validateRegions(
        { controls: [], sprite: { x: 0, y: 0, width: 100, height: 100, source } },
        { width: 200, height: 200 },
      ),
    );
  }
});
