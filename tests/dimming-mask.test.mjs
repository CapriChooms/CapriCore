// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { feather, dimmingPixels } from '../apps/desktop/renderer/dimming-mask.mjs';
test('Gaussian feather is symmetric, monotonic, bounded, and preserves full-strength centers in small windows', () => {
  assert.equal(feather(0, 140), 0);
  assert.equal(feather(140, 140), 1);
  assert(Math.abs(feather(70, 140) - 0.5) < 0.0001);
  for (let i = 1; i <= 140; i++) assert(feather(i, 140) >= feather(i - 1, 140));
  for (const [w, h, soft] of [
    [430, 700, 140],
    [300, 190, 320],
    [320, 480, 320],
    [7680, 4320, 320],
    [300, 190, 0],
  ]) {
    const p = dimmingPixels(w, h, soft),
      alpha = (x, y) => p.data[(y * p.width + x) * 4 + 3];
    assert(p.width <= 1024 && p.height <= 1024);
    assert(alpha(Math.floor(p.width / 2), Math.floor(p.height / 2)) >= 254);
    assert.equal(alpha(0, 0), soft ? 0 : 255);
    assert.equal(alpha(1, 1), alpha(p.width - 2, p.height - 2));
  }
});
