// SPDX-License-Identifier: GPL-3.0-only
import { SANDEVISTAN_RANGES } from './teleport-effects.mjs';

export const SANDEVISTAN_TRAVEL_MS = 625;
const defaultAnchor = { x: 0.5, y: 1166 / 1254 };
const lerp = (from, to, t) => from + (to - from) * t;
const wrapHue = (hue) => ((hue % 360) + 360) % 360;

function spriteRect(point, anchor, scale) {
  const size = point.scale ?? scale;
  return { x: point.x - anchor.x * size, y: point.y - anchor.y * size, size, clip: point.clip };
}

export function sandevistanPosition({ start, end }, elapsedMs) {
  if (elapsedMs <= 0) return start;
  if (elapsedMs >= SANDEVISTAN_TRAVEL_MS) return end;
  const t = elapsedMs / SANDEVISTAN_TRAVEL_MS;
  const eased = t * t * (3 - 2 * t);
  return {
    x: lerp(start.x, end.x, eased),
    y: lerp(start.y, end.y, eased),
    size: lerp(start.size, end.size, eased),
  };
}

export function prepareSandevistan({
  from,
  to,
  scale,
  anchor = defaultAnchor,
  arrivalAnchor = anchor,
  effects,
}) {
  const option = (key) => {
    const { min, max, defaultValue } = SANDEVISTAN_RANGES[key];
    const value = effects?.[key];
    return Number.isInteger(value) && value >= min && value <= max ? value : defaultValue;
  };
  const start = spriteRect(from, anchor, scale);
  const end = spriteRect(to, arrivalAnchor, scale);
  const holdMs = option('sandevistanHoldMs');
  const count = option('sandevistanCopies');
  const hue = option('sandevistanHue');
  const hueStep = option('sandevistanHueStep');
  const ghosts = Array.from({ length: count }, (_, index) => {
    const bornMs = SANDEVISTAN_TRAVEL_MS * (index / count);
    return {
      bornMs,
      hue: wrapHue(hue + index * hueStep),
      position: sandevistanPosition({ start, end }, bornMs),
    };
  });
  const endMs = Math.max(SANDEVISTAN_TRAVEL_MS, ghosts.at(-1).bornMs + holdMs);
  return {
    start,
    end,
    ghosts,
    holdMs,
    endMs,
    tint: option('sandevistanTint') / 100,
    reducedFlash: effects?.teleportReducedFlash === true,
  };
}

export function sandevistanViewport({ start, end }, { width, height }) {
  const x = Math.min(width - 1, Math.max(0, Math.floor(Math.min(start.x, end.x))));
  const y = Math.min(height - 1, Math.max(0, Math.floor(Math.min(start.y, end.y))));
  const right = Math.min(width, Math.ceil(Math.max(start.x + start.size, end.x + end.size)));
  const bottom = Math.min(height, Math.ceil(Math.max(start.y + start.size, end.y + end.size)));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function sandevistanStamps(image, { ghosts, tint }) {
  if (tint === 0) return ghosts.map(() => image);
  const palette = new Map();
  return ghosts.map(({ hue }) => {
    if (!palette.has(hue)) {
      const stamp = document.createElement('canvas');
      // Build the palette once per flight. Drawing the ghosts needs no per-frame filters.
      stamp.width = stamp.height = 256;
      const ink = stamp.getContext('2d');
      ink.drawImage(image, 0, 0, 256, 256);
      ink.globalCompositeOperation = 'source-atop';
      ink.globalAlpha = tint;
      ink.fillStyle = 'hsl(' + hue + ' 94% 54%)';
      ink.fillRect(0, 0, 256, 256);
      palette.set(hue, stamp);
    }
    return palette.get(hue);
  });
}

function drawSprite(context, image, { x, y, size, clip }, opacity = 1) {
  context.save();
  if (clip) {
    context.beginPath();
    context.rect(clip.x, clip.y, clip.width, clip.height);
    context.clip();
  }
  context.globalAlpha *= opacity;
  context.drawImage(image, x, y, size, size);
  context.restore();
}

export function drawSandevistan(context, motion, elapsedMs, stamps, image) {
  const fadeMs = Math.min(140, motion.holdMs * 0.28);
  const opacity = motion.reducedFlash ? 0.45 : 0.8;
  for (const [index, { bornMs, position }] of motion.ghosts.entries()) {
    const age = elapsedMs - bornMs;
    if (age < 0 || age >= motion.holdMs) continue;
    drawSprite(
      context,
      stamps[index],
      position,
      opacity * Math.min(1, (motion.holdMs - age) / fadeMs),
    );
  }
  if (image) drawSprite(context, image, sandevistanPosition(motion, elapsedMs));
}
