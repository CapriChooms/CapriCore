// SPDX-License-Identifier: GPL-3.0-only

import { faceAnimations } from './avatar-face-expressions.mjs';
import {
  avatarFacePose,
  avatarFaceState,
  faceSize,
  loadAvatarFaceRig,
} from './avatar-face-rig.mjs';

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
      [658.4, 720.5, 16],
      [593.7, 723.95, 15],
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

const frameAliases = new Map([
  ['sit_floor-neutral', 'pose-sit-floor'],
  ['sit_edge-neutral', 'pose-sit-edge'],
  ['crouch-neutral', 'pose-crouch'],
]);

export function avatarPoseLandmarks(frameId) {
  const id = frameAliases.get(frameId) ?? avatarFacePose(frameId) ?? frameId;
  return Object.hasOwn(poseLandmarks, id) ? poseLandmarks[id] : null;
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

/** Paint only the face rectangle in sprite coordinates. The CRT requests one texture. */
export class AvatarMouthLayer {
  constructor(sprite, { className = 'avatar-mouth-plate', onReady } = {}) {
    Object.assign(this, { sprite, onReady });
    this.canvas = document.createElement('canvas');
    this.canvas.className = className;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    sprite.after(this.canvas);
  }

  update(image, shape, frameId, expression, clip, now = performance.now()) {
    const { canvas, sprite } = this;
    if (
      !avatarFacePose(frameId) ||
      !image ||
      sprite.naturalWidth !== faceSize ||
      !sprite.complete
    ) {
      canvas.hidden = true;
      return;
    }
    if (!this.rig) {
      if (!this.loading) {
        this.loading = loadAvatarFaceRig()
          .then((rig) => {
            this.rig = rig;
            this.onReady?.();
          })
          .catch(() => {});
      }
      return;
    }
    const timeline = clip && faceAnimations[clip.id];
    const elapsed = timeline ? now - clip.start : 0;
    const running = timeline && elapsed < timeline.duration;
    // Sample at most 30 face textures a second, independently of the CRT.
    const age = running ? Math.max(0, Math.round(elapsed * 0.03) / 0.03) : 0;
    const source = [
      image,
      sprite.currentSrc,
      frameId,
      shape,
      expression,
      running ? clip.id : null,
      age,
    ];
    if (this.source?.every((value, index) => value === source[index])) {
      canvas.hidden = false;
      return;
    }
    const patch = this.rig(image, frameId);
    const [x, y, width, height] = patch.bounds;
    if (this.patch !== patch) {
      this.patch = patch;
      this.canvas.dataset.patch = '';
      canvas.width = width;
      canvas.height = height;
      Object.assign(canvas.style, {
        left: `${(x / faceSize) * 100}%`,
        top: `${(y / faceSize) * 100}%`,
        width: `${(width / faceSize) * 100}%`,
        height: `${(height / faceSize) * 100}%`,
      });
    }
    patch.paint(
      canvas.getContext('2d'),
      avatarFaceState(frameId, expression, running && clip.id, age, shape),
      !canvas.hidden &&
        this.source?.every((value, index) => index === 3 || value === source[index]),
    );
    this.source = source;
    canvas.avatarTextureRevision = (canvas.avatarTextureRevision ?? 0) + 1;
    canvas.hidden = false;
  }

  image(fallback) {
    if (this.canvas.hidden || this.source[1] !== this.sprite.currentSrc) return fallback;
    this.texture ??= Object.assign(document.createElement('canvas'), {
      width: faceSize,
      height: faceSize,
    });
    const { texture, canvas } = this;
    if (texture.avatarTextureRevision === canvas.avatarTextureRevision) return texture;
    const ctx = texture.getContext('2d');
    ctx.clearRect(0, 0, faceSize, faceSize);
    ctx.drawImage(this.source[0], 0, 0);
    const [x, y] = this.patch.bounds;
    ctx.drawImage(canvas, x, y);
    texture.avatarTextureRevision = canvas.avatarTextureRevision;
    return texture;
  }
}
