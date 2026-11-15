// SPDX-License-Identifier: GPL-3.0-only
export const THEME_DEFAULTS = Object.freeze({
  preset: 'capri',
  hue: 174,
  saturation: 84,
  backgroundHue: 174,
  backgroundSaturation: 40,
  backgroundBrightness: 8,
  panelHue: null,
  panelSaturation: null,
});
export const BACKGROUND_BRIGHTNESS_RANGE = Object.freeze({ min: 4, max: 20 });
const presets = Object.freeze({
  capri: [174, 84, 344],
  blackwall: [346, 91, 284],
  amethyst: [264, 79, 190],
  overdrive: [46, 95, 338],
  'cyberpunk-2077': [355, 94, 351],
});
const integerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function validateInterfaceTheme(value = THEME_DEFAULTS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(THEME_DEFAULTS, key))
  )
    throw Error('Invalid interface theme.');
  const { preset, hue, saturation, backgroundBrightness, panelHue, panelSaturation } = {
    ...THEME_DEFAULTS,
    ...value,
  };
  // Older custom palettes used one hue for both surfaces and accents.
  const backgroundHue = value.backgroundHue === undefined ? hue : value.backgroundHue;
  const backgroundSaturation =
    value.backgroundSaturation === undefined
      ? THEME_DEFAULTS.backgroundSaturation
      : value.backgroundSaturation;
  if (
    !(Object.hasOwn(presets, preset) || preset === 'custom') ||
    !integerIn(hue, 0, 359) ||
    !integerIn(saturation, 35, 100) ||
    !integerIn(backgroundHue, 0, 359) ||
    !integerIn(backgroundSaturation, 0, 100) ||
    !integerIn(
      backgroundBrightness,
      BACKGROUND_BRIGHTNESS_RANGE.min,
      BACKGROUND_BRIGHTNESS_RANGE.max,
    ) ||
    (panelHue === null) !== (panelSaturation === null) ||
    (panelHue !== null && !integerIn(panelHue, 0, 359)) ||
    (panelSaturation !== null && !integerIn(panelSaturation, 0, 100))
  )
    throw Error('Invalid interface theme.');
  return {
    preset,
    hue,
    saturation,
    backgroundHue,
    backgroundSaturation,
    backgroundBrightness,
    panelHue,
    panelSaturation,
  };
}

export const matchingPanelSaturation = (saturation) => Math.min(100, Math.round(saturation * 1.1));

export function interfaceThemeColors(value) {
  const theme = validateInterfaceTheme(value);
  const {
    preset,
    hue,
    saturation,
    backgroundHue,
    backgroundSaturation,
    backgroundBrightness,
    panelHue,
    panelSaturation,
  } = theme;
  const [accent, vivid, highlight] = presets[preset] ?? [hue, saturation, hue];
  const custom = preset === 'custom';
  const game = preset === 'cyberpunk-2077';
  let [surface, surfaceSaturation, lightness] = [accent, 40, 8];
  if (custom)
    [surface, surfaceSaturation, lightness] = [
      backgroundHue,
      backgroundSaturation,
      backgroundBrightness,
    ];
  if (game) [surface, surfaceSaturation, lightness] = [230, 24, 6];
  let [panel, panelSat, panelLightness] = [
    surface,
    matchingPanelSaturation(surfaceSaturation),
    lightness + 5,
  ];
  if (custom && panelHue !== null)
    [panel, panelSat, panelLightness] = [panelHue, panelSaturation, 13];
  if (game) [panel, panelSat, panelLightness] = [351, 53, 11];
  return {
    cyan: preset === 'capri' ? '#8ef5ed' : `hsl(${accent} ${vivid}% 76%)`,
    pink:
      preset === 'capri' ? '#ff3c68' : `hsl(${highlight} ${preset === 'custom' ? vivid : 88}% 61%)`,
    'theme-panel': `hsl(${panel} ${panelSat}% ${panelLightness}%)`,
    'theme-background': `hsl(${surface} ${surfaceSaturation}% ${lightness}%)`,
    'theme-border': `hsl(${accent} ${Math.round(vivid * 0.42)}% 38%)`,
    'theme-text': `hsl(${accent} ${Math.round(vivid * 0.54)}% 92%)`,
  };
}

export function applyInterfaceTheme(value, element = document.documentElement) {
  const colors = interfaceThemeColors(value);
  element.dataset.interfaceTheme = value?.preset ?? THEME_DEFAULTS.preset;
  for (const [key, color] of Object.entries(colors)) element.style.setProperty(`--${key}`, color);
}
