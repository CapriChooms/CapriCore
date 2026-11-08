// SPDX-License-Identifier: GPL-3.0-only
import { avatarGripPose, avatarGripSwing } from './avatar-grip-rig.mjs';
import { avatarPoseSegments, avatarPoseSwing } from './avatar-pose-motion.mjs';

export const avatarSeatHinge = Object.freeze([0.58, 0.68]);
const seatHeadOffset = 94 / 1254;
const spriteExtent = 1254;

export function avatarSeatSwing(now) {
  const step = Math.floor(((now % 4800) * 14) / 2400);
  const phase = Math.min(step, 28 - step) / 14;
  return -1.45 + 3.05 * phase;
}

export const avatarParts = Object.freeze({
  body: 'body',
  head: 'head',
  hair: 'hair',
  torso: 'torso',
  chest: 'chest',
  pelvis: 'pelvis',
  'left-arm': 'left arm',
  'right-arm': 'right arm',
  'left-hand': 'left hand',
  'right-hand': 'right hand',
  'left-leg': 'left leg',
  'right-leg': 'right leg',
  'left-foot': 'left foot',
  'right-foot': 'right foot',
});

export function avatarReactionTone(part) {
  if (part === 'head') return 'affectionate';
  if (part === 'chest' || part === 'pelvis') return 'boundary';
  if (/(?:leg|foot)$/.test(part)) return 'curious';
  return 'neutral';
}

/** Landmarks in the shared sprite canvas, after the opaque-pixel check. */
function avatarBodyPart(u, v, headOffset = 0) {
  const crown = v - headOffset;
  if (
    crown >= 0 &&
    crown <= 0.366 &&
    u >= 0.31 &&
    u <= 0.72 &&
    (crown < 0.29 || (u >= 0.445 && u <= 0.58))
  )
    return 'head';
  if (crown < 0.366 || (crown < 0.52 && (u < 0.41 || u > 0.64))) return 'hair';

  // The perched artwork bends its knees and places both hands on the ledge.
  if (headOffset) {
    if (v < 0.68 && (u < 0.445 || u > (v < 0.6 ? 0.56 : 0.64)))
      return (u < 0.5 ? 'right-' : 'left-') + (v < 0.61 ? 'arm' : 'hand');
    if (u >= 0.465 && u <= 0.575 && v >= 0.52 && v < 0.57) return 'chest';
    if (u >= 0.493 && u <= 0.602 && v >= 0.59 && v < 0.645) return 'pelvis';
    if (v < 0.59) return 'torso';
    return (u < (v < 0.68 ? 0.55 : 0.57) ? 'right-' : 'left-') + (v < 0.86 ? 'leg' : 'foot');
  }

  if (v < 0.68 && (u < 0.439 || u > (v < 0.55 ? 0.555 : 0.576)))
    return (u < 0.5 ? 'right-' : 'left-') + (v < 0.6 ? 'arm' : 'hand');
  if (u >= 0.455 && u <= 0.555 && v >= 0.46 && v < 0.522) return 'chest';
  if (u >= 0.482 && u <= 0.555 && v >= 0.57 && v < 0.626) return 'pelvis';
  if (v < 0.553) return 'torso';
  return (u < (v < 0.67 ? 0.5 : 0.525) ? 'right-' : 'left-') + (v < 0.86 ? 'leg' : 'foot');
}

function beforeRotation(x, y, pivot, degrees) {
  const radians = (-degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - pivot[0];
  const dy = y - pivot[1];
  return [pivot[0] + dx * cos - dy * sin, pivot[1] + dx * sin + dy * cos];
}

function polygonContains(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[j];
    if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) inside = !inside;
  }
  return inside;
}

function gripPart(u, v, opaque, grip, angle) {
  const x = (grip.mirror ? 1 - u : u) * spriteExtent;
  const y = v * spriteExtent;
  const { head, layers } = grip;
  function paintedPart(behindHead) {
    for (let index = layers.length - 1; index >= 0; index--) {
      const { part, points, swing, behindHead: behind } = layers[index];
      if (!part || Boolean(behind) !== behindHead) continue;
      const [localX, localY] = swing ? beforeRotation(x, y, swing, angle * swing[2]) : [x, y];
      if (polygonContains(localX, localY, points)) return part;
    }
    return null;
  }
  const foreground = paintedPart(false);
  if (foreground) return foreground;
  const headX = (x - head.x) / head.scale;
  const headY = (y - head.y) / head.scale;
  const sourceU = headX / spriteExtent;
  const sourceV = headY / spriteExtent;
  if (polygonContains(headX, headY, head.clip) && opaque(sourceU, sourceV))
    return avatarBodyPart(sourceU, sourceV) === 'head' ? 'head' : 'hair';
  return paintedPart(true);
}

