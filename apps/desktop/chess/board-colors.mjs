// SPDX-License-Identifier: GPL-3.0-only

export function refineBoardEdges({ width, height, data }, { x0, y0, x1, y1 }) {
  const radius = Math.max(3, Math.min(12, Math.round(Math.min(x1 - x0, y1 - y0) / 44)));
  // At the board perimeter, alternating tile colors stop on the outer side.
  const findEdge = (estimate, length, start, end, direction, sample) => {
    const contrast = (axis) => {
      let difference = 0;
      for (let tile = 0; tile < 8; tile++) {
        const at = Math.floor(start + ((tile + 0.5) * (end - start)) / 8);
        difference += (tile % 2 ? -1 : 1) * sample(axis, at);
      }
      return Math.abs(difference / 4);
    };
    let edge = Math.round(estimate);
    let best = 9;
    const first = Math.max(1, edge - radius);
    const last = Math.min(length - 1, edge + radius);
    let previous = first <= last ? contrast(first - 1) : 0;
    for (let pixel = first; pixel <= last; pixel++) {
      const current = contrast(pixel);
      const score = (current - previous) * direction - 0.2 * Math.abs(pixel - estimate);
      if (score > best) {
        best = score;
        edge = pixel;
      }
      previous = current;
    }
    return Math.max(0, Math.min(length, edge));
  };
  const column = (x, y) => data[y * width + x];
  const row = (y, x) => data[y * width + x];
  return {
    x0: findEdge(x0, width, y0, y1, 1, column),
    y0: findEdge(y0, height, x0, x1, 1, row),
    x1: findEdge(x1, width, y0, y1, -1, column),
    y1: findEdge(y1, height, x0, x1, -1, row),
  };
}

// Sample the square background along its edges, away from pieces and rank labels.
export function markedSquares(bitmap) {
  const { width, height } = bitmap.getSize();
  const bytes = bitmap.toBitmap();
  const offsets = [
    [0.5, 0.13],
    [0.5, 0.87],
    [0.13, 0.5],
    [0.87, 0.5],
  ];
  const tiles = Array.from({ length: 64 }, (_, index) => {
    const col = index % 8;
    const row = Math.floor(index / 8);
    const samples = offsets.map(([dx, dy]) => {
      const x = Math.floor(((col + dx) * width) / 8);
      const y = Math.floor(((row + dy) * height) / 8);
      const at = (y * width + x) * 4;
      return [bytes[at], bytes[at + 1], bytes[at + 2]];
    });
    const color = [0, 1, 2].map((channel) => {
      const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
      return (values[1] + values[2]) / 2;
    });
    return { index, parity: (col + row) % 2, color };
  });
  const distance = (a, b) => Math.hypot(...a.map((value, channel) => value - b[channel]));
  const marked = [];
  for (const parity of [0, 1]) {
    const group = tiles.filter((tile) => tile.parity === parity);
    const base = [0, 1, 2].map(
      (channel) => group.map((tile) => tile.color[channel]).sort((a, b) => a - b)[16],
    );
    const unchanged = group.filter(({ color }) => distance(color, base) < 15);
    if (unchanged.length < 26) return [];
    for (const { index, color } of group) {
      if (distance(color, base) >= 33) marked.push(index);
    }
  }
  // One selection or more than two colored squares cannot identify a previous move.
  return marked.length === 2 ? marked : [];
}
