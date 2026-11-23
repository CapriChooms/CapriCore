// SPDX-License-Identifier: GPL-3.0-only
import { faceAnimations, faceFrames, speechMouths } from './avatar-face-expressions.mjs';
import {
  faceEyeCenters,
  layeredBlinkAssets,
  prepareLayeredBlink,
} from './avatar-layered-blink.mjs';

export const faceSize = 1254;
const standingPatch = [550, 331, 156, 120];
const neutral = faceFrames.neutral;
const jaw = [634, 426];
const jawColor = [7, 6, 11];

// Per-drawing registration in source pixels. Each eye has its own centre and
// scale. The contours enclose the baked sockets and stop at the hair and jaw.
const poses = {
  'pose-ceiling': {
    contour: [
      [559, 383],
      [591, 340],
      [614, 375],
      [635, 335.5],
      [676.2, 316.5],
      [687, 382],
      [634, 394, 581, 415],
    ],
    skin: [553, 323, 689, 427],
    eyes: [
      [589, 386, 0.98],
      [655, 365, 0.98],
    ],
    mouth: [628, 414, -0.36, 0.95],
    sockets: [
      [559, 382, 588, 347, 597, 365, 616, 399, 581, 416],
      [628, 345, 666, 331, 683, 349, 685, 387, 672, 389, 628, 393],
    ],
  },
  'pose-dock-left': {
    contour: [
      [528, 373],
      [570, 332],
      [588, 368],
      [614.5, 327.9],
      [665, 314.7],
      [667, 383],
      [609, 385, 551, 408],
    ],
    skin: [520, 322, 671, 417],
    eyes: [
      [560, 379, 0.99],
      [632, 360, 1.01],
    ],
    mouth: [599, 409, -0.34, 1],
    sockets: [
      [530, 371, 563, 339, 568, 359, 592, 397, 550, 408],
      [602, 339, 640, 326, 662, 341, 663, 381, 609, 388],
    ],
  },
  'pose-dock-right': {
    contour: [
      [511, 350],
      [535, 314],
      [561, 347],
      [578, 301],
      [630, 278],
      [646, 346],
      [592, 355, 537, 388],
    ],
    skin: [506, 278, 643, 397],
    eyes: [
      [541, 356, 0.94],
      [607, 327, 0.99],
    ],
    mouth: [587, 382, -0.48, 0.95],
    sockets: [
      [510, 351, 536, 318, 550, 337, 568, 369, 536, 389],
      [576, 312, 616, 289, 635, 307, 637, 344, 589, 358],
    ],
  },
  'pose-sit-edge': {
    contour: [
      [554, 406],
      [590, 367],
      [615, 404],
      [638.7, 362.2],
      [691.8, 344.3],
      [697, 416],
      [637, 420, 577, 448],
    ],
    skin: [549, 343, 700, 455],
    eyes: [
      [587, 415, 1],
      [658, 392, 1.02],
    ],
    mouth: [626, 445, -0.37, 1.01],
    sockets: [
      [556, 411, 587, 375, 599, 394, 614, 432, 574, 445],
      [628, 369, 668, 352, 687, 372, 690, 411, 636, 422],
    ],
  },
  'pose-ceiling-upside-down': {
    // This outline was traced on the 180° reference with the face upright.
    contour: [
      [565, 517],
      [601, 487],
      [624.5, 522],
      [653, 495],
      [691, 492],
      [689.5, 550],
      [632, 540, 575, 558],
    ],
    inverted: true,
    skin: [549, 690, 694, 773],
    eyes: [
      // Measured with the drawing rotated upright, then mapped back to the sprite.
      [658.4, 720.5, 0.9, Math.PI + 0.25],
      [593.7, 723.95, 0.76, Math.PI + 0.25],
    ],
    mouth: [624, 690, Math.PI - 0.08, 0.99],
    sockets: [
      [632, 707, 669, 699, 686, 725, 669, 756, 649, 763, 633, 743],
      [560, 708, 612, 706, 618, 734, 602, 752, 575, 756, 561, 745],
    ],
  },
  'pose-sit-floor': {
    contour: [
      [542, 555],
      [580, 521],
      [606, 555],
      [631.8, 515.7],
      [685.3, 492.3],
      [691, 566],
      [629, 576, 567, 595],
    ],
    skin: [541, 491, 697, 603],
    eyes: [
      [580, 565, 1.03],
      [654, 544, 1.04],
    ],
    mouth: [619, 596, -0.34, 1.02],
    sockets: [
      [547, 558, 581, 526, 593, 544, 609, 581, 566, 594],
      [625, 525, 663, 507, 686, 525, 689, 565, 676, 572, 631, 574],
    ],
  },
  'pose-crouch': {
    contour: [
      [557, 624],
      [580, 589],
      [602.5, 618],
      [631.1, 577.3],
      [678.1, 560.1],
      [689, 625],
      [633, 631, 578, 661],
    ],
    skin: [551, 553, 691, 668],
    eyes: [
      [587, 630, 0.95],
      [653, 604, 1],
    ],
    mouth: [629, 654, -0.44, 0.97],
    sockets: [
      [557, 626, 585, 590, 600, 608, 614, 646, 573, 660],
      [624, 586, 660, 567, 680, 585, 684, 626, 631, 635],
    ],
  },
};

