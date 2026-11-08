// SPDX-License-Identifier: GPL-3.0-only
export const THEME_DEFAULTS = Object.freeze({
  preset: 'capri',
  hue: 174,
  saturation: 84,
  backgroundHue: 174,
  backgroundSaturation: 40,
});
const presets = Object.freeze({
  capri: [174, 84, 344],
  blackwall: [346, 91, 284],
  amethyst: [264, 79, 190],
  overdrive: [46, 95, 338],
});
export function validateInterfaceTheme(value = THEME_DEFAULTS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(THEME_DEFAULTS, key))
  )
    throw Error('Invalid interface theme.');
  const { preset, hue, saturation } = { ...THEME_DEFAULTS, ...value };
  // Older custom palettes used one hue for both surfaces and accents.
  const backgroundHue = value.backgroundHue === undefined ? hue : value.backgroundHue;
  const backgroundSaturation =
    value.backgroundSaturation === undefined
      ? THEME_DEFAULTS.backgroundSaturation
      : value.backgroundSaturation;
  if (
    !(Object.hasOwn(presets, preset) || preset === 'custom') ||
    !Number.isInteger(hue) ||
    hue < 0 ||
    hue > 359 ||
    !Number.isInteger(saturation) ||
    saturation < 35 ||
    saturation > 100 ||
    !Number.isInteger(backgroundHue) ||
    backgroundHue < 0 ||
    backgroundHue > 359 ||
    !Number.isInteger(backgroundSaturation) ||
    backgroundSaturation < 0 ||
    backgroundSaturation > 100
  )
    throw Error('Invalid interface theme.');
  return { preset, hue, saturation, backgroundHue, backgroundSaturation };
}

export function interfaceThemeColors(value) {
  const { preset, hue, saturation, backgroundHue, backgroundSaturation } =
    validateInterfaceTheme(value);
  const [accent, vivid, highlight] = presets[preset] ?? [hue, saturation, hue];
  const [surface, surfaceSaturation] =
    preset === 'custom' ? [backgroundHue, backgroundSaturation] : [accent, 40];
  return {
    cyan: preset === 'capri' ? '#8ef5ed' : `hsl(${accent} ${vivid}% 76%)`,
    pink:
      preset === 'capri' ? '#ff3c68' : `hsl(${highlight} ${preset === 'custom' ? vivid : 88}% 61%)`,
    'theme-panel': `hsl(${surface} ${Math.min(100, Math.round(surfaceSaturation * 1.1))}% 13%)`,
    'theme-background': `hsl(${surface} ${surfaceSaturation}% 8%)`,
    'theme-border': `hsl(${accent} ${Math.round(vivid * 0.42)}% 38%)`,
    'theme-text': `hsl(${accent} ${Math.round(vivid * 0.54)}% 92%)`,
  };
}

export function applyInterfaceTheme(value, element = document.documentElement) {
  const colors = interfaceThemeColors(value);
  element.dataset.interfaceTheme = value?.preset ?? THEME_DEFAULTS.preset;
  for (const [key, color] of Object.entries(colors)) element.style.setProperty(`--${key}`, color);
}
