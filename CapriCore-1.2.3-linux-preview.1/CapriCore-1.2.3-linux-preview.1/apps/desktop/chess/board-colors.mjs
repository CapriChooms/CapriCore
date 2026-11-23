// SPDX-License-Identifier: GPL-3.0-only

function median(values) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return (values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2;
}

export function refineBoardEdges({ width, height, data }, { x0, y0, x1, y1 }) {
  const radius = Math.max(3, Math.min(12, Math.round(Math.min(x1 - x0, y1 - y0) / 44)));
  const findEdge = (estimate, length, start, end, direction, sample) => {
    const coordinates = [[], []];
    for (let tile = 0; tile < 8; tile++) {
      for (const fraction of [0.25, 0.5, 0.75])
        coordinates[tile % 2].push(Math.floor(start + ((tile + fraction) * (end - start)) / 8));
    }
    const contrast = (pixel) =>
      median(coordinates[0].map((at) => sample(pixel, at))) -
      median(coordinates[1].map((at) => sample(pixel, at)));
    const clamp = (pixel, maximum = length) => Math.max(0, Math.min(maximum, pixel));
    const edge = clamp(Math.round(estimate));
    const lastTileOffset = direction < 0 ? 1 : 0;
    const interior = median(
      [2, 4, 6].map((offset) =>
        contrast(clamp(edge + direction * (radius + offset) - lastTileOffset, length - 1)),
      ),
    );
    if (Math.abs(interior) < 16) return edge;
    const threshold = Math.abs(interior) * 0.35;
    const parity = Math.sign(interior);
    const boardLine = (pixel) =>
      pixel >= 0 && pixel < length && contrast(pixel) * parity >= threshold;

    // Follow the checkerboard from the outside in. A piece or one bright line
    // inside the board cannot win over the first sustained strip of tile colors.
    const first = clamp(edge - direction * radius);
    const last = clamp(edge + direction * radius);
    for (let boundary = first; (last - boundary) * direction >= 0; boundary += direction) {
      const pixel = boundary - lastTileOffset;
      if (!boardLine(pixel) || boardLine(pixel - direction)) continue;
      const neighbors = [1, 2, 3].filter((offset) => boardLine(pixel + direction * offset));
      if (neighbors.length >= 2) return boundary;
    }
    return edge;
  };
  const column = (x, y) => data[Math.max(0, Math.min(height - 1, y)) * width + x];
  const row = (y, x) => data[y * width + Math.max(0, Math.min(width - 1, x))];
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
