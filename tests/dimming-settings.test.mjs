import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIMMING_DEFAULTS,
  shadeBounds,
  validateDimming,
} from '../apps/desktop/renderer/dimming-settings.mjs';

test('compact native bounds remove the float offset before clipping the shaded footprint', () => {
  const viewport = { width: 430, height: 700 };
  const dock = { x: 22, y: 574.5, width: 386, height: 114 };
  assert.deepEqual(shadeBounds([dock], viewport, true), {
    x: 10,
    y: 562.5,
    width: 410,
    height: 137.5,
  });
  assert.deepEqual(shadeBounds([dock], viewport, true, 1.5), {
    x: 10,
    y: 561,
    width: 410,
    height: 138,
  });
});

test('existing dimming preferences retain their values and allow a fully clear or hard-edged backdrop', () => {
  assert.deepEqual(validateDimming({ schemaVersion: 1, ...DIMMING_DEFAULTS }), DIMMING_DEFAULTS);
  assert.deepEqual(validateDimming({ enabled: false, level: 85, softness: 0 }), {
    enabled: false,
    level: 85,
    softness: 0,
  });
  assert.deepEqual(validateDimming({ enabled: true, level: 0, softness: 320 }), {
    enabled: true,
    level: 0,
    softness: 320,
  });
});

test('dimming preferences reject nonnumeric CSS, nonfinite values and unsupported strengths', () => {
  for (const value of [
    null,
    { enabled: 'yes', level: 35, softness: 140 },
    { enabled: true, level: 86, softness: 140 },
    { enabled: true, level: -1, softness: 140 },
    { enabled: true, level: NaN, softness: 140 },
    { enabled: true, level: 35, softness: '140px' },
    { enabled: true, level: 35, softness: Infinity },
    { enabled: true, level: 35, softness: 321 },
    { enabled: true, level: 35, softness: -1 },
  ])
    assert.throws(() => validateDimming(value));
});
