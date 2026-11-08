// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInterfaceTheme,
  validateInterfaceTheme,
} from '../apps/desktop/renderer/interface-theme.mjs';

function palette(value) {
  const colors = {};
  applyInterfaceTheme(value, {
    dataset: {},
    style: { setProperty: (name, color) => (colors[name] = color) },
  });
  return colors;
}

test('old custom themes preserve the linked accent and surface hue on migration', () => {
  const old = { preset: 'custom', hue: 290, saturation: 71 };
  assert.deepEqual(validateInterfaceTheme(old), {
    ...old,
    backgroundHue: 290,
    backgroundSaturation: 40,
  });
  assert.equal(palette(old)['--theme-panel'], 'hsl(290 44% 13%)');
  assert.equal(palette({ ...old, preset: 'capri' })['--cyan'], '#8ef5ed');
});

test('custom accent and background change independently', () => {
  const value = validateInterfaceTheme({ preset: 'custom', hue: 205, backgroundHue: 40 });
  const initial = palette(value);
  const surface = palette({ ...value, backgroundHue: 308, backgroundSaturation: 60 });
  assert.equal(surface['--cyan'], initial['--cyan']);
  assert.equal(surface['--theme-border'], initial['--theme-border']);
  assert.notEqual(surface['--theme-panel'], initial['--theme-panel']);
  const accent = palette({ ...value, hue: 131 });
  assert.notEqual(accent['--cyan'], initial['--cyan']);
  assert.equal(accent['--theme-background'], initial['--theme-background']);
  assert.throws(() => validateInterfaceTheme({ ...value, backgroundHue: 360 }), /Invalid/);
});
