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
    backgroundBrightness: 8,
    panelHue: null,
    panelSaturation: null,
  });
  assert.equal(palette(old)['--theme-panel'], 'hsl(290 44% 13%)');
  assert.equal(palette({ ...old, preset: 'capri' })['--cyan'], '#8ef5ed');
});

test('custom panels can match the base or use an independent color', () => {
  const base = { preset: 'custom', backgroundHue: 354, backgroundSaturation: 80 };
  const linked = palette(base);
  const custom = { ...base, panelHue: 218, panelSaturation: 65 };
  const separate = palette(custom);
  assert.equal(linked['--theme-panel'], 'hsl(354 88% 13%)');
  assert.equal(separate['--theme-panel'], 'hsl(218 65% 13%)');
  assert.equal(separate['--theme-background'], linked['--theme-background']);
  assert.equal(
    palette({ ...custom, backgroundHue: 10 })['--theme-panel'],
    separate['--theme-panel'],
  );
  const brighter = palette({ ...custom, backgroundBrightness: 17 });
  assert.equal(brighter['--theme-background'], 'hsl(354 80% 17%)');
  assert.equal(brighter['--theme-panel'], separate['--theme-panel']);
  assert.equal(brighter['--cyan'], separate['--cyan']);
  for (const patch of [{ backgroundBrightness: 21 }, { panelHue: -1 }, { panelSaturation: 101 }])
    assert.throws(() => validateInterfaceTheme({ ...custom, ...patch }), /Invalid/);
});

test('Cyberpunk 2077 has a distinct red-on-dark menu palette', () => {
  const colors = palette({ preset: 'cyberpunk-2077' });
  assert.equal(colors['--cyan'], 'hsl(355 94% 76%)');
  assert.equal(colors['--theme-background'], 'hsl(230 24% 6%)');
  assert.equal(colors['--theme-panel'], 'hsl(351 53% 11%)');
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
