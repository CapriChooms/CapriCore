// SPDX-License-Identifier: GPL-3.0-only
const size = 1254;
export const blinkEyeArea = { x: 551, y: 332, width: 156, height: 103 };
export const blinkPalette = { green: '#00f54c', ink: '#050409', blue: '#066bea', white: '#ffffff' };
export const layeredBlinkAssets = {
  pose: '/avatar-blink-pose.png',
  eyes: '/avatar-blink-eyes.png',
};
export const layeredBlinkDuration = 1710;
// Convert an offset within one blink, keeping the surrounding performance on its own clock.
export const blinkOffset = (ms) => ms / 1.5;

const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => value * value * (3 - 2 * value);
const mix = (from, to, amount) => from + (to - from) * amount;
const closingLidScale = 1.4;

export function layeredBlinkPose(time) {
  const ramp = (start, duration) => ease(clamp((time - start) / duration));
  return {
    closure: ramp(410, blinkOffset(230)) - ramp(410 + blinkOffset(320), blinkOffset(270)),
    smile: ramp(975, 220) - ramp(1310, 260),
  };
}

// Coordinates are registered to the neutral sprite. Corners belong to the sockets.
// Both contours run from left to right, even where a corner turns back on itself.
const sockets = [
  {
    upper: [
      [568.9, 392.6],
      [569.2, 385, 577.2, 378.2, 588.4, 377.7],
      [596.2, 376.9],
      [607.2, 379.2, 613.2, 390.4, 617.6, 406.9],
    ],
    lower: [
      [568.9, 392.6],
      [568.3, 400.1, 574.2, 409.1, 583.8, 413.2],
      [589.6, 416.6],
      [602.7, 418.2, 611.6, 412.3, 617.6, 406.9],
    ],
    smoothUpper: [570.2, 400.5, 572.7, 374.0, 605.8, 367.7, 616.0, 390.8],
    smoothLower: [570.2, 400.5, 577.0, 421.0, 607.8, 420.0, 616.0, 390.8],
    lashes: [
      [
        [588.4, 378.8],
        [595.5, 361.9],
        [596.2, 378],
      ],
      [
        [583.8, 412],
        [584.4, 424.4],
        [589.6, 415.2],
      ],
    ],
    seam: [574.9, 409, 594.8, 407.5, 615.2, 398.8],
    radius: [16.3, 17.7],
    center: [595.15, 398.5],
    tilt: -0.19,
    thickness: 1.65,
  },
  {
    upper: [
      [642.4, 399.4],
      [641.8, 384.8, 641.3, 372.6, 646.8, 363.2],
      [651.5, 355.6],
      [666.7, 345, 679.8, 348, 692.2, 357.1],
    ],
    lower: [
      [642.4, 399.4],
      [655.4, 401.6, 668.8, 402.3, 678.4, 394.8],
      [683.2, 390.7],
      [689.6, 384, 690.1, 372.8, 692.2, 357.1],
    ],
    smoothUpper: [642.9, 382.1, 645.2, 357.4, 673.6, 341.0, 690.6, 370.6],
    smoothLower: [642.9, 382.1, 653.8, 404.0, 684.2, 403.0, 690.6, 370.6],
    lashes: [
      [
        [648, 363.5],
        [647.45, 349.45],
        [652.5, 356.2],
      ],
      [
        [677.6, 393.3],
        [686.2, 400.15],
        [682.2, 389.5],
      ],
    ],
    seam: [644.1, 390.4, 670.8, 387.6, 690.3, 376.6],
    radius: [19.3, 19.8],
    center: [665.65, 376.65],
    tilt: -0.1,
    thickness: 1.9,
  },
];

function quadratic(a, b, c, t) {
  return mix(mix(a, b, t), mix(b, c, t), t);
}

