// SPDX-License-Identifier: GPL-3.0-only

const ARITY = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
const token = /[MLQCZ]|-?(?:\d+(?:\.\d+)?|\.\d+)/g;

/** A bounded set of absolute vector commands, reusable at any board scale. */
export function chessArrowPath(value) {
  if (typeof value !== 'string' || value.length > 1800) throw new Error('Invalid chess arrow path');
  const parts = value.match(token) ?? [];
  if (parts[0] !== 'M' || value.replace(token, '').replace(/[\s,]/g, '') || parts.length > 240)
    throw new Error('Invalid chess arrow path');
  const path = [];
  let command;
  let drawing = false;
  for (let i = 0; i < parts.length; ) {
    if (Object.hasOwn(ARITY, parts[i])) command = parts[i++];
    if (!command || (!drawing && command !== 'M')) throw new Error('Invalid chess arrow path');
    const count = ARITY[command];
    const points = parts.slice(i, i + count).map(Number);
    if (
      points.length !== count ||
      points.some((point) => !Number.isFinite(point) || Math.abs(point) > 3000)
    )
      throw new Error('Invalid chess arrow path');
    path.push([command, points]);
    i += count;
    if (command === 'M') {
      command = 'L';
      drawing = true;
    } else if (command === 'Z') {
      command = undefined;
      drawing = false;
    }
  }
  if (!path.some(([cmd]) => cmd === 'L' || cmd === 'Q' || cmd === 'C'))
    throw new Error('Invalid chess arrow path');
  return path;
}

export function scaleChessArrowPath(value, x, y, offset = 0) {
  return chessArrowPath(value)
    .map(
      ([cmd, coordinates]) =>
        cmd +
        coordinates
          .map((point, i) => Number((i % 2 ? point * y : point * x + offset).toFixed(4)))
          .join(' '),
    )
    .join(' ');
}
