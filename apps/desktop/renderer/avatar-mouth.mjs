// SPDX-License-Identifier: GPL-3.0-only

const shapes = ['closed', 'small', 'round', 'wide'];

// Measured on the normalized CapriDesign exports. Angles are relative to the
// rendered raster, including the inverted jaw. The right grip is its own drawing.
const poseLandmarks = Object.freeze({
  'music-window': {
    mouth: [655, 403, -0.46, 36],
    face: [639, 375],
    crown: 76,
    eyes: [
      [599, 376, 18],
      [675, 346, 21],
    ],
  },
  'music-floor': {
    mouth: [661, 642, -0.47, 39],
    face: [645, 615],
    crown: 296,
    eyes: [
      [605, 616, 19],
      [683, 585, 22],
    ],
  },
  'pose-ceiling': {
    mouth: [634, 396, -0.36, 32],
    face: [625, 372],
    crown: 76,
    eyes: [
      [592, 371, 18],
      [661, 345, 21],
    ],
  },
  'pose-ceiling-upside-down': {
    mouth: [621, 676, Math.PI, 33],
    face: [623, 708],
    crown: 84,
    inverted: true,
    eyes: [
      [590, 714, 17],
      [657, 711, 19],
    ],
  },
  'pose-dock-left': {
    mouth: [593, 416, -0.32, 38],
    face: [590, 389],
    crown: 76,
    eyes: [
      [552, 386, 18],
      [628, 364, 22],
    ],
  },
  'pose-dock-right': {
    mouth: [572, 388, -0.36, 33],
    face: [561, 357],
    crown: 76,
    eyes: [
      [526, 361, 17],
      [593, 333, 21],
    ],
  },
  'pose-sit-edge': {
    mouth: [638, 430, -0.4, 33],
    face: [624, 399],
    crown: 111,
    eyes: [
      [592, 405, 18],
      [667, 377, 22],
    ],
  },
  'pose-sit-floor': {
    mouth: [620, 588, -0.41, 34],
    face: [610, 559],
    crown: 247,
    eyes: [
      [575, 562, 18],
      [645, 532, 22],
    ],
  },
  'pose-crouch': {
    mouth: [617, 679, -0.42, 36],
    face: [609, 635],
    crown: 339,
    eyes: [
      [570, 655, 17],
      [643, 624, 22],
    ],
  },
});

export function avatarPoseLandmarks(frameId) {
  return Object.hasOwn(poseLandmarks, frameId) ? poseLandmarks[frameId] : null;
}

function polygon(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPoseMouth(ctx, shape, [x, y, angle, width]) {
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(width / 34, width / 34);
  polygon(
    ctx,
    [
      [-22, -10],
      [22, -9],
      [20, 11],
      [7, 15],
      [-22, 11],
    ],
    '#080911',
  );
  const [halfWidth, depth] = { small: [10, 5], round: [11, 12], wide: [16, 8] }[shape];
  polygon(
    ctx,
    [
      [-halfWidth, -3],
      [halfWidth, -5],
      [halfWidth * 0.6, depth],
      [-halfWidth * 0.57, depth],
    ],
    '#2a1828',
  );
  polygon(
    ctx,
    [
      [-halfWidth, -3],
      [halfWidth, -5],
      [halfWidth * 0.56, 1],
      [-halfWidth * 0.69, 1],
    ],
    '#f8fafb',
  );
}

/** Draw only the registered eyes. The mouth, hair and body stay on their own layers. */
export function drawPoseEyes(ctx, pose, tone) {
  for (const [index, [x, y, radius]] of pose.eyes.entries()) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pose.mouth[2]);
    ctx.scale(radius / 18, radius / 18);
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 18, 0, 0, 2 * Math.PI);
    ctx.clip();
    if (tone === 'blink' || tone === 'affectionate') {
      ctx.fillStyle = '#06100f';
      ctx.fillRect(-18, -18, 36, 36);
      ctx.beginPath();
      ctx.moveTo(-12, 2);
      ctx.quadraticCurveTo(0, tone === 'affectionate' ? -13 : 7, 12, 2);
    } else {
      const side = index ? -1 : 1;
      const tilt = tone === 'boundary' ? side * 7 : tone === 'curious' ? side * 4 : 0;
      const line = tone === 'boundary' ? -1 : tone === 'curious' && !index ? -1 : -10;
      polygon(
        ctx,
        [
          [-18, -18],
          [18, -18],
          [18, line + tilt],
          [-18, line - tilt],
        ],
        '#06100f',
      );
      ctx.beginPath();
      ctx.moveTo(-12, line - tilt * 0.67);
      ctx.lineTo(12, line + tilt * 0.67);
    }
    ctx.strokeStyle = '#52ffd9';
    ctx.lineWidth = tone === 'blink' ? 2 : 3;
    ctx.stroke();
    ctx.restore();
  }
}

/** A separate, bounded clock following actual playback amplitude. */
export class AvatarVisemes {
  constructor() {
    this.at = -Infinity;
    this.level = 0;
    this.shape = 'closed';
  }