// Coordinates on the reviewed PNGs. Rectangles mark compact contacts. A fifth
// coordinate makes a limb a capsule so the hair around it remains pickable.
const reviewedRegions = {
  'music-window': {
    head: [560, 278, 726, 448],
    'right-hand': [510, 383, 567, 486],
    'left-hand': [748, 720, 872, 798],
    'right-foot': [284, 1072, 443, 1166],
    'left-foot': [483, 1030, 549, 1168],
    chest: [584, 478, 678, 559],
    pelvis: [555, 662, 716, 790],
    'right-arm': [463, 555, 532, 453, 38],
    'left-arm': [716, 542, 772, 742, 32],
    'right-leg': [549, 802, 372, 1088, 56],
    'left-leg': [569, 813, 518, 1045, 40],
    torso: [527, 456, 741, 712],
  },
  'music-floor': {
    head: [556, 515, 735, 701],
    'right-hand': [267, 863, 386, 971],
    'left-hand': [801, 896, 923, 1001],
    'right-foot': [450, 1085, 595, 1168],
    'left-foot': [745, 1068, 889, 1155],
    chest: [600, 749, 705, 845],
    pelvis: [562, 1012, 717, 1124],
    'right-arm': [516, 810, 346, 910, 40],
    'left-arm': [756, 816, 859, 923, 38],
    'right-leg': [344, 958, 773, 1094, 67],
    'left-leg': [866, 993, 602, 1130, 68],
    torso: [551, 707, 751, 1052],
  },
  'pose-ceiling': {
    head: [555, 250, 704, 424],
    'right-hand': [440, 76, 535, 137],
    'left-hand': [718, 76, 812, 137],
    'right-foot': [482, 1035, 554, 1157],
    'left-foot': [632, 1035, 709, 1178],
    chest: [593, 450, 662, 539],
    pelvis: [566, 589, 675, 674],
    'right-arm': [491, 118, 571, 452, 31],
    'left-arm': [756, 124, 674, 460, 31],
    'right-leg': [565, 659, 520, 1039, 70],
    'left-leg': [642, 660, 668, 1060, 66],
    torso: [523, 428, 716, 639],
  },
  'pose-ceiling-upside-down': {
    head: [541, 649, 704, 823],
    'right-hand': [392, 596, 474, 704],
    'left-hand': [769, 596, 841, 707],
    'right-foot': [558, 79, 619, 164],
    'left-foot': [638, 79, 699, 167],
    chest: [574, 559, 668, 632],
    pelvis: [579, 411, 678, 498],
    'right-arm': [440, 529, 525, 563, 38],
    'left-arm': [793, 529, 714, 563, 38],
    'right-leg': [550, 410, 515, 259, 91],
    'left-leg': [704, 404, 728, 259, 92],
    torso: [516, 476, 722, 665],
  },
  'pose-dock-left': {
    head: [516, 254, 662, 448],
    'right-hand': [195, 414, 250, 494],
    'left-hand': [195, 631, 250, 708],
    'right-foot': [327, 1045, 403, 1179],
    'left-foot': [449, 815, 518, 947],
    chest: [518, 462, 604, 541],
    pelvis: [415, 600, 555, 696],
    'right-arm': [243, 481, 500, 498, 27],
    'left-arm': [239, 674, 506, 570, 29],
    'right-leg': [429, 671, 365, 1041, 54],
    'left-leg': [611, 653, 472, 835, 56],
    torso: [419, 427, 649, 615],
  },
  'pose-dock-right': {
    head: [494, 214, 651, 422],
    'left-hand': [994, 370, 1057, 453],
    'right-hand': [990, 587, 1057, 661],
    'right-foot': [629, 816, 710, 925],
    'left-foot': [773, 1045, 844, 1179],
    chest: [578, 430, 672, 522],
    pelvis: [612, 555, 752, 663],
    'left-arm': [703, 477, 994, 435, 30],
    'right-arm': [692, 583, 994, 638, 29],
    'right-leg': [526, 626, 675, 841, 58],
    'left-leg': [765, 635, 805, 1051, 61],
    torso: [558, 412, 796, 615],
  },
  'pose-sit-edge': {
    head: [548, 263, 719, 462],
    'right-hand': [303, 727, 415, 793],
    'left-hand': [748, 729, 863, 800],
    'right-foot': [384, 1044, 489, 1179],
    'left-foot': [486, 1029, 571, 1179],
    chest: [586, 461, 667, 555],
    pelvis: [543, 651, 707, 759],
    'right-arm': [556, 551, 410, 738, 37],
    'left-arm': [698, 553, 750, 738, 34],
    'right-leg': [511, 732, 450, 1035, 74],
    'left-leg': [553, 771, 520, 1030, 53],
    torso: [536, 446, 706, 695],
  },
  'pose-sit-floor': {
    head: [529, 427, 703, 616],
    'right-hand': [254, 1110, 373, 1170],
    'left-hand': [731, 717, 866, 796],
    'right-foot': [735, 1090, 858, 1168],
    'left-foot': [882, 1097, 1031, 1168],
    chest: [539, 628, 638, 768],
    pelvis: [524, 941, 659, 1080],
    'right-arm': [482, 719, 370, 1115, 43],
    'left-arm': [635, 695, 788, 740, 35],
    'right-leg': [469, 1107, 735, 1134, 55],
    'left-leg': [808, 788, 902, 1101, 71],
    torso: [476, 603, 677, 999],
  },
  'pose-crouch': {
    head: [529, 502, 687, 698],
    'right-hand': [447, 865, 525, 953],
    'left-hand': [577, 1094, 700, 1170],
    'right-foot': [344, 1097, 487, 1170],
    'left-foot': [698, 1060, 841, 1148],
    chest: [553, 686, 653, 786],
    pelvis: [555, 863, 654, 967],
    'right-arm': [392, 765, 485, 892, 36],
    'left-arm': [689, 828, 642, 1107, 46],
    'right-leg': [397, 804, 463, 1097, 49],
    'left-leg': [819, 932, 743, 1090, 61],
    torso: [514, 680, 716, 951],
  },
};