// Arc length registers corresponding points on the open contour and closed lid.
function registerContour(commands, seam, smooth, preserveWidth = false) {
  const points = [commands[0]];
  for (const segment of commands.slice(1)) {
    const [x, y] = points.at(-1);
    const count = segment.length === 2 ? 12 : 32;
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      if (segment.length === 2) points.push([mix(x, segment[0], t), mix(y, segment[1], t)]);
      else {
        const cubic = (start, a, b, end) =>
          mix(quadratic(start, a, b, t), quadratic(a, b, end, t), t);
        points.push([
          cubic(x, segment[0], segment[2], segment[4]),
          cubic(y, segment[1], segment[3], segment[5]),
        ]);
      }
    }
  }
  let length = 0;
  const distances = points.map(([x, y], i) => {
    if (i) length += Math.hypot(x - points[i - 1][0], y - points[i - 1][1]);
    return length;
  });
  return points.map(([x, y], i) => {
    const t = distances[i] / length;
    const guide = (a, b, c, d) => mix(quadratic(a, b, c, t), quadratic(b, c, d, t), t);
    const keepSpan = (value, start, end) =>
      preserveWidth
        ? start + ((value - start) * (points.at(-1)[0] - points[0][0])) / (end - start)
        : value;
    return {
      x,
      y,
      guideX: keepSpan(guide(smooth[0], smooth[2], smooth[4], smooth[6]), smooth[0], smooth[6]),
      guideY: guide(smooth[1], smooth[3], smooth[5], smooth[7]),
      shutX: keepSpan(quadratic(seam[0], seam[2], seam[4], t), seam[0], seam[4]),
      shutY: quadratic(seam[1], seam[3], seam[5], t),
      taper: Math.sin(Math.PI * t) ** 0.78,
      arch: 4 * t * (1 - t),
    };
  });
}

function registerLash([a, tip, b], contour, side, mirror) {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const dx = tip[0] - cx,
    dy = tip[1] - cy;
  const open = {
    position: (cx - contour[0].x) / (contour.at(-1).x - contour[0].x),
    baseWidth: b[0] - a[0],
    half: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
    tipX: dx * cos + dy * sin,
    tipY: -dx * sin + dy * cos,
  };
  // Reverse the along-lid coordinate in the local frame of the tilted eye.
  const closed = mirror ? { ...mirror, position: 1 - mirror.position, tipX: -mirror.tipX } : open;
  return { contour, side, open, closed };
}

function registerEye(eye, preserveWidth, mirrorEye) {
  const top = registerContour(eye.upper, eye.seam, eye.smoothUpper, preserveWidth);
  const bottom = registerContour(eye.lower, eye.seam, eye.smoothLower, preserveWidth);
  return {
    ...eye,
    top,
    bottom,
    lashes: [
      registerLash(eye.lashes[0], top, -1, mirrorEye?.lashes[0].open),
      registerLash(eye.lashes[1], bottom, 1, mirrorEye?.lashes[1].open),
    ],
  };
}
const leftEye = registerEye(sockets[0], false);
const registered = [leftEye, registerEye(sockets[1], false, leftEye)];
const winkingEye = registerEye(sockets[0], true);

function lidPoint(point, closure, lift, retractCorner) {
  return [
    mix(mix(point.x, point.guideX, retractCorner), point.shutX, closure),
    mix(mix(point.y, point.guideY, retractCorner), point.shutY, closure) -
      point.arch * lift * closure,
  ];
}

function outline(eye, closure, halfWidth = 0, lift = 0, upperOnly = false) {
  const path = new Path2D();
  const retractCorner = ease(clamp(closure / 0.47));
  const cap = Math.max(0, halfWidth) * 0.48 * ease(clamp((closure - 0.5) / 0.3));
  const add = (point, side, first) => {
    const [x, baseline] = lidPoint(point, closure, lift, retractCorner);
    const y = baseline + side * mix(cap, halfWidth, point.taper);
    if (first) path.moveTo(x, y);
    else path.lineTo(x, y);
  };
  eye.top.forEach((point, i) => add(point, -1, i === 0));
  if (upperOnly) return path;
  for (let i = eye.bottom.length - 1; i >= 0; i--) add(eye.bottom[i], 1, false);
  path.closePath();
  return path;
}