const canvasOf = (width, height) =>
  Object.assign(document.createElement('canvas'), { width, height });
const pointPairs = (polygon) =>
  Array.from({ length: polygon.length / 2 }, (_, i) => polygon.slice(i * 2, i * 2 + 2));

function place([x, y, scale, angle], [sx, sy]) {
  const a = Math.cos(angle) * scale;
  const b = Math.sin(angle) * scale;
  return [a, b, -b, a, x - a * sx + b * sy, y - b * sx - a * sy];
}

export function avatarFacePose(id) {
  if (Object.hasOwn(faceFrames, id)) return 'neutral';
  return Object.hasOwn(poses, id) ? id : null;
}

export function avatarFaceState(frameId, expression, clip, age, shape = 'closed') {
  const current = faceFrames[expression] ?? faceFrames[frameId] ?? neutral;
  let state = current;
  if (clip === 'blink') {
    const { closure, smile } = faceAnimations.blink.sample(age);
    state =
      current === neutral
        ? { eyelids: [closure, closure], smile }
        : { ...current, eyelids: current.eyelids.map((open) => open + (1 - open) * closure) };
  } else if (Object.hasOwn(faceAnimations, clip)) state = faceAnimations[clip].sample(age);
  if (Object.hasOwn(speechMouths, shape)) state = { ...state, mouth: speechMouths[shape] };
  return state;
}

const loadImage = async (url) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
};

let artwork;
export function loadAvatarFaceRig() {
  artwork ??= Promise.all([
    ...Object.values(layeredBlinkAssets).map(loadImage),
    loadFaceAtlas('poses').catch(() => null),
  ])
    .then(([pose, eyes, atlas]) => prepareAvatarFaceRig(pose, eyes, atlas))
    .catch((error) => {
      artwork = null;
      throw error;
    });
  return artwork;
}

async function loadFaceAtlas(group) {
  const prefix = '/avatar-face-' + group;
  const [image, response] = await Promise.all([
    loadImage(prefix + '.png'),
    fetch(prefix + '.json'),
  ]);
  if (!response.ok) throw new Error('Missing avatar face registrations');
  return { image, entries: await response.json() };
}

let gestureFaces;
export function loadAvatarGestureFaces() {
  gestureFaces ??= loadFaceAtlas('gestures')
    .then(({ image, entries }) => (context, id, outputSize) => {
      const entry = entries[id];
      if (!entry) return false;
      const [u, v, x, y, w, h] = entry;
      const scale = outputSize / faceSize;
      context.drawImage(image, u, v, w, h, x * scale, y * scale, w * scale, h * scale);
      return true;
    })
    .catch((error) => {
      gestureFaces = null;
      throw error;
    });
  return gestureFaces;
}

