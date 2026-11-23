import test from 'node:test';
import assert from 'node:assert/strict';
import { featherForSurface } from '../apps/desktop/renderer/dimming-mask.mjs';
import {
  DIMMING_DEFAULTS,
  dimmingFeatherWidth,
} from '../apps/desktop/renderer/dimming-settings.mjs';

test('stored softness still maps evenly to a readable edge width', () => {
  assert.equal(dimmingFeatherWidth(DIMMING_DEFAULTS.softness), 14);
  assert.equal(dimmingFeatherWidth(5), 0.5);
  assert.equal(dimmingFeatherWidth(320), 32);
});

test('each shape gets its own feather so the center of small controls stays shaded', () => {
  assert.equal(featherForSurface(0, { width: 28, height: 28 }), 0);
  assert.equal(featherForSurface(320, { width: 440, height: 280 }), 32);
  assert.equal(featherForSurface(320, { width: 28, height: 24 }), 6);
});
