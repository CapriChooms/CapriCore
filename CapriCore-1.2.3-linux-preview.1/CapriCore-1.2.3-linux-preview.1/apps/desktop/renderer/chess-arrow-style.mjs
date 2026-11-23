// SPDX-License-Identifier: GPL-3.0-only
import { chessArrowPath } from './chess-arrow-path.mjs';

export const ARROW_ROUTES = ['straight', 'curve', 'elbow', 'wave', 'zigzag', 'custom'];
export const ARROW_ENDS = [
  'none',
  'triangle',
  'rounded',
  'swept',
  'kite',
  'chevron',
  'diamond',
  'circle',
  'square',
  'bar',
  'custom',
];
export const ARROW_ANGLED_ENDS = ['triangle', 'chevron', 'diamond', 'rounded', 'swept', 'kite'];
export const ARROW_PATTERNS = ['solid', 'dashed', 'dotted', 'mixed', 'custom'];

export const DEFAULT_CHESS_ARROW = Object.freeze({
  schemaVersion: 2,
  route: 'straight',
  bend: 36,
  startGap: 0,
  endGap: 0,
  shaftPath: 'M 0 0 L 1000 0',
  thickness: 10,
  pattern: 'solid',
  dash: 24,
  gap: 18,
  dashOffset: 0,
  customDash: '24 18 5 18',
  cap: 'round',
  join: 'round',
  color: '#60faf1',
  endColor: '#a6ecff',
  gradient: false,
  opacity: 100,
  outline: 0,
  outlineColor: '#081720',
  outlineOpacity: 100,
  glow: 6,
  glowColor: '#081720',
  head: 'triangle',
  headLength: 48,
  headWidth: 46,
  headAngle: 0,
  headColor: '#60faf1',
  ownHeadColor: false,
  headFill: true,
  headPath: 'M 0 0 L -1000 -500 L -1000 500 Z',
  tail: 'none',
  tailLength: 36,
  tailWidth: 36,
  tailAngle: 0,
  tailColor: '#60faf1',
  ownTailColor: false,
  tailFill: true,
  tailPath: 'M 0 0 Q -500 -875 -1000 0 Q -500 875 0 0 Z',
});

export const ARROW_PRESETS = Object.freeze({
  solid: {},
  thin: { thickness: 4, headLength: 30, headWidth: 24, glow: 3 },
  dashed: { pattern: 'dashed' },
  curved: {
    route: 'curve',
    bend: 53,
    gradient: true,
    color: '#66baff',
    endColor: '#d6a5ff',
    outline: 3,
    head: 'chevron',
  },
  contrast: { thickness: 23, color: '#ffea61', outline: 7, glow: 0, headLength: 66, headWidth: 74 },
  double: { head: 'chevron', tail: 'chevron', color: '#ff9dcc', outline: 3 },
});

export const ARROW_NUMBER_LIMITS = Object.freeze({
  bend: [-100, 100],
  startGap: [0, 90],
  endGap: [0, 90],
  thickness: [3, 80],
  dash: [3, 120],
  gap: [3, 120],
  dashOffset: [-200, 200],
  opacity: [0, 100],
  outline: [0, 24],
  outlineOpacity: [0, 100],
  glow: [0, 55],
  headLength: [8, 135],
  headWidth: [8, 135],
  headAngle: [0, 145],
  tailLength: [8, 135],
  tailWidth: [8, 135],
  tailAngle: [0, 145],
});

const enums = {
  route: ARROW_ROUTES,
  head: ARROW_ENDS,
  tail: ARROW_ENDS,
  pattern: ARROW_PATTERNS,
  cap: ['butt', 'round', 'square'],
  join: ['miter', 'round', 'bevel'],
};
const pathFields = ['shaftPath', 'headPath', 'tailPath'];

export function chessArrowDashes(value) {
  if (typeof value !== 'string' || value.length > 80 || !/^\s*\d+(?:[\s,]+\d+)*\s*$/.test(value))
    throw new Error('Invalid chess arrow dash pattern');
  const sizes = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (sizes.length > 12 || sizes.some((size) => size < 1 || size > 200))
    throw new Error('Invalid chess arrow dash pattern');
  return sizes;
}

export function chessArrowAppearance(value = DEFAULT_CHESS_ARROW) {
  const invalid = () => {
    throw new Error('Invalid chess arrow appearance');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (value === DEFAULT_CHESS_ARROW) return { ...value };
  if (Object.hasOwn(value, 'style')) {
    if (
      Object.keys(value).some((key) => key !== 'style' && key !== 'opacity') ||
      !['solid', 'thin', 'dashed'].includes(value.style)
    )
      invalid();
    return chessArrowAppearance({ ...ARROW_PRESETS[value.style], opacity: value.opacity });
  }
  const result = { ...DEFAULT_CHESS_ARROW };
  for (const [key, current] of Object.entries(value)) {
    if (!Object.hasOwn(result, key)) invalid();
    if (key === 'schemaVersion') {
      if (current !== 2) invalid();
    } else if (Object.hasOwn(ARROW_NUMBER_LIMITS, key)) {
      const [min, max] = ARROW_NUMBER_LIMITS[key];
      if (!Number.isInteger(current) || current < min || current > max) invalid();
    } else if (Object.hasOwn(enums, key)) {
      if (!enums[key].includes(current)) invalid();
    } else if (typeof result[key] === 'boolean') {
      if (typeof current !== 'boolean') invalid();
    } else if (pathFields.includes(key)) {
      chessArrowPath(current);
    } else if (key === 'customDash') {
      chessArrowDashes(current);
    } else if (typeof current !== 'string' || !/^#[\da-f]{6}$/i.test(current)) invalid();
    result[key] = current;
  }
  return result;
}

export function restoreChessArrowAppearance(value = DEFAULT_CHESS_ARROW) {
  const appearance = chessArrowAppearance(value);
  if (Object.hasOwn(value, 'headAngle') || Object.hasOwn(value, 'tailAngle')) return appearance;

  const previousDefault = { thickness: 16, headLength: 52, headWidth: 61, glow: 8 };
  const previousThin = { thickness: 9, headLength: 34, headWidth: 39, glow: 5 };
  const matchesPreset = (size) =>
    Object.entries({ ...DEFAULT_CHESS_ARROW, ...size }).every(
      ([key, expected]) => appearance[key] === expected,
    );
  if (matchesPreset(previousDefault)) return chessArrowAppearance();
  if (matchesPreset(previousThin)) return chessArrowAppearance(ARROW_PRESETS.thin);
  return appearance;
}
