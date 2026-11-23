// SPDX-License-Identifier: GPL-3.0-only
import {
  boltOnlyFrames,
  draw,
  fps,
  prepareTeleportMotion,
  transitStart,
} from './avatar-teleport-motion.mjs';

export const CHESS_LIGHTNING_MS = ((boltOnlyFrames - transitStart) * 1000) / fps;
const activeFlashes = new WeakMap();

function lightningViewport(motion, { width, height }) {
  const padding = Math.max(
    14 + Math.max(motion.boltScale, motion.arrivalScale) * 0.9 + motion.profile.glow * 35,
    ...motion.sparks.map(({ reach, drift, size }) => 3 + reach + Math.abs(drift) + size),
  );
  const x = motion.points.map((point) => point.x);
  const y = motion.points.map((point) => point.y);
  const left = Math.max(0, Math.floor(Math.min(...x) - padding));
  const top = Math.max(0, Math.floor(Math.min(...y) - padding));
  const right = Math.min(width, Math.ceil(Math.max(...x) + padding));
  const bottom = Math.min(height, Math.ceil(Math.max(...y) + padding));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function chessLightningMotion(uci, orientation, bounds, options = {}) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) || uci.slice(0, 2) === uci.slice(2, 4))
    return null;
  if (orientation !== 'white' && orientation !== 'black') return null;
  const { width, height } = bounds;
  if (!(width > 0 && height > 0)) return null;
  const square = (index) => {
    const file = uci.charCodeAt(index) - 97;
    const rank = Number(uci[index + 1]) - 1;
    const x = (((orientation === 'white' ? file : 7 - file) + 0.5) * width) / 8;
    const y = (((orientation === 'white' ? 7 - rank : rank) + 0.5) * height) / 8;
    return { x, y, focus: { x, y } };
  };
  const from = square(0);
  const to = square(2);
  const scale = Math.min(width, height) * 0.105;
  const seed = options.seed ?? Math.floor(Math.random() * 0x100000000);
  const effect = { from, to, bounds, scale, seed, ...options };
  const motion = prepareTeleportMotion(effect);
  return {
    ...effect,
    motion,
    viewport: lightningViewport(motion, bounds),
    materialize: false,
    drawCapri() {},
  };
}

export function clearChessMoveLightning(canvas) {
  const animation = activeFlashes.get(canvas);
  if (animation) cancelAnimationFrame(animation.frame);
  activeFlashes.delete(canvas);
  canvas.hidden = true;
}

export function showChessMoveLightning(canvas, { uci, orientation, effects }) {
  clearChessMoveLightning(canvas);
  const { clientWidth: width, clientHeight: height } = canvas.parentElement;
  const bounds = { width, height };
  const options = chessLightningMotion(uci, orientation, bounds, {
    reducedFlash: matchMedia('(prefers-reduced-motion: reduce)').matches,
    effects,
  });
  if (!options) return false;
  const context = canvas.getContext('2d');
  if (!context) return false;
  const viewport = options.viewport;
  const ratio = Math.min(devicePixelRatio, 2048 / Math.max(viewport.width, viewport.height));
  const pixelWidth = Math.ceil(viewport.width * ratio);
  const pixelHeight = Math.ceil(viewport.height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  Object.assign(canvas.style, {
    left: `${viewport.x}px`,
    top: `${viewport.y}px`,
    width: `${viewport.width}px`,
    height: `${viewport.height}px`,
  });
  const sx = pixelWidth / viewport.width;
  const sy = pixelHeight / viewport.height;
  context.setTransform(sx, 0, 0, sy, -viewport.x * sx, -viewport.y * sy);
  const started = performance.now();
  const animation = { frame: null };
  activeFlashes.set(canvas, animation);
  function paint(now) {
    if (activeFlashes.get(canvas) !== animation) return;
    const frame = transitStart + (Math.max(0, now - started) * fps) / 1000;
    if (frame >= boltOnlyFrames) {
      clearChessMoveLightning(canvas);
      return;
    }
    context.clearRect(viewport.x, viewport.y, viewport.width, viewport.height);
    draw(context, { ...options, frame });
    if (canvas.hidden) canvas.hidden = false;
    animation.frame = requestAnimationFrame(paint);
  }
  animation.frame = requestAnimationFrame(paint);
  return true;
}