export function prepareAvatarFaceRig(standing, eyes, atlas) {
  const draw = prepareLayeredBlink(standing, eyes);
  const prepared = new Map();
  return (image, frameId) => {
    const id = avatarFacePose(frameId);
    if (!id) return null;
    const cached = prepared.get(id);
    if (cached) return cached;
    const profile = poses[id];
    let patch;
    if (profile && atlas?.entries[id]) {
      const [u, v, ...bounds] = atlas.entries[id];
      patch = makePatch(
        crop(atlas.image, [u, v, bounds[2], bounds[3]]),
        bounds,
        draw,
        alignment(profile),
      );
    } else if (profile) patch = preparePose(image, profile, draw);
    else patch = makePatch(crop(standing, standingPatch), standingPatch, draw);
    prepared.set(id, patch);
    return patch;
  };
}

export function composeAvatarFace(image, patch, state) {
  if (!patch) return image;
  const [x, y, width, height] = patch.bounds;
  const plate = canvasOf(width, height);
  patch.paint(plate.getContext('2d'), state);
  const canvas = canvasOf(faceSize, faceSize);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  context.drawImage(plate, x, y);
  return canvas;
}

export function buildPoseFacePlate(image, id) {
  return cleanPose(image, poses[id]);
}

function alignment(profile) {
  const [mx, my, angle, scale] = profile.mouth;
  return {
    eyes: profile.eyes.map(([ex, ey, s, rotation], i) =>
      place([ex, ey, s, rotation ?? angle + 0.35], faceEyeCenters[i]),
    ),
    mouth: place([mx, my, scale, angle + 0.35], jaw),
  };
}

function crop(image, [x, y, width, height]) {
  const canvas = canvasOf(width, height);
  canvas
    .getContext('2d', { willReadFrequently: true })
    .drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas;
}

function makePatch(base, bounds, paint, registration) {
  const [x, y, width, height] = bounds;
  const mask = canvasOf(width, height);
  const maskContext = mask.getContext('2d');
  const pixels = base.getContext('2d').getImageData(0, 0, width, height);
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i] >= 246 ? 255 : 0;
  maskContext.putImageData(pixels, 0, 0);
  const jawPatch = new Path2D();
  jawPatch.rect(608, 405, 53, 44);
  return {
    bounds,
    paint(context, state, mouthOnly = false) {
      context.save();
      if (mouthOnly) {
        context.translate(-x, -y);
        if (registration) context.transform(...registration.mouth);
        context.clip(jawPatch);
        context.resetTransform();
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(base, 0, 0);
      context.save();
      context.translate(-x, -y);
      paint(context, faceSize, state, 'face', registration);
      context.restore();
      context.save();
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(mask, 0, 0);
      context.restore();
      context.restore();
    },
  };
}

function convexHull(points) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const ordered = points.sort(([x, y], [a, b]) => x - a || y - b);
  const half = (sequence) => {
    const vertices = [];
    for (const point of sequence) {
      while (vertices.length > 1 && cross(vertices.at(-2), vertices.at(-1), point) <= 0)
        vertices.pop();
      vertices.push(point);
    }
    return vertices.slice(0, -1);
  };
  return [...half(ordered), ...half(ordered.reverse())];
}

function preparePose(image, profile, draw) {
  const { base, bounds } = cleanPose(image, profile);
  return makePatch(base, bounds, draw, alignment(profile));
}

const isSkinGreen = ([r, g, b, a]) => a > 240 && g > 85 && g > r * 2 && g > b * 1.4;

// Extend the exposed forehead to the temple. The red fringe occludes the
// top edge between its two intersections with the same straight line.
function foreheadContour([temple, bangLeft, tip, bangRight, corner, ...cheek]) {
  const hairSlope = (corner[1] - bangRight[1]) / (corner[0] - bangRight[0]);
  const templeY = Math.min(temple[1] - 22, corner[1] + (temple[0] - corner[0]) * hairSlope - 10);
  const slope = (templeY - corner[1]) / (temple[0] - corner[0]);
  const topAt = (x) => corner[1] + (x - corner[0]) * slope;
  const intersection = ([x, y]) => {
    const dx = x - tip[0];
    const t = (topAt(tip[0]) - tip[1]) / (y - tip[1] - slope * dx);
    const edgeX = tip[0] + t * dx;
    return [edgeX, topAt(edgeX)];
  };
  return [
    temple,
    [temple[0], templeY],
    intersection(bangLeft),
    tip,
    intersection(bangRight),
    corner,
    ...cheek,
  ];
}

