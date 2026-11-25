// SPDX-License-Identifier: GPL-3.0-only
//
// Recolors Capri's sprite art. The art uses two inks: green (face and some body
// panels) and red (other body panels and the hair). Hair and body red are the
// same red, so the hair is found by shape: the red areas are separated by
// black outlines, and a red area belongs to the hair when it carries the
// white star specks, the darker shadow red, or is too big to be a body panel.
//
// Pixels are straight RGBA bytes. Every recolored pixel keeps its own shading:
// its saturation and brightness relative to the original ink are carried over
// to the chosen color, so outlines, gradients and soft edges survive.

export const AVATAR_COLOR_DEFAULTS = Object.freeze({
  enabled: false,
  greenBody: '#00f83e',
  redBody: '#fb0032',
  hair: '#fb0032',
});
export const PART = Object.freeze({ none: 0, green: 1, redBody: 2, hair: 3 });

// The inks as drawn, in HSV (hue in degrees, s and v from 0 to 1).
const INKS = Object.freeze({
  [PART.green]: Object.freeze({ h: 135, s: 1, v: 0.973 }),
  [PART.redBody]: Object.freeze({ h: 348, s: 1, v: 0.984 }),
  [PART.hair]: Object.freeze({ h: 348, s: 1, v: 0.984 }),
});
// A red area at least this share of the sprite is hair, not a body panel
// (the hair mass is ~12% of a sprite; the biggest body panel ~0.5%).
export const HAIR_AREA_SHARE = 0.02;
// Hair carries white star specks; body panels have none.
export const HAIR_MIN_STARS = 3;
// Hair shadow shards are drawn in a deeper red (red channel ~213); on body
// panels only the anti-aliased edges are that dark.
export const DEEP_RED = Object.freeze({ min: 195, max: 225 });
export const HAIR_DEEP_SHARE = 0.3;

const HEX = /^#[0-9a-f]{6}$/;
export function validateAvatarColors(value = AVATAR_COLOR_DEFAULTS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(AVATAR_COLOR_DEFAULTS, key))
  )
    throw TypeError('Invalid avatar colors.');
  const colors = { ...AVATAR_COLOR_DEFAULTS, ...value };
  if (typeof colors.enabled !== 'boolean') throw TypeError('Invalid avatar colors.');
  for (const key of ['greenBody', 'redBody', 'hair']) {
    if (typeof colors[key] !== 'string') throw TypeError('Invalid avatar colors.');
    colors[key] = colors[key].toLowerCase();
    if (!HEX.test(colors[key])) throw TypeError('Invalid avatar colors.');
  }
  return colors;
}

/** True when recoloring would change nothing. */
export const avatarColorsAreDefault = (value) => {
  const colors = validateAvatarColors(value);
  return (
    !colors.enabled ||
    (colors.greenBody === AVATAR_COLOR_DEFAULTS.greenBody &&
      colors.redBody === AVATAR_COLOR_DEFAULTS.redBody &&
      colors.hair === AVATAR_COLOR_DEFAULTS.hair)
  );
};

export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max / 255 };
}

