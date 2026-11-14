// SPDX-License-Identifier: GPL-3.0-only
import { avatarPoseLandmarks } from './avatar-mouth.mjs';

// Registered to the standing sprite's 1254 × 1254 canvas. The patch ends at
// the bangs and jaw, so pose, silhouette, and hair grain stay on the live frame.
const faceOutline = [
  [570, 390],
  [607, 351],
  [632, 386],
  [654, 344],
  [712, 326],
  [715, 401],
  [703, 407],
  [677, 439],
  [655, 462],
  [605, 453],
  [582, 444],
];

// Register the 1.0.4 headpat drawing to each pose's eyes and mouth.
// Reusing the whole local face removes the eye rings as well as the pupils;
// drawing lids inside the pupil circles left the outer eyes visibly open.
const faceRegistration = [
  [608, 400],
  [680, 373],
  [646, 430],
];
const standing = avatarPoseLandmarks('neutral');
const standingRegistration = [...standing.eyes, standing.mouth];
const expressions = {
  curious: 'skeptical',
  neutral: 'attentive',
  boundary: 'annoyed',
  blink: 'idle-blink_closed',
};

export function headpatFaceTransform(pose, source = faceRegistration) {
  const [[sx, sy], [ex, ey], [mx, my]] = source;
  const [[tx, ty], [ux, uy]] = pose.eyes;
  const [vx, vy] = pose.mouth;
  const ax = ex - sx,
    ay = ey - sy,
    bx = mx - sx,
    by = my - sy;
  const determinant = ax * by - ay * bx;
  const a = ((ux - tx) * by - (vx - tx) * ay) / determinant;
  const c = (ax * (vx - tx) - bx * (ux - tx)) / determinant;
  const b = ((uy - ty) * by - (vy - ty) * ay) / determinant;
  const d = (ax * (vy - ty) - bx * (uy - ty)) / determinant;
  return [a, b, c, d, tx - a * sx - c * sy, ty - b * sx - d * sy];
}

export class AvatarHeadpat {
  constructor(host, onFaceChange = () => {}) {
    this.host = host;
    this.onFaceChange = onFaceChange;
    this.face = new Image();
    this.face.src = 'headpat-face.png';
    this.face.addEventListener('load', () => this.refresh());
    this.spriteLoaded = () => this.refresh();
    this.expressions = new Map();
  }

  play(sprite, { x, y }, bounds, showFace = true, frameId) {
    if (!sprite || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const pose = avatarPoseLandmarks(frameId);
    // A hearts-only reaction must not install a face plate over the live pose.
    if (showFace && pose?.eyes) this.setFace(sprite, frameId, pose, 'affectionate');
    if (!this.hearts || performance.now() - this.burstAt >= 220) this.burst(x, y, bounds);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), 1450);
  }

  react(sprite, frameId, tone) {
    const pose = avatarPoseLandmarks(frameId);
    if (!pose?.eyes || !Object.hasOwn(expressions, tone)) return false;
    this.setFace(sprite, frameId, pose, tone);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.clear(), tone === 'blink' ? 130 : 740);
    return true;
  }

  setFace(sprite, frameId, pose, tone) {
    if (sprite !== this.sprite) {
      this.clear();
      this.sprite = sprite;
      this.plate = document.createElement('canvas');
      this.plate.className = 'avatar-headpat-plate';
      this.plate.setAttribute('aria-hidden', 'true');
      this.plate.hidden = true;
      this.plate.style.cssText = sprite.style.cssText;
      sprite.after(this.plate);
      sprite.addEventListener('load', this.spriteLoaded);
    }
    if (frameId === this.frameId && tone === this.tone && !this.plate.hidden) return;
    this.pose = pose;
    this.frameId = frameId;
    this.sourceUrl = sprite.src;
    this.tone = tone;
    this.plate.dataset.expression = tone;
    this.refresh();
  }

  refresh() {
    const { pose, sprite, plate, tone } = this;
    if (!plate) return;
    if (this.sourceUrl !== sprite.src) {
      this.clear();
      return;
    }
    const affectionate = tone === 'affectionate';
    const face = affectionate ? this.face : this.expressionAsset(tone);
    if (
      !sprite?.complete ||
      sprite.naturalWidth !== 1254 ||
      sprite.naturalHeight !== 1254 ||
      !face.complete ||
      face.naturalWidth !== 1254 ||
      face.naturalHeight !== 1254
    )
      return;
    plate.width = sprite.naturalWidth;
    plate.height = sprite.naturalHeight;
    const ctx = plate.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(sprite, 0, 0, plate.width, plate.height);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.transform(...headpatFaceTransform(pose));
    // The contour was registered on the 1.0.4 headpat asset.
    ctx.beginPath();
    ctx.moveTo(...faceOutline[0]);
    for (const [x, y] of faceOutline.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.clip();
    if (!affectionate) {
      if (tone === 'blink') {
        ctx.beginPath();
        ctx.moveTo(560, 343);
        ctx.lineTo(716, 295);
        ctx.lineTo(716, 396);
        ctx.lineTo(560, 443);
        ctx.closePath();
        ctx.clip();
      }
      ctx.resetTransform();
      ctx.transform(...headpatFaceTransform(pose, standingRegistration));
    }
    ctx.drawImage(face, 0, 0);
    plate.avatarTextureRevision = (plate.avatarTextureRevision ?? 0) + 1;
    plate.hidden = false;
    this.onFaceChange();
  }

  image(sprite) {
    return this.sprite === sprite && this.sourceUrl === sprite.src && !this.plate.hidden
      ? this.plate
      : sprite;
  }

  expressionAsset(tone) {
    if (!this.expressions.has(tone)) {
      const image = new Image();
      image.addEventListener('load', () => this.refresh(), { once: true });
      image.src = `capri://desktop/sprites/${expressions[tone]}.png`;
      this.expressions.set(tone, image);
    }
    return this.expressions.get(tone);
  }

  burst(x, y, bounds) {
    this.hearts?.remove();
    this.burstAt = performance.now();
    const host = this.host.getBoundingClientRect();
    const {
      x: left,
      y: top,
      width,
      height,
    } = bounds ?? {
      x: 0,
      y: 0,
      width: host.width,
      height: host.height,
    };
    const hearts = document.createElement('span');
    hearts.className = 'avatar-headpat-hearts';
    hearts.setAttribute('aria-hidden', 'true');
    // Keep space for the burst even when the crown is up against the frame edge.
    hearts.style.left = `${left + Math.max(43, Math.min(width - 43, x - host.left - left))}px`;
    hearts.style.top = `${top + Math.max(54, Math.min(height - 10, y - host.top - top))}px`;
    for (let i = 0; i < 4; i++) hearts.append(document.createElement('i'));
    this.host.append(hearts);
    this.hearts = hearts;
  }

  clear() {
    const faceVisible = this.plate && !this.plate.hidden;
    clearTimeout(this.timer);
    this.sprite?.removeEventListener('load', this.spriteLoaded);
    this.plate?.remove();
    this.hearts?.remove();
    this.plate = this.sprite = this.hearts = null;
    this.pose = null;
    this.tone = null;
    this.frameId = null;
    if (faceVisible) this.onFaceChange();
  }
}