function restoreFaceContour(original, clean, contour, x, y) {
  const { width, height } = original;
  const context = canvasOf(width, height).getContext('2d', { willReadFrequently: true });
  const outline = new Path2D();
  contour.forEach((coordinates, i) => {
    const local = coordinates.map((value, coordinate) => value - (coordinate % 2 ? y : x));
    if (i === 0) outline.moveTo(...local);
    else if (local.length === 2) outline.lineTo(...local);
    else outline.quadraticCurveTo(...local);
  });
  outline.closePath();
  context.fill(outline);
  const face = context.getImageData(0, 0, width, height).data;
  // Use the raster fringe as a separate foreground at the two hairline
  // intersections. An estimated cutout alone leaves tiny old socket pixels
  // between the red strand and the new straight forehead.
  const [, leftTop, leftHair, tip, rightHair, rightTop] = contour;
  const fringe = new Path2D();
  fringe.moveTo(leftHair[0] - x, leftHair[1] - y);
  fringe.lineTo(tip[0] - x, tip[1] - y);
  fringe.lineTo(rightHair[0] - x, rightHair[1] - y);
  context.clearRect(0, 0, width, height);
  context.lineWidth = 14;
  context.lineJoin = 'round';
  context.stroke(fringe);
  const hairBand = context.getImageData(0, 0, width, height).data;
  context.clearRect(0, 0, width, height);
  context.fill(outline);
  const forehead = new Path2D();
  forehead.moveTo(leftTop[0] - x, leftTop[1] - y);
  forehead.lineTo(rightTop[0] - x, rightTop[1] - y);
  forehead.lineTo(tip[0] - x, tip[1] - y + Math.sign(rightTop[0] - leftTop[0]) * 4);
  forehead.closePath();
  context.fill(forehead);
  const solid = context.getImageData(0, 0, width, height).data;
  const lowerEdge = new Path2D();
  const [startX, startY] = contour.at(-2);
  const [controlX, controlY, endX, endY] = contour.at(-1);
  lowerEdge.moveTo(startX - x, startY - y);
  lowerEdge.quadraticCurveTo(controlX - x, controlY - y, endX - x, endY - y);
  context.clearRect(0, 0, width, height);
  context.lineWidth = 32;
  context.lineCap = 'round';
  context.stroke(lowerEdge);
  const jawBand = context.getImageData(0, 0, width, height).data;
  const colors = [[], [], []];
  const source = original.data;
  // Keep real foreground locks, including their antialiased edges. Isolated
  // red compression specks outside a lock are not part of its silhouette.
  const redHair = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    let start = 0;
    for (let col = 0; col <= width; col++) {
      const offset = 4 * (row * width + col);
      const r = source[offset];
      if (col < width && r > 90 && r > source[offset + 1] * 1.6 && r > source[offset + 2] * 1.3)
        continue;
      if (col - start >= 3) {
        for (let dy = -1; dy <= 1; dy++) {
          const other = row + dy;
          if (other >= 0 && other < height)
            redHair.fill(
              1,
              other * width + Math.max(0, start - 1),
              other * width + Math.min(width, col + 1),
            );
        }
      }
      start = col + 1;
    }
  }
  for (let i = 0; i < source.length; i += 4) {
    if (face[i + 3] === 255 && source[i + 1] > 205 && isSkinGreen(source.subarray(i, i + 4)))
      colors.forEach((values, channel) => values.push(source[i + channel]));
  }
  const green = colors.map(
    (values, channel) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? [0, 245, 76][channel],
  );
  const slope = (rightTop[1] - leftTop[1]) / (rightTop[0] - leftTop[0]);
  const orientation = Math.sign(rightTop[0] - leftTop[0]);
  for (let i = 0; i < source.length; i += 4) {
    const besideHair = hairBand[i + 3] / 255;
    const coverage = (face[i + 3] + (solid[i + 3] - face[i + 3]) * besideHair) / 255;
    const pixel = source.subarray(i, i + 4);
    const [r, g, b] = pixel;
    const greenFringe = g > 12 && g > r * 1.16 && g > b * 1.08;
    const atJaw = jawBand[i + 3] > 0;
    const px = x + ((i / 4) % width) + 0.5;
    const py = y + Math.floor(i / 4 / width) + 0.5;
    const topDepth = orientation * (py - leftTop[1] - (px - leftTop[0]) * slope);
    const atRoof =
      topDepth > -15 &&
      topDepth < 1 &&
      (px - leftTop[0]) * orientation >= 0 &&
      (rightTop[0] - px) * orientation >= 0;
    if (coverage === 0 && !((atJaw || atRoof) && greenFringe)) continue;
    // Preserve the painted hairline. Only the green-to-black cheek edge
    // replaces the original raster silhouette with a continuous curve.
    const background = (atJaw || atRoof) && greenFringe ? jawColor : pixel;
    const underHair =
      redHair[i / 4] && (besideHair || (Math.abs(px - leftTop[0]) < 24 && topDepth < 52));
    if (underHair && r > 145 && r > g * 4 && r > b * 1.5) continue;
    const hairAlpha = underHair ? Math.min(1, Math.max(0, (r - 22) / 216)) : 0;
    for (let channel = 0; channel < 3; channel++) {
      const hair = r > 210 ? pixel[channel] : [246, 0, 44][channel];
      const painted = green[channel] + hairAlpha * (hair - green[channel]);
      clean.data[i + channel] = Math.round(
        painted * coverage + background[channel] * (1 - coverage),
      );
    }
  }
}