function paintLashes(context, eye, closure, lift, thickness) {
  const retractCorner = ease(clamp(closure / 0.47));
  context.fillStyle = blinkPalette.ink;
  const travel = ease(closure);
  for (const { open, closed, contour, side } of eye.lashes) {
    // Mount the lash on the tangent of the visible outer rim. A fixed
    // screen-space angle leaves a corner poking through a fully closed lid.
    const cap = thickness * 0.48 * ease(clamp((closure - 0.5) / 0.3));
    const first = contour[0],
      last = contour.at(-1);
    const cx = mix(
      lidPoint(first, closure, lift, retractCorner)[0],
      lidPoint(last, closure, lift, retractCorner)[0],
      mix(open.position, closed.position, travel),
    );
    const heightAt = (x) => {
      let last;
      for (const point of contour) {
        const [px, base] = lidPoint(point, closure, lift, retractCorner);
        const py = base + side * mix(cap, thickness, point.taper);
        if (last && last[0] <= x && px >= x && px > last[0])
          return mix(last[1], py, (x - last[0]) / (px - last[0]));
        last = [px, py];
      }
      return last[1];
    };
    const baseWidth = mix(open.baseWidth, closed.baseWidth, travel);
    const a = heightAt(cx - baseWidth / 2),
      b = heightAt(cx + baseWidth / 2);
    const angle = Math.atan2(b - a, baseWidth);
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const cy = (a + b) / 2 - side * 0.45;
    context.beginPath();
    const half = mix(open.half, closed.half, travel);
    const u = mix(open.tipX, closed.tipX, travel);
    const v = mix(open.tipY, closed.tipY, travel);
    context.moveTo(cx - cos * half, cy - sin * half);
    context.lineTo(cx + cos * u - sin * v, cy + sin * u + cos * v);
    context.lineTo(cx + cos * half, cy + sin * half);
    context.closePath();
    context.fill();
  }
}

// Draw the socket and eyeball independently. The socket keeps gaze within its silhouette.
function paintEye(context, eye, shape, gaze) {
  context.save();
  context.fillStyle = blinkPalette.ink;
  context.fill(shape);
  context.clip(shape);
  context.translate(eye.center[0] + gaze[0], eye.center[1] + gaze[1]);
  context.rotate(eye.tilt);
  context.scale(...eye.radius);
  for (const [radius, color] of [
    [1, 'green'],
    [0.84, 'ink'],
    [0.615, 'blue'],
    [0.275, 'white'],
  ]) {
    context.beginPath();
    context.arc(0, 0, radius, 0, 2 * Math.PI);
    context.fillStyle = blinkPalette[color];
    context.fill();
  }
  context.restore();
}

const restingGaze = [0, 0];
export const faceEyeCenters = registered.map(({ center }) => center);

export function paintBlinkEyeArtwork(context) {
  for (const eye of registered) paintEye(context, eye, outline(eye, 0), restingGaze);
}

export function paintFaceMouth(context, points) {
  const path = new Path2D();
  path.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 4)
    path.quadraticCurveTo(...points.slice(index, index + 4));
  path.closePath();
  context.fillStyle = blinkPalette.white;
  context.fill(path);
}

function paintSmile(context, smile) {
  const mouth = new Path2D();
  mouth.moveTo(614.3, 426.1);
  mouth.quadraticCurveTo(624.2, 427.7 - 2.8 * smile, 631.5, 425.8 - 2.2 * smile);
  mouth.quadraticCurveTo(641.6, 421.6 - smile, 653.8, 414.9);
  mouth.quadraticCurveTo(646.3, 422.9 + smile, 634, 432.3 + 1.7 * smile);
  mouth.quadraticCurveTo(625.1, 429.5 + 1.4 * smile, 614.3, 426.1);
  context.fillStyle = blinkPalette.white;
  context.fill(mouth);
}

