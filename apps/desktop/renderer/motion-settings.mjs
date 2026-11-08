// SPDX-License-Identifier: GPL-3.0-only
export const MOTION_DEFAULTS = Object.freeze({
  floatEnabled: false,
  floatAmplitude: 6,
  floatPeriodSeconds: 10,
});
export function validateMotionSettings(value) {
  const next = Object.fromEntries(
    Object.entries(MOTION_DEFAULTS).map(([key, fallback]) => [
      key,
      value?.[key] === undefined ? fallback : value[key],
    ]),
  );
  if (
    typeof next.floatEnabled !== 'boolean' ||
    !Number.isInteger(next.floatAmplitude) ||
    next.floatAmplitude < 0 ||
    next.floatAmplitude > 24 ||
    !Number.isInteger(next.floatPeriodSeconds) ||
    next.floatPeriodSeconds < 4 ||
    next.floatPeriodSeconds > 30
  )
    throw new Error('Invalid window motion settings');
  return next;
}
/** Clamp against the actual visible controls, excluding unused transparent space.
 * Rectangles have their current translation removed before entering this function. */
export function floatLimits(rectangles, height, padding = 4) {
  const rows = rectangles.filter(
    (r) => Number.isFinite(r.top) && Number.isFinite(r.bottom) && r.bottom > r.top,
  );
  if (!rows.length) return { min: 0, max: 0 };
  const min = Math.min(0, padding - Math.min(...rows.map((r) => r.top)));
  const max = Math.max(0, height - padding - Math.max(...rows.map((r) => r.bottom)));
  return { min, max };
}