function cleanPose(image, profile) {
  const [mx, my, angle, scale] = profile.mouth;
  const [left, top, right, bottom] = profile.skin;
  const contour =
    profile.contour &&
    foreheadContour(profile.contour).map((segment) =>
      profile.inverted ? segment.map((coordinate) => faceSize - coordinate) : segment,
    );
  const points = [
    ...(contour?.flatMap(pointPairs) ?? []),
    ...profile.sockets.flatMap(pointPairs),
    [left, top],
    [right, bottom],
    [mx - 35, my - 32],
    [mx + 35, my + 29],
  ];
  const x = Math.floor(Math.min(...points.map(([px]) => px))) - 8;
  const y = Math.floor(Math.min(...points.map(([, py]) => py))) - 8;
  const width = Math.ceil(Math.max(...points.map(([px]) => px))) + 9 - x;
  const height = Math.ceil(Math.max(...points.map(([, py]) => py))) + 9 - y;
  const base = canvasOf(width, height);
  const ctx = base.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  const original = ctx.getImageData(0, 0, width, height);
  const clean = ctx.getImageData(0, 0, width, height);
  const colour = (index) => original.data.subarray(index, index + 4);
  const green = isSkinGreen;
  const skinOrSocket = ([r, g, b, a]) => a > 240 && !(r > 80 && r > g * 1.4 && r > b * 1.25);
  const index = (px, py) => (py * width + px) * 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const edgeHalfWidth = 74;
  let edge;
  let cheekCurve, cheekColor;
  if (contour) restoreFaceContour(original, clean, contour, x, y);
  else {
    // Recover the skin perimeter from the original raster. Closing or widening
    // the eyelid masks must never fill the jaw, headband or headphone outline.
    const edgePixels = [];
    for (let py = top - y; py <= bottom - y; py++) {
      let first, last;
      for (let px = left - x; px <= right - x; px++) {
        const rgb = colour(index(px, py));
        if (!green(rgb) || rgb[1] < 180) continue;
        first ??= px;
        last = px;
      }
      if (first !== undefined && last - first >= 2) edgePixels.push([first, py], [last, py]);
    }
    const hull = convexHull(edgePixels);
    const skin = new Path2D();
    hull.forEach(([px, py], i) => skin[i ? 'lineTo' : 'moveTo'](px, py));
    skin.closePath();
    for (const [eye, contour] of profile.sockets.entries()) {
      const outline = new Path2D();
      pointPairs(contour).forEach(([px, py], i) =>
        outline[i ? 'lineTo' : 'moveTo'](px - x, py - y),
      );
      outline.closePath();
      ctx.lineWidth = 16;
      ctx.lineJoin = 'round';
      const socket = (px, py) =>
        ctx.isPointInPath(outline, px, py) || ctx.isPointInStroke(outline, px, py);
      const [ex, ey] =
        profile.eyes[eye] ?? profile.eyes[0].map((value, i) => (value + profile.eyes[1][i]) / 2);
      const samples = [];
      for (let py = 0; py < height; py += 4) {
        for (let px = 0; px < width; px += 4) {
          const value = colour(index(px, py));
          if (
            green(value) &&
            value[1] > 205 &&
            !socket(px, py) &&
            Math.hypot(px + x - ex, py + y - ey) < 54
          )
            samples.push([px, py, value]);
        }
      }
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const at = index(px, py);
          // Keep the red hair. Remove the complete old socket, including its
          // green ring and the white pupil, before painting the new layers.
          if (
            !socket(px + 0.5, py + 0.5) ||
            !ctx.isPointInPath(skin, px + 0.5, py + 0.5) ||
            !skinOrSocket(colour(at))
          )
            continue;
          let total = 0;
          const rgb = [0, 0, 0];
          for (const [sx, sy, value] of samples) {
            const w = 1 / (36 + (px - sx) ** 2 + (py - sy) ** 2) ** 2;
            total += w;
            for (let c = 0; c < 3; c++) rgb[c] += value[c] * w;
          }
          if (total) for (let c = 0; c < 3; c++) clean.data[at + c] = rgb[c] / total;
        }
      }
    }
    // The socket mask is an approximation of the face perimeter. Take the
    // cheek–jaw edge from the untouched drawing so the mask cannot
    // turn its straight boundary into a notch or a protrusion.
    const sampledEdge = Array.from({ length: edgeHalfWidth * 2 + 1 }, (_, i) => {
      const u = (i - edgeHalfWidth) * scale;
      for (let depth = -5; depth >= -52; depth--) {
        const v = depth * scale;
        const px = Math.round(mx + cos * u - sin * v) - x;
        const py = Math.round(my + sin * u + cos * v) - y;
        if (px >= 0 && py >= 0 && px < width && py < height && green(colour(index(px, py))))
          return depth;
      }
      return -Infinity;
    });
    edge = sampledEdge.map((depth, i) => {
      if (!Number.isFinite(depth)) return depth;
      const neighbors = sampledEdge
        .slice(Math.max(0, i - 4), i + 5)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return neighbors[Math.floor(neighbors.length / 2)];
    });
    // Three median samples register the cheek arc to this particular cel,
    // even when the painted socket interrupts one or two columns of skin.
    const span = 32;
    const anchors = [-span, 0, span].map((u) => {
      const samples = edge
        .slice(edgeHalfWidth + u - 4, edgeHalfWidth + u + 5)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)];
    });
    if (anchors.every(Number.isFinite)) {
      const [leftDepth, centerDepth, rightDepth] = anchors;
      cheekCurve = (u) => {
        const t = u / span;
        return (
          centerDepth +
          ((rightDepth - leftDepth) * t) / 2 +
          ((leftDepth + rightDepth) / 2 - centerDepth) * t * t
        );
      };
      const samples = [];
      for (let u = -span; u <= span; u++) {
        const v = cheekCurve(u) - 4;
        const px = Math.round(mx + scale * (cos * u - sin * v)) - x;
        const py = Math.round(my + scale * (sin * u + cos * v)) - y;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const pixel = colour(index(px, py));
        if (green(pixel) && pixel[1] > 195) samples.push(pixel);
      }
      samples.sort((a, b) => a[1] - b[1]);
      cheekColor = samples[Math.floor(samples.length / 2)];
    }
  }
  const [eraseX, eraseY] = profile.eraseMouth ?? [mx, my];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const dx = px + x - eraseX;
      const dy = py + y - eraseY;
      const u = (cos * dx + sin * dy) / scale;
      const v = (-sin * dx + cos * dy) / scale;
      const at = index(px, py);
      const pixel = colour(at);
      const [r, g, b, a] = pixel;
      const oldMouth =
        Math.abs(u) < (profile.mouthRadius ?? 30) &&
        v > -14 &&
        v < 19 &&
        a > 240 &&
        Math.min(r, g, b) > 20 &&
        Math.max(r, g, b) - Math.min(r, g, b) < 50;
      if (oldMouth) clean.data.set(jawColor, at);
      const cheekU = (cos * (px + x - mx) + sin * (py + y - my)) / scale;
      const cheekV = (-sin * (px + x - mx) + cos * (py + y - my)) / scale;
      const boundaryDistance = cheekV - (edge?.[Math.round(cheekU) + edgeHalfWidth] ?? NaN);
      if (
        !oldMouth &&
        boundaryDistance >= -2.5 &&
        boundaryDistance <= 23 &&
        (green(pixel) || (boundaryDistance >= 0 && r < 100 && g < 155 && b < 130))
      )
        clean.data.set(pixel, at);
      if (
        cheekColor &&
        Math.abs(cheekU) < 40 &&
        Number.isFinite(boundaryDistance) &&
        !oldMouth &&
        skinOrSocket(pixel)
      ) {
        const depth = cheekV - boundaryDistance;
        const curve = cheekCurve(cheekU);
        const delta = (cheekV - curve) * scale;
        if (Math.abs(curve - depth) > 3 || Math.abs(delta) > 3 * scale) continue;
        const weight = Math.min(1, (40 - Math.abs(cheekU)) / 8, 3 - Math.abs(delta) / scale);
        const skinAmount = Math.max(0, Math.min(1, 0.5 - delta));
        const painted = clean.data.subarray(at, at + 4);
        if ((skinAmount === 1 && green(painted)) || (skinAmount === 0 && painted[1] < 24)) continue;
        for (let c = 0; c < 3; c++) {
          const target = cheekColor[c] * skinAmount + jawColor[c] * (1 - skinAmount);
          painted[c] += weight * (target - painted[c]);
        }
      }
    }
  }
  ctx.putImageData(clean, 0, 0);
  return { base, bounds: [x, y, width, height] };
}

