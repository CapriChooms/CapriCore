/** Window-local backdrop settings shared by the main process and renderer. */
export const DIMMING_DEFAULTS = Object.freeze({ enabled: true, level: 35, softness: 140 });

/** A compact companion must not shade the empty area reserved for its portrait. */
export function shadeBounds(rectangles, viewport, compact = false, floatY = 0) {
  if (!compact) return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const visible = rectangles.filter(
    (r) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0,
  );
  if (!visible.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.min(...visible.map((r) => r.x)) - 12);
  const y = Math.max(0, Math.min(...visible.map((r) => r.y)) - floatY - 12);
  return {
    x,
    y,
    width: Math.max(
      0,
      Math.min(viewport.width, Math.max(...visible.map((r) => r.x + r.width)) + 12) - x,
    ),
    height: Math.max(
      0,
      Math.min(viewport.height, Math.max(...visible.map((r) => r.y + r.height)) - floatY + 12) - y,
    ),
  };
}

export function validateDimming(value) {
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    !Number.isFinite(value.level) ||
    !Number.isFinite(value.softness) ||
    value.level < 0 ||
    value.level > 85 ||
    value.softness < 0 ||
    value.softness > 320
  )
    throw new Error('Invalid screen dimming');
  return {
    enabled: value.enabled,
    level: Math.round(value.level),
    softness: Math.round(value.softness),
  };
}
