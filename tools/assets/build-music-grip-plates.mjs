// SPDX-License-Identifier: GPL-3.0-only
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { armRegions, gripArt } from '../../apps/desktop/renderer/music-grip-art.mjs';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = requireCapriAvatar(root);
const read = (id) => PNG.sync.read(readFileSync(catalog.frames.find((f) => f.id === id).file));
const sample = (img, x, y) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return img.data.subarray(i, i + 4);
};
const clear = Buffer.alloc(4);
const donor = read('pose-dock-left');
function inside(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i],
      [bx, by] = poly[j];
    if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) hit = !hit;
  }
  return hit;
}
const shadow = [188, 0, 38, 253],
  ink = [8, 5, 10, 253];
const innerBang = [
  [553, 381],
  [573, 395],
  [568, 430],
  [562, 415],
];
const longLash = [
  [680, 352],
  [806, 293],
  [680, 376],
];
const shortLash = [
  [682, 375],
  [754, 366],
  [682, 392],
];
const smallShadow = [
  [624, 443],
  [701, 405],
  [680, 433],
  [650, 433],
];
const crownNotch = [
  [769, 187],
  [886, 198],
  [853, 211],
  [895, 229],
  [808, 227],
  [819, 207],
  [771, 194],
];
const headArea = [
  [179, 48],
  [1080, 48],
  [1080, 655],
  [707, 655],
  [678, 507],
  [663, 468],
  [638, 447],
  [623, 441],
  [596, 457],
  [574, 461],
  [541, 519],
  [441, 527],
  [179, 527],
];
const clamp = (n) => Math.max(0, Math.min(1, n));
function sparkledRed(x, y) {
  // A single, untranslated-in-time texture across the entire crown. Taking
  // the glitter at original resolution keeps individual speckles round.
  const pixel = sample(donor, x - 21, y - 21);
  const star = pixel[0] > 223 && pixel[3] > 240 ? clamp((pixel[1] - 2) / 250) : 0;
  return [Math.round(249 + 6 * star), Math.round(2 + 253 * star), Math.round(49 + 206 * star), 253];
}
function hiddenMaterial(side, x, y) {
  if (y < (side === 0 ? 129 - ((x - 436) * 18) / 201 : 112 + ((x - 682) * 11) / 168)) return 0;
  if (side === 0) {
    if (inside(x, y, innerBang)) return 2;
    if (x > 543.8 - 0.84 * (y - 440)) return 0;
    return x > 526.5 - 0.64 * (y - 440) ? 2 : 1;
  }
  if (inside(x, y, crownNotch)) return 3;
  if (y > 193 && y < 261 && x > 771 + 0.55 * (y - 193)) return 0;
  if (inside(x, y, longLash) || inside(x, y, shortLash)) return 3;
  if (y >= 432 && (x < 680 - 0.2 * (y - 430) || x > 730 - 1.34 * (y - 449))) return 0;
  return y >= 432 || x > 795 - 1.9 * (y - 380) || inside(x, y, smallShadow) ? 2 : 1;
}
function cleanCrown(back, img, profile) {
  // Cut beyond the antialiasing of the original forearms, including the dark
  // pixels at the crossing of the right forearm and the two face spikes.
  const regions = armRegions({
    ...profile,
    arms: profile.arms.map((arm) => ({
      ...arm,
      bands: arm.bands.map(([s, a, b]) => [s, a - 8, b + 8]),
    })),
  });
  for (let y = 65; y < 655; y++)
    for (let x = 185; x < 1060; x++) {
      if (!inside(x + 0.5, y + 0.5, headArea) || inside(x + 0.5, y + 0.5, profile.face)) continue;
      const offset = (y * 1254 + x) * 4,
        original = sample(img, x, y);
      const side = regions.findIndex(
        (r) =>
          x >= r.x &&
          x < r.x + r.w &&
          y >= r.y &&
          y < r.y + r.h &&
          inside(x + 0.5, y + 0.5, r.outline),
      );
      if (side !== -1) {
        if (
          y > 466 &&
          ((original[2] > original[0] * 1.3 && original[2] > 25) ||
            (original[1] > 65 && original[1] > original[0] * 1.1))
        )
          continue;
        const colors = [clear, sparkledRed(x, y), shadow, ink],
          sum = [0, 0, 0, 0];
        for (const dx of [0.25, 0.75])
          for (const dy of [0.25, 0.75]) {
            const c = colors[hiddenMaterial(side, x + dx, y + dy)];
            for (let k = 0; k < 3; k++) sum[k] += c[k] * c[3];
            sum[3] += c[3];
          }
        for (let k = 0; k < 3; k++) back[offset + k] = Math.round(sum[k] / (sum[3] || 1));
        back[offset + 3] = Math.round(sum[3] / 4);
        continue;
      }
      const [r, g, b, a] = original;
      if (!a || r < 100 || g > r * 1.08 || b > r * 1.15) continue;
      const light = clamp((r - 204) / 41),
        color = sparkledRed(x, y);
      // Preserve the source silhouette and the antialiased edges of its ink.
      const coverage = clamp((r - 100) / 70);
      for (let k = 0; k < 3; k++) {
        const fill = shadow[k] + (color[k] - shadow[k]) * light;
        back[offset + k] = Math.round(original[k] + (fill - original[k]) * coverage);
      }
    }
}
// Continue the three long colour boundaries through the arm crossing. The
// hot-pink facet on the nearer lock tapers independently of both silhouettes.
function cleanRightTips(back, img) {
  const cover = (x, a, b) => Math.max(0, Math.min(x + 0.5 - a, b - x + 0.5, 1));
  for (let y = 429; y < 493; y++)
    for (let x = 766; x <= 919; x++) {
      const t = y - 430;
      const outer = 804.4 - 0.212 * t,
        nearRight = 862.2 - 0.715 * t,
        bright = 848.4 - 0.56 * t;
      const farLeft = 853.5 - 0.294 * t,
        farRight = 896.5 - 0.664 * t;
      const a = cover(x, outer, nearRight),
        b = cover(x, farLeft, farRight);
      const gloss = cover(x, bright, nearRight);
      const coverage = Math.max(a, b),
        alpha = Math.min(1, (y - 429) / 7, (493 - y) / 8);
      const out = (y * img.width + x) * 4;
      const source = back.subarray(out, out + 4);
      const base = [179 + 1.6 * Math.sin(0.13 * x), 0, 31];
      const shine = [247, 1, 50];
      const newAlpha = 253 * coverage * alpha,
        oldAlpha = source[3] * (1 - alpha);
      for (let k = 0; k < 3; k++)
        back[out + k] = Math.round(
          ((base[k] * (1 - gloss) + shine[k] * gloss) * newAlpha + source[k] * oldAlpha) /
            (newAlpha + oldAlpha || 1),
        );
      back[out + 3] = Math.round(newAlpha + oldAlpha);
    }
}
const directory = path.join(root, 'assets/default/music-grip-plates');
mkdirSync(directory, { recursive: true });
for (const [id, profile] of Object.entries(gripArt)) {
  const img = read(id),
    regions = armRegions(profile);
  const atlas = new PNG({ width: 1254, height: 1254 + regions.reduce((h, r) => h + r.h, 0) });
  atlas.data.set(img.data);
  for (const [index, r] of regions.entries()) {
    for (let j = 0; j < r.h; j++)
      for (let i = 0; i < r.w; i++) {
        const x = r.x + i,
          y = r.y + j,
          original = sample(img, x, y);
        if (!original[3] || !inside(x + 0.5, y + 0.5, r.outline)) continue;
        const [red, green, blue] = original;
        const crossesHair = id === 'pose-ceiling' || (id === 'pose-dock-right' && index === 0);
        const armInk = (red < 132 && blue < 100) || (green > red * 1.15 && green > blue * 1.3);
        const collar =
          id === 'pose-ceiling' && y > 455 && ((blue > red * 1.3 && blue > 25) || green > 65);
        if ((crossesHair && !armInk) || collar) continue;
        atlas.data.set(original, ((r.row + j) * atlas.width + i) * 4);
        atlas.data.set(clear, (y * atlas.width + x) * 4);
      }
  }
  if (id === 'pose-ceiling') cleanCrown(atlas.data, img, profile);
  if (id === 'pose-dock-right') cleanRightTips(atlas.data, img);
  writeFileSync(path.join(directory, id + '.png'), PNG.sync.write(atlas));
}
