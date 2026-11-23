// SPDX-License-Identifier: GPL-3.0-only
import catalogue from '../../config/cyberpunk-portraits.json' with { type: 'json' };

// 208 comparisons of neighbouring luminance samples. Retain mean color to
// distinguish otherwise similar outlines. No original pixels are stored here.
export const portraitGrid = 9;
const bytesPerHash = 26;
export function portraitSignature(pixels) {
  const values = new Float32Array(portraitGrid ** 2);
  const color = [0, 0, 0];
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4;
    const alpha = pixels[offset + 3] / 255;
    const blue = pixels[offset] + 32 * (1 - alpha);
    const green = pixels[offset + 1] + 32 * (1 - alpha);
    const red = pixels[offset + 2] + 32 * (1 - alpha);
    values[index] = red * 0.299 + green * 0.587 + blue * 0.114;
    color[0] += red;
    color[1] += green;
    color[2] += blue;
  }
  const hash = Buffer.alloc(bytesPerHash);
  let bit = 0;
  for (let row = 0; row < portraitGrid; row++) {
    for (let column = 0; column < portraitGrid; column++) {
      const index = row * portraitGrid + column;
      if (column + 1 < portraitGrid) {
        if (values[index] > values[index + 1] + 1) hash[bit >> 3] |= 1 << bit % 8;
        bit++;
      }
      if (row + 1 < portraitGrid) {
        if (values[index] > values[index + portraitGrid] + 1) hash[bit >> 3] |= 1 << bit % 8;
        bit++;
      }
      if (row + 1 < portraitGrid && column + 1 < portraitGrid) {
        if (values[index] > values[index + portraitGrid + 1] + 1) hash[bit >> 3] |= 1 << bit % 8;
        bit++;
      }
    }
  }
  return [hash.toString('hex'), color.map((sum) => Math.round(sum / values.length))];
}

const popcount = Array.from(
  { length: 256 },
  (_, index) => index.toString(2).replaceAll('0', '').length,
);
const entries = catalogue.map(({ name, ratio, signature: [hex, color] }) => ({
  name,
  ratio,
  hash: Buffer.from(hex, 'hex'),
  color,
}));

export function matchCharacterPortrait(image) {
  if (image.isEmpty()) return;
  const { width, height } = image.getSize();
  if (width < 72 || height < 72) return;
  // Match the same small sampling grid used for the shipped references.
  const [hex, color] = portraitSignature(
    image.resize({ width: portraitGrid, height: portraitGrid, quality: 'best' }).toBitmap(),
  );
  const ratio = width / height;
  const hash = Buffer.from(hex, 'hex');
  const distances = new Map();
  for (const entry of entries) {
    if (Math.abs(Math.log(ratio / entry.ratio)) > 0.1) continue;
    if (entry.color.some((channel, index) => Math.abs(channel - color[index]) > 28)) continue;
    let distance = 0;
    for (let index = 0; index < bytesPerHash; index++)
      distance += popcount[hash[index] ^ entry.hash[index]];
    distances.set(entry.name, Math.min(distance, distances.get(entry.name) ?? Infinity));
  }
  const ranked = [...distances].sort((left, right) => left[1] - right[1]);
  const [closest, best] = ranked[0] ?? [];
  const runnerUp = ranked[1]?.[1] ?? Infinity;
  return best <= 17 && runnerUp - best >= 9 ? closest : undefined;
}