export function hsvToRgb(h, s, v) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hexToHsv(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Which ink a pixel was drawn with: 'green', 'red' or null. */
export function inkOf(r, g, b, a) {
  if (a < 16) return null;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (s < 0.45 || v < 0.06) return null;
  if (hueDistance(h, INKS[PART.green].h) <= 35) return 'green';
  if (hueDistance(h, INKS[PART.redBody].h) <= 28) return 'red';
  return null;
}

const isStar = (r, g, b, a) => a >= 16 && r > 200 && g > 200 && b > 200;

/**
 * Labels every pixel PART.none / green / redBody / hair.
 * Red and star-white pixels are grouped into areas (4-connected); black
 * outlines and transparency separate them.
 */
export function segmentSprite(rgba, width, height) {
  if (
    !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
    rgba.length !== width * height * 4
  )
    throw TypeError('segmentSprite needs width * height RGBA bytes.');
  const count = width * height,
    parts = new Uint8Array(count),
    fill = new Uint8Array(count); // 1 red, 2 star
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const r = rgba[p],
      g = rgba[p + 1],
      b = rgba[p + 2],
      a = rgba[p + 3];
    const ink = inkOf(r, g, b, a);
    if (ink === 'green') parts[i] = PART.green;
    else if (ink === 'red') fill[i] = 1;
    else if (isStar(r, g, b, a)) fill[i] = 2;
  }
  // Areas grow only through solid interior pixels, so a seam a couple of
  // pixels wide (a body panel brushing the hair at the neck) does not join
  // two areas. Edge pixels then take the area of the nearest interior pixel.
  const core = erode(fill, width, height, SEAM_EROSION);
  const area = new Int32Array(count),
    queue = new Int32Array(count);
  let areas = 0;
  for (let start = 0; start < count; start++) {
    if (!core[start] || area[start]) continue;
    areas++;
    let head = 0,
      tail = 0;
    queue[tail++] = start;
    area[start] = areas;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      if (x > 0 && core[i - 1] && !area[i - 1]) ((area[i - 1] = areas), (queue[tail++] = i - 1));
      if (x < width - 1 && core[i + 1] && !area[i + 1])
        ((area[i + 1] = areas), (queue[tail++] = i + 1));
      if (i >= width && core[i - width] && !area[i - width])
        ((area[i - width] = areas), (queue[tail++] = i - width));
      if (i + width < count && core[i + width] && !area[i + width])
        ((area[i + width] = areas), (queue[tail++] = i + width));
    }
  }
  // Grow every area outward through the remaining red and star pixels.
  let head = 0,
    tail = 0;
  for (let i = 0; i < count; i++) if (area[i]) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++];
    const x = i % width,
      label = area[i];
    if (x > 0 && fill[i - 1] && !area[i - 1]) ((area[i - 1] = label), (queue[tail++] = i - 1));
    if (x < width - 1 && fill[i + 1] && !area[i + 1])
      ((area[i + 1] = label), (queue[tail++] = i + 1));
    if (i >= width && fill[i - width] && !area[i - width])
      ((area[i - width] = label), (queue[tail++] = i - width));
    if (i + width < count && fill[i + width] && !area[i + width])
      ((area[i + width] = label), (queue[tail++] = i + width));
  }
  const size = new Int32Array(areas + 1),
    red = new Int32Array(areas + 1),
    stars = new Int32Array(areas + 1),
    deep = new Int32Array(areas + 1);
  for (let i = 0; i < count; i++) {
    const a = area[i];
    if (!a) continue;
    size[a]++;
    if (fill[i] === 2) stars[a]++;
    else {
      red[a]++;
      const level = rgba[i * 4];
      if (level >= DEEP_RED.min && level <= DEEP_RED.max && rgba[i * 4 + 3] > 240) deep[a]++;
    }
  }
  const hairArea = Math.max(1, Math.round(count * HAIR_AREA_SHARE));
  const hair = new Uint8Array(areas + 1);
  for (let a = 1; a <= areas; a++)
    hair[a] = Number(
      red[a] > 0 &&
        (size[a] >= hairArea || stars[a] >= HAIR_MIN_STARS || deep[a] >= red[a] * HAIR_DEEP_SHARE),
    );
  for (let i = 0; i < count; i++)
    if (fill[i] === 1) parts[i] = area[i] && hair[area[i]] ? PART.hair : PART.redBody;
  return parts;
}

// How many pixels are peeled off an area before seams stop joining areas.
export const SEAM_EROSION = 2;

/** Pixels still set after peeling `rounds` layers off every area's edge. */
export function erode(mask, width, height, rounds) {
  let current = Uint8Array.from(mask, (v) => (v ? 1 : 0));
  const count = width * height;
  for (let round = 0; round < rounds; round++) {
    const next = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (!current[i]) continue;
      const x = i % width;
      next[i] =
        x > 0 &&
        x < width - 1 &&
        i >= width &&
        i + width < count &&
        current[i - 1] &&
        current[i + 1] &&
        current[i - width] &&
        current[i + width]
          ? 1
          : 0;
    }
    current = next;
  }
  return current;
}

/** Recolors in place; returns how many pixels changed. */
export function recolorSprite(rgba, width, height, value) {
  const colors = validateAvatarColors(value);
  if (avatarColorsAreDefault(colors)) return 0;
  const parts = segmentSprite(rgba, width, height);
  const targets = {
    [PART.green]: hexToHsv(colors.greenBody),
    [PART.redBody]: hexToHsv(colors.redBody),
    [PART.hair]: hexToHsv(colors.hair),
  };
  let changed = 0;
  for (let i = 0, p = 0; i < parts.length; i++, p += 4) {
    const part = parts[i];
    if (!part) continue;
    const ink = INKS[part],
      target = targets[part],
      { s, v } = rgbToHsv(rgba[p], rgba[p + 1], rgba[p + 2]);
    const [r, g, b] = hsvToRgb(
      target.h,
      Math.min(1, target.s * (s / ink.s)),
      Math.min(1, target.v * (v / ink.v)),
    );
    rgba[p] = r;
    rgba[p + 1] = g;
    rgba[p + 2] = b;
    changed++;
  }
  return changed;
}

// A tag added to sprite URLs while custom colors are on, so windows that kept
// decoded frames fetch them again when the colors change.
export const ART_KEY = /^[0-9a-f]{18}$/;
export function avatarArtKey(value) {
  let colors;
  try {
    colors = validateAvatarColors(value ?? undefined);
  } catch {
    return '';
  }
  return avatarColorsAreDefault(colors)
    ? ''
    : [colors.greenBody, colors.redBody, colors.hair].map((hex) => hex.slice(1)).join('');
}
const SPRITE_URL = /^capri:\/\/desktop\/sprites\/[^?#]+\.png$/;
export function withArtKey(url, key) {
  if (typeof url !== 'string') return url;
  const base = url.split('?')[0];
  if (!SPRITE_URL.test(base)) return url;
  return key && ART_KEY.test(key) ? base + '?c=' + key : base;
}
