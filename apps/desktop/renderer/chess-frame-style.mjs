// SPDX-License-Identifier: GPL-3.0-only
// The strip painter insets its stroke within this expanded frame surface.
export const CHESS_FRAME_OUTSET = 10;
// Keep the full glow outside even when the sparks travel inward.
export const CHESS_FRAME_INWARD_PADDING = 78;
export const CHESS_FRAME_OUTER_PADDING = 128;

export const CHESS_FRAME_FIELDS = Object.freeze({
  width: { label: 'Thickness', value: 8, min: 1, max: 12 },
  opacity: { label: 'Outline opacity', value: 100, min: 10, max: 100 },
  glow: { label: 'Glow radius', value: 15, min: 0, max: 30 },
  detail: { label: 'Detail level', value: 8, min: 1, max: 8 },
  particlesOutward: { label: 'Particles move outward', value: true },
});

export const DEFAULT_CHESS_FRAME = Object.freeze(
  Object.fromEntries(Object.entries(CHESS_FRAME_FIELDS).map(([key, { value }]) => [key, value])),
);

export function chessFrameAppearance(value = DEFAULT_CHESS_FRAME) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(CHESS_FRAME_FIELDS, key))
  )
    throw new Error('Invalid chess settings');
  return Object.fromEntries(
    Object.entries(CHESS_FRAME_FIELDS).map(([key, rule]) => {
      const current = value[key] ?? rule.value;
      const valid =
        typeof rule.value === 'boolean'
          ? typeof current === 'boolean'
          : Number.isInteger(current) && current >= rule.min && current <= rule.max;
      if (!valid) throw new Error('Invalid chess settings');
      return [key, current];
    }),
  );
}

export function restoreChessFrameAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return chessFrameAppearance(value);
  const { color, accent, corner, flashCount, ...appearance } = value;
  return chessFrameAppearance(appearance);
}