// The painted action cels use the standing face at a range of rotations and
// scales. The builder measures the pupils in each cel and reprojects the clean
// plate and separate expressions into that cel before it goes into the atlas.
function restoreCelTemple(base, bounds, matrix) {
  // Work in the registered standing coordinates. Locate the real skin edge
  // in each exposure; hair, accessories and the old eyes move independently.
  const sx = 551,
    sy = 330,
    w = 67,
    h = 76;
  const scan = canvasOf(w, h).getContext('2d', { willReadFrequently: true });
  const inverse = new DOMMatrix(matrix).inverse();
  scan.translate(-sx, -sy);
  scan.transform(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f);
  scan.drawImage(base, bounds[0], bounds[1]);
  const reference = scan.getImageData(0, 0, w, h).data;
  const color = (x, y) => {
    const i = ((y - sy) * w + x - sx) * 4;
    return reference.subarray(i, i + 4);
  };
  const rowEdges = [];
  for (let y = 383; y <= 398; y++) {
    for (let x = 553; x <= 585; x++) {
      if (!isSkinGreen(color(x, y))) continue;
      rowEdges.push(x);
      break;
    }
  }
  if (!rowEdges.length) return;
  rowEdges.sort((a, b) => a - b);
  const left = rowEdges[Math.floor(rowEdges.length * 0.15)];
  const mask = canvasOf(base.width, base.height).getContext('2d', { willReadFrequently: true });
  mask.translate(-bounds[0], -bounds[1]);
  mask.transform(...matrix);
  const roof = (x) => 362.6 - 0.23 * (x - 566.6);
  let run = [];
  const fillRun = () => {
    if (!run.length) return;
    mask.beginPath();
    mask.moveTo(run[0][0], roof(run[0][0]));
    mask.lineTo(run.at(-1)[0] + 1, roof(run.at(-1)[0] + 1));
    for (let j = run.length - 1; j >= 0; j--) mask.lineTo(run[j][0] + 0.5, run[j][1] + 4);
    mask.closePath();
    mask.fill();
    run = [];
  };
  const skin = [];
  for (let x = left; x <= 608; x++) {
    const yTop = Math.floor(roof(x));
    let y = yTop;
    while (y < 402 && !isSkinGreen(color(x, y))) y++;
    if (y === 402 || y - yTop > 40) {
      fillRun();
      continue;
    }
    run.push([x, y]);
    const sample = color(x, Math.min(403, y + 2));
    if (sample[1] > 205 && isSkinGreen(sample)) skin.push(sample);
  }
  fillRun();
  if (!skin.length) return;
  skin.sort((a, b) => a[1] - b[1]);
  const greenColor = skin[Math.floor(skin.length / 2)];
  const ctx = base.getContext('2d');
  const pixels = ctx.getImageData(0, 0, base.width, base.height);
  const coverage = mask.getImageData(0, 0, base.width, base.height).data;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (!coverage[i + 3]) continue;
    const [r, g, b, a] = pixels.data.subarray(i, i + 4);
    if (a < 240 || r > 80 || (r > 40 && r > g * 1.35 && r > b * 1.25)) continue;
    const amount = coverage[i + 3] / 255;
    for (let c = 0; c < 3; c++) pixels.data[i + c] += amount * (greenColor[c] - pixels.data[i + c]);
  }
  ctx.putImageData(pixels, 0, 0);
}

