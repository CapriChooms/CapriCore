// SPDX-License-Identifier: GPL-3.0-only

const shapes = ['closed', 'small', 'round', 'wide'];

// Measured on the normalized CapriDesign exports. Angles are relative to the
// rendered raster, including the inverted jaw. The right grip is its own drawing.
const poseLandmarks = Object.freeze({
  neutral: {
    mouth: [634, 426, -0.29, 36],
    face: [631, 401],
    crown: 115,
    eyes: [
      [596, 399, 14],
      [665, 378, 17],
    ],
  },
  'music-window': {
    mouth: [650, 416, -0.38, 38],
    face: [643, 379],
    crown: 75,
  },
  'music-floor': {
    mouth: [635, 642, -0.35, 38],
    face: [625, 604],
    crown: 295,
  },
  'pose-ceiling': {
    mouth: [628, 414, -0.28, 35],
    face: [623, 386],
    crown: 75,
    eyes: [
      [589, 386, 14],
      [655, 364, 16],
    ],
  },
  'pose-ceiling-upside-down': {
    mouth: [625, 689, Math.PI, 36],
    face: [625, 718],
    crown: 84,
    inverted: true,
    eyes: [
      [657, 721, 16],
      [592, 724, 16],
    ],
  },
  'pose-dock-left': {
    mouth: [599, 409, -0.27, 38],
    face: [595, 382],
    crown: 76,
    eyes: [
      [560, 379, 14],
      [632, 360, 17],
    ],
  },
  'pose-dock-right': {
    mouth: [589, 382, -0.43, 36],
    face: [575, 354],
    crown: 75,
    eyes: [
      [542, 357, 14],
      [607, 327, 18],
    ],
  },
  'pose-sit-edge': {
    mouth: [627, 445, -0.34, 38],
    face: [623, 417],
    crown: 110,
    eyes: [
      [587, 416, 14],
      [659, 393, 17],
    ],
  },
  'pose-sit-floor': {
    mouth: [619, 597, -0.31, 37],
    face: [616, 570],
    crown: 255,
    eyes: [
      [579, 565, 15],
      [653, 545, 18],
    ],
  },
  'pose-crouch': {
    mouth: [628, 654, -0.37, 36],
    face: [622, 633],
    crown: 333,
    eyes: [
      [588, 632, 14],
      [654, 605, 17],
    ],
  },
  'pose-sleep': { face: [399, 1036], crown: 709 },
});

// These expressions all use the same registered standing master.
const standingFrames = new Set([
  'annoyed',
  'attentive',
  'concerned',
  'embarrassed',
  'flirty',
  'focused',
  'happy',
  'sad',
  'skeptical',
  'sleepy',
  'smirk',
  'surprised',
  'thinking',
  'idle-blink_closed',
  'idle-blink_half',
  'idle-excited',
  'idle-laughing',
  'idle-look_down',
  'idle-look_left',
  'idle-look_right',
  'idle-look_up',
  'idle-mouth_round',
  'idle-mouth_small',
  'idle-mouth_wide',
  'idle-surprised_closed',
  'idle-wink_closed',
  'idle-wink_half',
]);

const frameAliases = new Map([
  ['sit_floor-neutral', 'pose-sit-floor'],
  ['sit_edge-neutral', 'pose-sit-edge'],
  ['crouch-neutral', 'pose-crouch'],
]);

export function avatarPoseLandmarks(frameId) {
  const id = standingFrames.has(frameId) ? 'neutral' : (frameAliases.get(frameId) ?? frameId);
  return Object.hasOwn(poseLandmarks, id) ? poseLandmarks[id] : null;
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
  if (!frameId || frameId === 'pose-sleep') return null;
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