function reviewedPart(u, v, opaque, regions) {
  if (!opaque(u, v)) return null;
  const x = u * spriteExtent;
  const y = v * spriteExtent;
  for (const [part, [ax, ay, bx, by, radius]] of Object.entries(regions)) {
    if (radius === undefined) {
      if (x >= ax && x <= bx && y >= ay && y <= by) return part;
      continue;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= radius) return part;
  }
  return 'hair';
}

/** Test the topmost painted layer of the current pose, in normalized canvas coordinates. */
export function avatarBodyPartAt(
  u,
  v,
  opaque,
  { dock, poseId, now = Date.now(), reducedMotion } = {},
) {
  const regions = reviewedRegions[poseId];
  if (regions) {
    const segments = reducedMotion ? [] : avatarPoseSegments(poseId);
    const inBounds = (x, y, [left, top, right, bottom]) =>
      x * spriteExtent >= left &&
      x * spriteExtent <= right &&
      y * spriteExtent >= top &&
      y * spriteExtent <= bottom;
    for (let index = segments.length - 1; index >= 0; index--) {
      const segment = segments[index];
      const [x, y] = beforeRotation(
        u,
        v,
        segment.pivot.map((value) => value / spriteExtent),
        avatarPoseSwing(now, segment),
      );
      if (inBounds(x, y, segment.bounds)) {
        const part = reviewedPart(x, y, opaque, regions);
        if (part) return part;
      }
    }
    if (segments.some((segment) => inBounds(u, v, segment.bounds))) return null;
    return reviewedPart(u, v, opaque, regions);
  }
  const grip = avatarGripPose(dock);
  if (grip) return gripPart(u, v, opaque, grip, reducedMotion ? 0 : avatarGripSwing(now, dock));
  const seated = dock === 'seat';
  if (seated && !reducedMotion) {
    const [x, y] = beforeRotation(u, v, avatarSeatHinge, avatarSeatSwing(now));
    if (y >= 0.678 && opaque(x, y)) return avatarBodyPart(x, y, seatHeadOffset);
    if (v >= 0.683) return null;
  }
  return opaque(u, v) ? avatarBodyPart(u, v, seated ? seatHeadOffset : 0) : null;
}