export function buildGestureFacePlate(
  image,
  eyes,
  state,
  draw,
  { mouth, mouthRadius, eraseMouth, cleanBridge } = {},
) {
  const [[sx, sy], [ex, ey]] = faceEyeCenters;
  const [[x, y], [right, top]] = eyes;
  const rotation = Math.atan2(top - y, right - x) - Math.atan2(ey - sy, ex - sx);
  const scale = Math.hypot(right - x, top - y) / Math.hypot(ex - sx, ey - sy);
  const [a, b, c, d, u, v] = place([x, y, scale, rotation], [sx, sy]);
  const project = ([px, py]) => [a * px + c * py + u, b * px + d * py + v];
  const corners = [
    [558, 315],
    [707, 315],
    [707, 432],
    [558, 432],
  ].map(project);
  const skin = [
    Math.floor(Math.min(...corners.map(([px]) => px))),
    Math.floor(Math.min(...corners.map(([, py]) => py))),
    Math.ceil(Math.max(...corners.map(([px]) => px))),
    Math.ceil(Math.max(...corners.map(([, py]) => py))),
  ];
  const profile = {
    skin,
    eyes: eyes.map(([px, py]) => [px, py, scale, rotation]),
    mouth: [...(mouth ?? project(jaw)), rotation - 0.35, scale],
    eraseMouth,
    mouthRadius,
    sockets: [
      [
        [563, 390],
        [595, 350],
        [610, 373],
        [625, 412],
        [581, 431],
      ],
      [
        [629, 360],
        [671, 334],
        [696, 345],
        [701, 382],
        [690, 399],
        [635, 408],
      ],
    ].map((polygon) => polygon.flatMap(project)),
  };
  if (cleanBridge)
    profile.sockets.push(
      [
        [604, 373],
        [642, 367],
        [642, 410],
        [606, 414],
      ].flatMap(project),
    );
  const plate = cleanPose(image, profile);
  restoreCelTemple(plate.base, plate.bounds, [a, b, c, d, u, v]);
  const patch = makePatch(plate.base, plate.bounds, draw, alignment(profile));
  const [, , width, height] = patch.bounds;
  const base = canvasOf(width, height);
  patch.paint(base.getContext('2d'), state);
  return { base, bounds: patch.bounds };
}
