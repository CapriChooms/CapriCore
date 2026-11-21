// SPDX-License-Identifier: GPL-3.0-only
export const TELEPORT_LIGHTNING_RANGES = Object.freeze({
  teleportIntensity: { min: 0, max: 100, defaultValue: 30 },
  teleportJaggedness: { min: 0, max: 100, defaultValue: 70 },
  teleportBranches: { min: 0, max: 100, defaultValue: 88 },
  teleportThickness: { min: 10, max: 200, defaultValue: 100 },
  teleportGlow: { min: 0, max: 100, defaultValue: 0 },
  teleportSparkAmount: { min: 0, max: 100, defaultValue: 50 },
  teleportSparkTravel: { min: 0, max: 100, defaultValue: 50 },
});

export const TELEPORT_LIGHTNING_DEFAULTS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(TELEPORT_LIGHTNING_RANGES).map(([key, { defaultValue }]) => [key, defaultValue]),
  ),
  teleportColor: '#ff0033',
  teleportReducedFlash: false,
});

export const SANDEVISTAN_RANGES = Object.freeze({
  sandevistanHoldMs: { min: 100, max: 2000, defaultValue: 500, step: 25, unit: ' ms' },
  sandevistanCopies: { min: 1, max: 24, defaultValue: 12, step: 1, unit: '' },
  sandevistanHue: { min: 0, max: 359, defaultValue: 155, step: 1, unit: '°' },
  sandevistanHueStep: { min: -180, max: 180, defaultValue: 6, step: 1, unit: '°' },
  sandevistanTint: { min: 0, max: 100, defaultValue: 50, step: 1, unit: '%' },
});

export const TELEPORT_EFFECT_DEFAULTS = Object.freeze({
  ...TELEPORT_LIGHTNING_DEFAULTS,
  teleportStyle: 'lightning',
  ...Object.fromEntries(
    Object.entries(SANDEVISTAN_RANGES).map(([key, { defaultValue }]) => [key, defaultValue]),
  ),
});

export function teleportLightningSettings(settings) {
  return Object.fromEntries(
    Object.entries(TELEPORT_LIGHTNING_DEFAULTS).map(([key, fallback]) => [
      key,
      settings?.[key] ?? fallback,
    ]),
  );
}

export function validTeleportLightning(settings) {
  return (
    typeof settings.teleportColor === 'string' &&
    /^#[\da-f]{6}$/i.test(settings.teleportColor) &&
    typeof settings.teleportReducedFlash === 'boolean' &&
    Object.entries(TELEPORT_LIGHTNING_RANGES).every(([key, { min, max }]) => {
      const value = settings[key];
      return Number.isInteger(value) && value >= min && value <= max;
    })
  );
}

export function teleportEffectSettings(settings) {
  return Object.fromEntries(
    Object.entries(TELEPORT_EFFECT_DEFAULTS).map(([key, fallback]) => [
      key,
      settings?.[key] ?? fallback,
    ]),
  );
}

export function validTeleportEffect(settings) {
  return (
    ['lightning', 'sandevistan'].includes(settings.teleportStyle) &&
    validTeleportLightning(settings) &&
    Object.entries(SANDEVISTAN_RANGES).every(
      ([key, { min, max }]) =>
        Number.isInteger(settings[key]) && settings[key] >= min && settings[key] <= max,
    )
  );
}
