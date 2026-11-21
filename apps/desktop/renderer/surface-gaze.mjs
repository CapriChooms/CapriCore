// SPDX-License-Identifier: GPL-3.0-only
import { deformPoint } from './idle-gesture-rig.mjs';

// Optical-centre landmarks in each original 1254px drawing (screen left, right).
const eyeCentres = {
  'pose-sit-edge': [
    [588, 416],
    [658, 392],
  ],
  'pose-ceiling': [
    [588, 385],
    [654, 365],
  ],
  'pose-dock-left': [
    [559, 378],
    [631, 360],
  ],
  'pose-dock-right': [
    [541, 357],
    [607, 327],
  ],
};
const radius = 28;
const size = radius * 2 + 1;
const spokes = 96;
const twoPi = Math.PI * 2;
const cache = new WeakMap();
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function tile() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

function sample(data, x, y, channel) {
  x = clamp(x, 0, size - 1);
  y = clamp(y, 0, size - 1);
  const col = Math.floor(x),
    row = Math.floor(y);
  const w = x - col,
    h = y - row;
  const i = (row * size + col) * 4 + channel;
  const right = col < size - 1 ? 4 : 0;
  const below = row < size - 1 ? size * 4 : 0;
  return (
    (data[i] * (1 - w) + data[i + right] * w) * (1 - h) +
    (data[i + below] * (1 - w) + data[i + below + right] * w) * h
  );
}

// The bright green ring is part of the fixed housing. Trace the inside lip and
// separate the original blue/white optic from the dark socket on every ray.
function traceSpoke(pixels, angle) {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  let lens = 5,
    rim = 24,
    darkest = Infinity,
    lining = [1, 6, 6];
  for (let r = 5; r <= 26; r += 0.25) {
    const x = radius + cos * r,
      y = radius + sin * r;
    const red = sample(pixels, x, y, 0),
      green = sample(pixels, x, y, 1);
    const blue = sample(pixels, x, y, 2);
    if (green > 67 && green > red * 2 && green > blue * 1.35) {
      rim = r;
      break;
    }
    if (blue > 16 && blue > green * 1.16) lens = r;
    if (r > lens && red + green + blue < darkest) {
      darkest = red + green + blue;
      lining = [red, green, blue];
    }
  }
  return { rim, lens, lining };
}

function glassLayers(image, [cx, cy]) {
  const back = tile(),
    optic = tile(),
    aperture = tile(),
    output = tile();
  const base = back.getContext('2d', { willReadFrequently: true });
  const lensContext = optic.getContext('2d');
  const maskContext = aperture.getContext('2d');
  base.drawImage(image, cx - radius, cy - radius, size, size, 0, 0, size, size);
  const backPixels = base.getImageData(0, 0, size, size);
  const pixels = backPixels.data;
  const lensPixels = lensContext.createImageData(size, size);
  const maskPixels = maskContext.createImageData(size, size);
  const shell = Array.from({ length: spokes }, (_, i) => traceSpoke(pixels, (i * twoPi) / spokes));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const dx = x - radius,
        dy = y - radius;
      const distance = Math.hypot(dx, dy);
      const spoke = ((Math.atan2(dy, dx) / twoPi + 1) * spokes) % spokes;
      const left = shell[Math.floor(spoke)],
        right = shell[(Math.floor(spoke) + 1) % spokes];
      const f = spoke % 1;
      const rim = left.rim * (1 - f) + right.rim * f;
      const lens = left.lens * (1 - f) + right.lens * f;
      maskPixels.data[index + 3] = 255 * clamp(rim - distance + 0.1, 0, 1);
      const coverage = clamp(lens - distance + 1.5, 0, 1);
      if (coverage === 0) continue;
      for (let c = 0; c < 3; c++) {
        lensPixels.data[index + c] = pixels[index + c];
        const dark = left.lining[c] * (1 - f) + right.lining[c] * f;
        pixels[index + c] += (dark - pixels[index + c]) * coverage;
      }
      lensPixels.data[index + 3] = 255 * coverage;
    }
  }
  base.putImageData(backPixels, 0, 0);
  lensContext.putImageData(lensPixels, 0, 0);
  maskContext.putImageData(maskPixels, 0, 0);
  return { cx, cy, back, optic, aperture, output, context: output.getContext('2d') };
}

function aim(eye, x, y) {
  if (x === eye.lastX && y === eye.lastY) return;
  const { context } = eye;
  context.clearRect(0, 0, size, size);
  context.drawImage(eye.back, 0, 0);
  context.drawImage(eye.optic, x, y);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(eye.aperture, 0, 0);
  context.globalCompositeOperation = 'source-over';
  eye.lastX = x;
  eye.lastY = y;
}

/** Draw the moving optical cores over the deformed sprite. (0,0) is the original art. */
export function drawSurfaceGaze(context, image, frameId, gaze, channels) {
  const centres = eyeCentres[frameId];
  if (!centres || !channels || !Number.isFinite(gaze?.x) || !Number.isFinite(gaze?.y)) return false;
  const x = clamp(gaze.x, -1, 1),
    y = clamp(gaze.y, -1, 1);
  if (x === 0 && y === 0) return false;
  const source = image.currentSrc || image.src;
  let entry = cache.get(image);
  if (!entry || entry.source !== source || entry.frameId !== frameId) {
    entry = { source, frameId, eyes: centres.map((point) => glassLayers(image, point)) };
    cache.set(image, entry);
  }
  entry.eyes.forEach((eye, i) => {
    // The near eye is larger. Both look along the same ray while the shell
    // occludes the optic at its limit. A quarter source pixel is <0.05 DIP.
    aim(eye, Math.round(x * (i ? 9 : 7.5) * 4) / 4, Math.round(y * (i ? 8 : 7) * 4) / 4);
    const { cx, cy } = eye;
    const ox = cx + 0.5,
      oy = cy + 0.5;
    const origin = deformPoint(ox, oy, channels);
    const alongX = deformPoint(ox + 1, oy, channels),
      alongY = deformPoint(ox, oy + 1, channels);
    context.save();
    context.transform(
      alongX[0] - origin[0],
      alongX[1] - origin[1],
      alongY[0] - origin[0],
      alongY[1] - origin[1],
      origin[0],
      origin[1],
    );
    context.drawImage(eye.output, -radius - 0.5, -radius - 0.5);
    context.restore();
  });
  return true;
}
