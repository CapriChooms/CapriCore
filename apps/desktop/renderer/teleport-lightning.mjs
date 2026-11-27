// SPDX-License-Identifier: GPL-3.0-only
import {
  boltOnlyFrames,
  draw,
  fps,
  prepareTeleportMotion,
  transitStart,
} from './avatar-teleport-motion.mjs';

export const TELEPORT_BOLT_MS = ((boltOnlyFrames - transitStart) * 1000) / fps;
const activeBolts = new WeakMap();

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

export function teleportBoltMotion(from, to, bounds, { scale, seed, ...options }) {
  if (from.x === to.x && from.y === to.y) return null;
  const effect = {
    from: { ...from, focus: from },
    to: { ...to, focus: to },
    bounds,
    scale,
    seed: seed ?? Math.floor(Math.random() * 0x100000000),
    ...options,
  };
  const motion = prepareTeleportMotion(effect);
  return { ...effect, motion, viewport: lightningViewport(motion, bounds), materialize: false };
}

export function clearTeleportBolt(canvas, completed = false) {
  const animation = activeBolts.get(canvas);
  if (animation) cancelAnimationFrame(animation.frame);
  activeBolts.delete(canvas);
  canvas.hidden = true;
  animation?.onFinish(completed);
}

export function playTeleportBolt(canvas, options, { speed = 1, onFinish = () => {} } = {}) {
  clearTeleportBolt(canvas);
  if (!options || options.viewport.width <= 0 || options.viewport.height <= 0) return false;
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
  const animation = { frame: null, onFinish };
  activeBolts.set(canvas, animation);
  function paint(now) {
    if (activeBolts.get(canvas) !== animation) return;
    const frame = transitStart + (Math.max(0, now - started) * fps * speed) / 1000;
    if (frame >= boltOnlyFrames) {
      clearTeleportBolt(canvas, true);
      return;
    }
    context.clearRect(viewport.x, viewport.y, viewport.width, viewport.height);
    draw(context, { ...options, frame });
    canvas.hidden = false;
    animation.frame = requestAnimationFrame(paint);
  }
  animation.frame = requestAnimationFrame(paint);
  return true;
}
