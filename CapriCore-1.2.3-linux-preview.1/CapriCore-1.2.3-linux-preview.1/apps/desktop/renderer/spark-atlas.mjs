// SPDX-License-Identifier: GPL-3.0-only
const chessRed = '#ff3048';
const tile = 48;
export const SPARK_CORE_LEVELS = [0.24, 0.63, 1];
export const SPARK_SHAPES = [
  [
    [6, 30],
    [20, 21],
    [38, 17],
    [32, 24],
    [44, 25],
    [28, 30],
    [24, 36],
  ],
  [
    [12, 33],
    [23, 19],
    [37, 14],
    [31, 26],
    [38, 30],
    [23, 34],
    [17, 40],
  ],
  [
    [17, 19],
    [29, 17],
    [35, 25],
    [28, 34],
    [16, 31],
    [19, 26],
    [13, 26],
  ],
  [
    [7, 31],
    [21, 24],
    [29, 8],
    [27, 22],
    [43, 20],
    [28, 28],
    [25, 40],
    [22, 30],
  ],
];

function mix(color, target, amount) {
  const hex = color.slice(1);
  return (
    '#' +
    [0, 2, 4]
      .map((index) => {
        const channel = Number.parseInt(hex.slice(index, index + 2), 16);
        return Math.round(channel + (target - channel) * amount)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

export function sparkPalette(color = chessRed) {
  if (color === chessRed)
    return {
      shard: ['#aa0b35c4', chessRed, '#ff8292'],
      core: ['#ffd2d7a0', '#ffffff', '#fff2e9'],
    };
  return {
    shard: [mix(color, 0, 0.34) + 'c4', color, mix(color, 255, 0.45)],
    core: [mix(color, 255, 0.8) + 'a0', '#ffffff', '#fff2e9'],
  };
}

function createSparkAtlas(color, glow = 0) {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SPARK_SHAPES.length * tile;
  canvas.height = tile * SPARK_CORE_LEVELS.length;
  const atlas = canvas.getContext('2d');
  const cell = document.createElement('canvas');
  cell.width = cell.height = tile;
  const context = cell.getContext('2d');
  if (!atlas || !context) return null;
  const palette = sparkPalette(color);
  const shard = context.createLinearGradient(7, 37, 36, 16);
  for (const [index, offset] of [0, 0.42, 1].entries())
    shard.addColorStop(offset, palette.shard[index]);
  const core = context.createLinearGradient(17, 32, 35, 18);
  for (const [index, offset] of [0, 0.5, 1].entries())
    core.addColorStop(offset, palette.core[index]);
  for (const [index, points] of SPARK_SHAPES.entries()) {
    const shape = new Path2D();
    const [first, ...rest] = points;
    shape.moveTo(...first);
    for (const point of rest) shape.lineTo(...point);
    for (let row = 0; row < SPARK_CORE_LEVELS.length; row++) {
      context.clearRect(0, 0, tile, tile);
      context.fillStyle = shard;
      context.fill(shape);
      context.save();
      context.setTransform(0.52, 0, 0, 0.52, 12, 11);
      context.globalAlpha = SPARK_CORE_LEVELS[row];
      context.fillStyle = core;
      // Cache the halo with the shard so stepping the animation is one blit per spark.
      if (glow) {
        context.shadowColor = palette.shard[1];
        context.shadowBlur = 12 * glow;
      }
      context.fill(shape);
      context.restore();
      atlas.drawImage(cell, index * tile, row * tile);
    }
  }
  return canvas;
}

let chessAtlas;
let tintedAtlas;
let tintedColor;
let tintedGlow;

/** Preserve the frame's reviewed colors and cache only the most recent custom palette. */
export function getSparkAtlas(color = chessRed, glow = 0) {
  if (color === chessRed && !glow) return (chessAtlas ??= createSparkAtlas(chessRed));
  if (color !== tintedColor || glow !== tintedGlow) {
    tintedAtlas = createSparkAtlas(color, glow);
    tintedColor = color;
    tintedGlow = glow;
  }
  return tintedAtlas;
}

export function drawSpark(context, atlas, x, y, span, age, seed) {
  const tileX = ((seed >>> 7) % SPARK_SHAPES.length) * tile;
  const tileY = (age < 0.28 ? 2 : age < 0.6 ? 1 : 0) * tile;
  context.drawImage(atlas, tileX, tileY, tile, tile, x - span / 2, y - span / 2, span, span);
}
