// SPDX-License-Identifier: GPL-3.0-only
import { avatarPoseSegments } from '../avatar-pose-motion.mjs';
import { armRegions, gripArt } from './music-grip-art.mjs';

const extent = 1254;
const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rotate = (p, pivot, c, s) => [
  pivot[0] + c * (p[0] - pivot[0]) - s * (p[1] - pivot[1]),
  pivot[1] + s * (p[0] - pivot[0]) + c * (p[1] - pivot[1]),
];

// A single rigid transform carries the hair, face and torso. Both arms put a
// limit on its reach. Each elbow is the intersection of two fixed-radius circles.
export function gripSkeleton(id, channels) {
  const profile = gripArt[id],
    { axis, pivot, arms } = profile;
  const theta = (channels.lean * 0.83 * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta);
  const delta = axis
    ? [channels.bodyX * 0.12, -channels.bodyY * 0.65]
    : [-channels.bodyX * 0.52, channels.bodyY + channels.headY * 0.25];
  const other = 1 - axis;
  for (const { wrist, elbow, shoulder } of arms) {
    const end = rotate(shoulder, pivot, c, s);
    const reach = length(wrist, elbow) + length(elbow, shoulder);
    const cross = end[other] + delta[other] - wrist[other];
    const available = Math.sqrt(Math.max(0, reach * reach - cross * cross));
    const dist = end[axis] + delta[axis] - wrist[axis];
    if (Math.abs(dist) > available) delta[axis] += Math.sign(dist) * available - dist;
  }
  const limbs = arms.map(({ wrist, elbow, shoulder }) => {
    const point = rotate(shoulder, pivot, c, s);
    const end = [point[0] + delta[0], point[1] + delta[1]];
    const d = length(wrist, end),
      l1 = length(wrist, elbow),
      l2 = length(elbow, shoulder);
    const u = (end[0] - wrist[0]) / d,
      v = (end[1] - wrist[1]) / d;
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const bend = Math.sign(
      (shoulder[0] - wrist[0]) * (elbow[1] - wrist[1]) -
        (shoulder[1] - wrist[1]) * (elbow[0] - wrist[0]),
    );
    const offset = bend * Math.sqrt(Math.max(0, l1 * l1 - along * along));
    return {
      elbow: [wrist[0] + along * u - offset * v, wrist[1] + along * v + offset * u],
      shoulder: end,
    };
  });
  return { pivot, theta, delta, limbs };
}

function rotateBone(ctx, original, next, draw) {
  const [a, b] = original,
    [u, v] = next;
  const angle = Math.atan2(v[1] - u[1], v[0] - u[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.save();
  ctx.translate(...u);
  ctx.rotate(angle);
  ctx.translate(-a[0], -a[1]);
  draw();
  ctx.restore();
}
function part(ctx, atlas, r, axis, from, to) {
  const x = axis ? r.x : Math.max(r.x, from),
    y = axis ? Math.max(r.y, from) : r.y;
  const w = axis ? r.w : Math.min(r.x + r.w, to) - x,
    h = axis ? Math.min(r.y + r.h, to) - y : r.h;
  if (w > 0 && h > 0) ctx.drawImage(atlas, x - r.x, r.row + y - r.y, w, h, x, y, w, h);
}

export class GripBeatLayer {
  constructor(id, size) {
    this.id = id;
    this.size = size;
    this.profile = gripArt[id];
    this.arms = armRegions(this.profile);
    this.segments = avatarPoseSegments(id);
    this.atlas = new Image();
    this.atlas.src = '/music-grip-plates/' + id + '.png';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.face = new Path2D();
    this.profile.face.forEach(([x, y], index) =>
      index ? this.face.lineTo(x, y) : this.face.moveTo(x, y),
    );
    this.face.closePath();
    this.body = new Path2D();
    this.body.rect(0, 0, extent, extent);
    for (const {
      bounds: [x, y, right, bottom],
    } of this.segments)
      this.body.rect(x, y, right - x, bottom - y);
  }
  image(source, channels) {
    if (!this.atlas.complete || !this.atlas.naturalWidth) return source;
    const ctx = this.canvas.getContext('2d'),
      { axis } = this.profile;
    const { pivot, theta, delta, limbs } = gripSkeleton(this.id, channels);
    ctx.setTransform(this.size / extent, 0, 0, this.size / extent, 0, 0);
    ctx.clearRect(0, 0, extent, extent);
    ctx.save();
    ctx.translate(pivot[0] + delta[0], pivot[1] + delta[1]);
    ctx.rotate(theta);
    ctx.translate(-pivot[0], -pivot[1]);
    ctx.save();
    ctx.clip(this.body, 'evenodd');
    ctx.drawImage(this.atlas, 0, 0, extent, extent, 0, 0, extent, extent);
    ctx.restore();
    ctx.save();
    ctx.clip(this.face);
    ctx.drawImage(source, 0, 0, extent, extent);
    ctx.restore();
    for (const {
      pivot: [px, py],
      amplitude,
      bounds: [x, y, right, bottom],
    } of this.segments) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((channels.legSwing * amplitude * Math.PI) / 180);
      ctx.translate(-px, -py);
      ctx.drawImage(
        this.atlas,
        x,
        y - 4,
        right - x,
        bottom - y + 4,
        x,
        y - 4,
        right - x,
        bottom - y + 4,
      );
      ctx.restore();
    }
    ctx.restore();
    for (const [index, r] of this.arms.entries()) {
      const { wrist, elbow, shoulder } = r,
        next = limbs[index];
      const ascending = shoulder[axis] > wrist[axis],
        w = wrist[axis],
        e = elbow[axis];
      const draw = (a, b) => part(ctx, this.atlas, r, axis, a, b);
      // Overlap the two solid-ink cuts at the hinge so no transparent seam opens.
      rotateBone(ctx, [elbow, shoulder], [next.elbow, next.shoulder], () =>
        ascending ? draw(e - 5, extent) : draw(0, e + 5),
      );
      rotateBone(ctx, [wrist, elbow], [wrist, next.elbow], () =>
        ascending ? draw(w - 4, e + 5) : draw(e - 5, w + 4),
      );
      if (ascending) draw(0, w + 4);
      else draw(w - 4, extent);
    }
    return this.canvas;
  }
}