export function prepareLayeredBlink(poseLayer, eyesLayer) {
  const { x, y, width, height } = blinkEyeArea;
  if (
    poseLayer.width !== size ||
    poseLayer.height !== size ||
    eyesLayer.width < width ||
    eyesLayer.width * height !== eyesLayer.height * width
  )
    throw new Error('Layered blink needs the registered standing pose and eye layers.');

  const open = registered.map((eye) => outline(eye, 0));
  return (context, outputSize, state, layer, registration) => {
    context.save();
    context.scale(outputSize / size, outputSize / size);
    if (!layer || layer === 'pose') context.drawImage(poseLayer, 0, 0);
    if (!layer || ['face', 'eyes', 'mask', 'lids', 'eye-art'].includes(layer)) {
      registered.forEach((restEye, index) => {
        const eye = index === 0 && state.wink ? winkingEye : restEye;
        context.save();
        if (registration) context.transform(...registration.eyes[index]);
        const closure =
          layer === 'eye-art' ? 0 : clamp(state.eyelids?.[index] ?? state.closure ?? 0);
        const gaze = state.gaze ?? restingGaze;
        const lift = state.lift ?? 0;
        const aperture = closure ? outline(eye, closure, 0, lift) : open[index];
        if ((!layer || ['face', 'eyes', 'eye-art'].includes(layer)) && closure < 1) {
          context.save();
          if (!gaze[0] && !gaze[1]) {
            // Restrict the shared PNG to one eye so each lid can close independently.
            const split = 628;
            const left = index === 0 ? x : split;
            const right = index === 0 ? split : x + width;
            const ratio = eyesLayer.width / width;
            context.clip(aperture);
            context.drawImage(
              eyesLayer,
              (left - x) * ratio,
              0,
              (right - left) * ratio,
              eyesLayer.height,
              left,
              y,
              right - left,
              height,
            );
          } else {
            if (closure > 0) context.clip(aperture);
            paintEye(context, eye, open[index], gaze);
          }
          context.restore();
        }
        if (layer === 'mask' && closure > 0) {
          const hidden = new Path2D(open[index]);
          if (closure < 1) hidden.addPath(aperture);
          context.save();
          context.clip(open[index]);
          context.fillStyle = '#000';
          context.fill(hidden, 'evenodd');
          context.restore();
        }
        if (!layer || layer === 'face' || layer === 'lids') {
          const weight =
            closingLidScale * Math.sin((closure * Math.PI) / 2) * (1 + 0.15 * closure ** 4);
          const thickness = eye.thickness * weight;
          if (closure > 0) {
            const band = outline(eye, closure, thickness, lift);
            // Ease the last slit into the seam so it disappears continuously.
            const slit = 1 - ease(clamp((closure - 0.9) / 0.08));
            if (slit > 0)
              band.addPath(outline(eye, mix(1, closure, slit), -0.17 * weight * slit, lift));
            context.fillStyle = blinkPalette.ink;
            context.fill(band, 'evenodd');
          }
          if (closure < 0.92) {
            // Stroke inward from the socket, including its steep corners, so the
            // rim stays continuous and cannot spill into the hair or green face.
            const rim =
              (1 - ease(closure / 0.92)) * mix(1, closingLidScale, ease(clamp(closure / 0.16)));
            context.save();
            context.clip(aperture);
            context.strokeStyle = blinkPalette.ink;
            context.lineJoin = 'round';
            context.lineCap = 'round';
            context.lineWidth = 3.7 * rim;
            context.stroke(aperture);
            context.lineWidth = 6.5 * rim;
            context.stroke(outline(eye, closure, 0, lift, true));
            context.restore();
          }
          paintLashes(context, eye, closure, lift, thickness);
        }
        context.restore();
      });
    }
    if (!layer || layer === 'face' || layer === 'mouth') {
      if (registration) context.transform(...registration.mouth);
      if (state.mouth) paintFaceMouth(context, state.mouth);
      else paintSmile(context, clamp(state.smile ?? 0));
    }
    context.restore();
  };
}
