// SPDX-License-Identifier: GPL-3.0-only
// A separable Gaussian feather, sampled only when size or settings change.
function erf(value) {
  const sign = value < 0 ? -1 : 1,
    x = Math.abs(value),
    t = 1 / (1 + 0.3275911 * x);
  return (
    sign *
    (1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x))
  );
}
const low = erf(-3),
  span = erf(3) - low;
export function feather(distance, radius) {
  if (radius <= 0) return 1;
  if (distance <= 0) return 0;
  if (distance >= radius) return 1;
  return Math.max(0, Math.min(1, (erf((distance / radius) * 6 - 3) - low) / span));
}
export function dimmingPixels(width, height, softness, maxSize = 1024) {
  const scale = Math.min(1, maxSize / Math.max(width, height, 1));
  const w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  const radius = Math.min(Math.max(0, softness), width / 2, height / 2);
  const data = new Uint8ClampedArray(w * h * 4);
  const xs = Array.from({ length: w }, (_, i) => feather(Math.min(i, w - 1 - i) / scale, radius));
  for (let y = 0; y < h; y++) {
    const alpha = feather(Math.min(y, h - 1 - y) / scale, radius);
    for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = Math.round(255 * alpha * xs[x]);
  }
  return { width: w, height: h, data };
}
export class DimmingMask {
  constructor(element) {
    this.canvas = element.ownerDocument.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    element.append(this.canvas);
  }
  draw(width, height, softness) {
    const key = [Math.round(width), Math.round(height), softness].join(':');
    if (key === this.key) return;
    this.key = key;
    const pixels = dimmingPixels(width, height, softness);
    this.canvas.width = pixels.width;
    this.canvas.height = pixels.height;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  }
}
