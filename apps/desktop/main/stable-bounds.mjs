// SPDX-License-Identifier: GPL-3.0-only

/** Largest per-axis difference still treated as native rounding, in DIP. */
export const ROUNDING_TOLERANCE = 6;

const sizeOf = (value) =>
  value &&
  Number.isFinite(value.width) &&
  Number.isFinite(value.height) &&
  value.width > 0 &&
  value.height > 0
    ? { width: Math.round(value.width), height: Math.round(value.height) }
    : null;

/** The requested size when the native one differs only by rounding, else the native size. */
export function logicalSize(native, requested, tolerance = ROUNDING_TOLERANCE) {
  const actual = sizeOf(native);
  const wanted = sizeOf(requested);
  if (!actual || !wanted) return actual ?? wanted;
  return Math.abs(actual.width - wanted.width) <= tolerance &&
    Math.abs(actual.height - wanted.height) <= tolerance
    ? wanted
    : actual;
}

/**
 * At a fractional display scale Windows rounds a window's size outward, so
 * getBounds() reports a slightly larger rectangle than the one last requested.
 * Code that reads the bounds and writes them back with a new position then
 * grows the window a little on every call. This makes getBounds() report the
 * size that was last requested through setBounds() while the native size is
 * within rounding distance of it, so such round trips keep the size constant.
 * A real native resize (larger than rounding) is reported as it is.
 */
export function stabilizeWindowBounds(window, initial, tolerance = ROUNDING_TOLERANCE) {
  if (!window || typeof window.getBounds !== 'function' || typeof window.setBounds !== 'function')
    throw new TypeError('stabilizeWindowBounds needs a window with getBounds and setBounds.');
  const nativeGet = window.getBounds.bind(window);
  const nativeSet = window.setBounds.bind(window);
  let requested = sizeOf(initial);
  window.getBounds = () => {
    const native = nativeGet();
    const size = logicalSize(native, requested, tolerance);
    return size ? { ...native, ...size } : native;
  };
  window.setBounds = (bounds, ...rest) => {
    const size = sizeOf(bounds);
    if (!size) return nativeSet(bounds, ...rest);
    requested = size;
    return nativeSet({ ...bounds, ...size }, ...rest);
  };
  return window;
}