  sample(now, speaking, amplitude) {
    if (!speaking || !Number.isFinite(amplitude) || amplitude < 0.006) {
      this.at = -Infinity;
      this.level = 0;
      return (this.shape = 'closed');
    }
    if (now - this.at < 90) return this.shape;
    this.at = now;
    this.level = this.level * 0.25 + amplitude * 0.75;
    const previous = shapes.indexOf(this.shape);
    this.shape =
      shapes[
        this.level > (previous === 3 ? 0.055 : 0.075)
          ? 3
          : this.level > (previous === 2 ? 0.022 : 0.03)
            ? 2
            : 1
      ];
    return this.shape;
  }
}

// Landmarks on the existing registered 1254-pixel masters. The mouth is
// occluded in the kiss and heart gestures, so those frames keep their face.
function mouthAnchor(frameId) {
  if (!frameId) return null;
  if (/heart_hands|kiss/.test(frameId)) return null;
  if (/^desktop-perch/.test(frameId)) return [655, 524];
  if (/^idle-wave/.test(frameId)) return [658, 443];
  if (frameId === 'idle-excited') return [649, 421];
  if (frameId === 'idle-laughing' || frameId === 'happy') return [648, 426];
  if (frameId === 'skeptical' || frameId === 'sad') return [644, 435];
  return [646, 430];
}

/** Builds a presentation layer without changing the body frame or its hit mask. */
export class AvatarMouthLayer {
  constructor(sprite) {
    this.sprite = sprite;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'avatar-mouth-plate';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    sprite.parentElement.append(this.canvas);
  }

  update(image, shape, frameId) {
    const { canvas, sprite } = this;
    const pose = avatarPoseLandmarks(frameId);
    const anchor = mouthAnchor(frameId);
    if (
      !anchor ||
      !shapes.includes(shape) ||
      shape === 'closed' ||
      !sprite.complete ||
      sprite.naturalWidth !== 1254
    ) {
      canvas.hidden = true;
      return;
    }
    const source = [image, image.avatarTextureRevision, sprite.src, shape, frameId];
    if (this.source?.every((value, index) => value === source[index])) {
      canvas.hidden = false;
      return;
    }
    if (pose) this.drawPatch(image, shape, pose.mouth);
    else {
      if (this.patch) {
        this.patch = null;
        canvas.removeAttribute('data-patch');
        for (const property of ['left', 'top', 'width', 'height'])
          canvas.style.removeProperty(property);
      }
      if (canvas.width !== 1254) canvas.width = canvas.height = 1254;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.resetTransform();
      ctx.clearRect(0, 0, 1254, 1254);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(image, 0, 0, 1254, 1254);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.translate(...anchor);
      polygon(
        ctx,
        [
          [-36, -12],
          [36, -24],
          [30, 17],
          [4, 29],
          [-33, 18],
        ],
        '#070812',
      );
      const opening = { small: 7, round: 17, wide: 24 }[shape];
      polygon(
        ctx,
        [
          [-21, 1],
          [22, -12],
          [12, opening],
          [-5, opening - 2],
        ],
        '#f9faff',
      );
    }
    this.source = source;
    canvas.avatarTextureRevision = (canvas.avatarTextureRevision ?? 0) + 1;
    canvas.hidden = false;
  }

  drawPatch(image, shape, [x, y, angle, width]) {
    // Keep the actual PNG visible around the mouth. Re-copying the entire
    // image on every syllable can change antialiased hair and silhouette pixels.
    const { canvas } = this;
    const radius = Math.ceil(width * 0.87) + 3;
    const side = radius * 2;
    const left = x - radius;
    const top = y - radius;
    if (
      !this.patch ||
      this.patch.left !== left ||
      this.patch.top !== top ||
      canvas.width !== side
    ) {
      this.patch = { left, top };
      canvas.dataset.patch = '';
      canvas.width = canvas.height = side;
      Object.assign(canvas.style, {
        left: `${(left / 1254) * 100}%`,
        top: `${(top / 1254) * 100}%`,
        width: `${(side / 1254) * 100}%`,
        height: `${(side / 1254) * 100}%`,
      });
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.resetTransform();
    ctx.clearRect(0, 0, side, side);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    drawPoseMouth(ctx, shape, [radius, radius, angle, width]);
    ctx.restore();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(image, left, top, side, side, 0, 0, side, side);
  }

  image(fallback) {
    if (this.canvas.hidden) return fallback;
    if (!this.patch) return this.canvas;
    // The framed CRT uses a single texture. Compose lazily only when its
    // renderer needs the texture and the mouth or source image has changed.
    this.texture ??= document.createElement('canvas');
    const { texture, canvas } = this;
    if (texture.avatarTextureRevision === canvas.avatarTextureRevision) return texture;
    if (texture.width !== 1254) texture.width = texture.height = 1254;
    const ctx = texture.getContext('2d');
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1254, 1254);
    ctx.drawImage(this.source[0], 0, 0, 1254, 1254);
    ctx.drawImage(canvas, this.patch.left, this.patch.top);
    texture.avatarTextureRevision = canvas.avatarTextureRevision;
    return texture;
  }
}
