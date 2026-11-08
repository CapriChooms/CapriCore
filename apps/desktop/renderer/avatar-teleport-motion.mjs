// SPDX-License-Identifier: GPL-3.0-only
// Approved Stage 1 red-lightning choreography. Coordinates are in CSS pixels.
const fps = 24;
const frames = 28;
const transitStart = 6;
const arrivalStart = 15;
const settleFrame = frames - 1;
const headPositions = [0.11, 0.19, 0.3, 0.42, 0.55, 0.67, 0.79, 0.9, 1];
const strikeReach = [0.15, 0.34, 0.26, 0.19, 0.11, 0.055];
const boltOnlyFrames = arrivalStart + strikeReach.length;
const red = '#ff003d';
const filament = '#cc123c';

function sample(values, at) {
  const index = Math.max(0, Math.min(values.length - 1, at));
  const first = Math.floor(index);
  return (
    values[first] +
    (values[Math.min(first + 1, values.length - 1)] - values[first]) * (index - first)
  );
}

function effectLevel(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : fallback;
}

function phase(frame) {
  if (frame >= settleFrame) return 'idle';
  if (frame >= arrivalStart) return 'arrival';
  if (frame >= transitStart) return 'transit';
  return 'departure';
}

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function lineBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length, length };
}

function along(at, axis, forward, across) {
  return {
    x: at.x + axis.x * forward - axis.y * across,
    y: at.y + axis.y * forward + axis.x * across,
  };
}

function trace(context, points) {
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function outline(context, points) {
  context.beginPath();
  trace(context, points);
}

function fill(context, points, color) {
  outline(context, points);
  context.fillStyle = color;
  context.fill();
}

function between(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function notch(edge, start, end, side, radius, jaggedness) {
  const axis = lineBetween(start, end);
  if (axis.length < 15 || radius < 2) return;
  const depth = Math.min(8, radius * 0.42) * jaggedness;
  edge.push(
    between(start, end, 0.21),
    along(between(start, end, 0.25), axis, 0, -side * depth),
    along(between(start, end, 0.34), axis, 0, -side * depth * 0.74),
    between(start, end, 0.37),
  );
  if (jaggedness > 0.65 && axis.length > 26)
    edge.push(
      between(start, end, 0.61),
      along(between(start, end, 0.65), axis, 0, -side * depth * 0.68),
      along(between(start, end, 0.76), axis, 0, -side * depth * 0.48),
      between(start, end, 0.78),
    );
}

// Asymmetric edges and occasional cut-in notches give the heavy red slashes
// a hand-drawn profile at the turns and along the straight segments.
function ribbon(context, points, width, color, jaggedness = 0) {
  const upper = [];
  const lower = [];
  for (const [index, point] of points.entries()) {
    const left = points[Math.max(0, index - 1)];
    const right = points[Math.min(points.length - 1, index + 1)];
    const axis = lineBetween(left, right);
    const radius = width(point, index);
    const high = along(point, axis, 0, radius * (index % 2 ? 0.63 : 1.12));
    const low = along(point, axis, 0, -radius * (index % 2 ? 1.06 : 0.59));
    if (jaggedness > 0.25 && index > 0) {
      if (index % 2) notch(upper, upper.at(-1), high, 1, radius, jaggedness);
      else notch(lower, lower.at(-1), low, -1, radius, jaggedness);
    }
    upper.push(high);
    lower.push(low);
  }
  fill(context, upper.concat(lower.reverse()), color);
}

function makeRoute(from, to, axis, amplitude, { jaggedness, seed }, bounds) {
  const random = randomSource(seed);
  const points = [{ ...from, t: 0 }];
  const corners = [
    [0.15, -0.28, 0.25],
    [0.29, 0.62, 0],
    [0.4, -0.59, 0.4],
    [0.56, 0.76, 0],
    [0.69, 0.24, 0.52],
    [0.79, -0.7, 0],
    [0.9, 0.15, 0.27],
  ];
  const mirror = random() < 0.5 ? -1 : 1;
  const add = (point, t) => {
    if (bounds) {
      point.x = Math.max(12, Math.min(bounds.width - 12, point.x));
      point.y = Math.max(12, Math.min(bounds.height - 12, point.y));
    }
    points.push({ ...point, t });
  };
  for (const [base, offset, minimum] of corners) {
    const t = base + (random() - 0.5) * (0.025 + jaggedness * 0.035);
    const bend = offset * amplitude * mirror * (0.73 + random() * 0.45);
    const crack = (0.18 + random() * 0.16) * amplitude * jaggedness;
    if (jaggedness < minimum) continue;
    const corner = along(from, axis, t * axis.length, bend);
    if (jaggedness > 0.55 && crack > 2) {
      // Two opposing elbows cut into the approach to a main bend. Their
      // timeline order stays fixed for the whole flight.
      const previous = points.at(-1);
      const side = Math.sign(bend);
      add(
        along(between(previous, corner, 0.58), axis, 0, side * crack),
        previous.t + (t - previous.t) * 0.58,
      );
      add(
        along(between(previous, corner, 0.76), axis, 0, -side * crack * 0.44),
        previous.t + (t - previous.t) * 0.76,
      );
    }
    add(corner, t);
  }
  points.push({ ...to, t: 1 });
  return points;
}

function pointAt(points, t) {
  const index = Math.max(
    1,
    points.findIndex((point) => point.t >= t),
  );
  const a = points[index - 1];
  const b = points[index];
  const u = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t };
}

function drop(context, at, radius, color = red) {
  context.beginPath();
  context.ellipse(at.x, at.y, radius, radius * 0.83, -0.35, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function drawBranches(
  context,
  points,
  head,
  tail,
  scale,
  { branches, intensity, jaggedness, reducedFlash, seed },
) {
  const count = Math.ceil(branches * (reducedFlash ? 2 : 6));
  const random = randomSource(seed ^ 0xf27a64b5);
  for (let index = 0; index < count; index++) {
    const t = 0.12 + ((index + 0.14 + random() * 0.68) / count) * 0.8;
    const side = index % 2 ? 1 : -1;
    const variation = 0.78 + random() * 0.44;
    if (t <= tail || t >= head) continue;
    const origin = pointAt(points, t);
    const axis = lineBetween(pointAt(points, t - 0.055), pointAt(points, t + 0.055));
    const growth = Math.min(1, (t - tail) / 0.07, (head - t) / 0.08);
    const reach = scale * (0.13 + 0.25 * branches) * growth * variation;
    if (reach < 2) continue;
    const fork = (forward, across) => along(origin, axis, reach * forward, side * reach * across);
    const stem = [
      origin,
      fork(-0.16, 0.22),
      fork(-0.12, 0.4),
      fork(-0.49, 0.48),
      fork(-0.39, 0.68),
      fork(-0.86, 0.88),
      fork(-1.15, 1.04),
    ];
    const thickness = growth * (0.48 + intensity * 0.66) * (reducedFlash ? 0.65 : 1);
    ribbon(
      context,
      stem,
      (_point, i) => [1.45, 2.05, 1.65, 1.2, 0.8, 0.55, 0.12][i] * thickness,
      filament,
    );
    if (!reducedFlash && branches > 0.5 && jaggedness > 0.38 && index % 2 === 0) {
      const tip = fork(-0.35, 1.19);
      ribbon(
        context,
        [stem[3], fork(-0.23, 0.63), fork(-0.27, 0.86), tip],
        (_point, i) => [0.8, 0.56, 0.35, 0.12][i] * growth,
        red,
      );
      drop(context, along(tip, axis, reach * 0.06, side * reach * 0.08), 1.25 * growth);
    }
  }
}

function drawBolt(context, points, head, tail, scale, profile) {
  if (head <= tail) return;
  const { jaggedness, reducedFlash } = profile;
  const travelled = head - tail;
  const shoulder = head - travelled * 0.17;
  const segment = [
    pointAt(points, tail),
    ...points.filter(({ t }) => t > tail && t < shoulder),
    pointAt(points, shoulder),
    pointAt(points, head),
  ];
  const radius = Math.max(1, scale * (reducedFlash ? 0.065 : 0.125));
  const width = ({ t }, index) => {
    if (!index || index === segment.length - 1) return 0.55;
    const fraction = (t - tail) / travelled;
    const stagger = index % 2 ? 0.19 : -0.16;
    return radius * (0.46 + 0.47 * fraction + stagger * jaggedness);
  };
  if (travelled > 0.1) drawBranches(context, points, head, tail, scale, profile);
  ribbon(context, segment, width, red, reducedFlash ? 0 : jaggedness);
}

function drawReveal(context, at, focus, scale, amount, tint, drawCapri) {
  if (amount <= 0) return;
  if (amount >= 1) {
    drawCapri(at, tint);
    return;
  }
  const rows = [
    [-0.54, -0.28, 0.49],
    [-0.32, -0.65, 0.77],
    [-0.14, -0.89, 0.5],
    [0.03, -0.48, 0.73],
    [0.18, -0.75, 0.44],
    [0.29, -0.4, 0.58],
    [0.56, -0.22, 0.31],
  ];
  const point = (y, x) => ({
    x: focus.x + scale * amount * x,
    y: focus.y + scale * y * (0.42 + amount * 0.58),
  });
  const left = rows.map(([y, x]) => point(y, x));
  const right = rows.map(([y, , x]) => point(y, x)).reverse();
  context.save();
  outline(context, left.concat(right));
  context.clip();
  drawCapri(at, tint);
  context.restore();
}

function drawBreak(
  context,
  focus,
  axis,
  scale,
  strength,
  spread,
  { branches, intensity, jaggedness, reducedFlash, seed },
) {
  if (strength <= 0) return;
  const random = randomSource(seed);
  const shards = Math.round(reducedFlash ? 2 + intensity * 3 : 4 + intensity * 10);
  const extent = scale * spread;
  context.save();
  context.globalAlpha *= strength;
  for (let index = 0; index < shards; index++) {
    const direction = index * 2.39996 + random() * (0.34 + jaggedness * 0.48);
    const radial = { x: Math.cos(direction), y: Math.sin(direction) };
    const arm = (0.13 + random() * 0.85) * extent;
    const start = along(focus, axis, radial.x * arm * 0.7, radial.y * arm);
    const thickness = Math.max(1, scale * (0.004 + random() * 0.014));
    const length = scale * (0.026 + random() * 0.077);
    if (index % 3 === 0) {
      drop(context, start, thickness * 1.15);
      continue;
    }
    fill(
      context,
      [
        along(start, radial, -length * 0.48, -thickness),
        along(start, radial, length, 0),
        along(start, radial, -length * 0.1, thickness),
        along(start, radial, length * 0.16, 0),
      ],
      red,
    );
  }
  const lash = [
    along(focus, axis, -extent * 0.95, -extent * 1.13),
    along(focus, axis, -extent * 0.52, -extent * 0.33),
    along(focus, axis, -extent * 0.64, -extent * 0.16),
    along(focus, axis, extent * 0.25, extent * 0.22),
    along(focus, axis, extent * 0.02, extent * 0.39),
    along(focus, axis, extent * 0.89, extent * 1.16),
  ];
  const peak = scale * (reducedFlash ? 0.023 : 0.059);
  ribbon(
    context,
    lash,
    (_point, index) => [0.2, peak, peak * 0.42, peak, peak * 0.67, 0.2][index],
    red,
    reducedFlash ? 0 : jaggedness,
  );
  if (!reducedFlash && branches > 0) {
    const echo = [
      lash[1],
      along(focus, axis, -extent * 0.18, -extent * 0.64),
      along(focus, axis, extent * 0.16, -extent * 0.53),
      along(focus, axis, extent * 0.95, -extent * 1.15),
    ];
    ribbon(context, echo, (_point, i) => [1.75, 1.4, 0.9, 0.16][i] * branches, filament);
  }
  context.restore();
}

function retractBolt(context, points, scale, age, profile) {
  // Each cut takes a real piece out of the tail. The remaining ink stays solid.
  const cuts = [
    [profile.reducedFlash ? 0.61 : 0.49, 0.86],
    [0.73, 0.65, 0.57, 0.66],
    [0.84, 0.45, 0.71, 0.76],
    [0.93, 0.25, 0.81, 0.84],
    [0.977, 0.14],
  ];
  if (age >= cuts.length) return;
  const [fromTail, fromWidth, splitStart, splitEnd] = cuts[Math.floor(age)];
  const [toTail, toWidth] = cuts[Math.floor(age) + 1] ?? [1, 0];
  const fraction = age % 1;
  const tail = fromTail + (toTail - fromTail) * fraction;
  const width = fromWidth + (toWidth - fromWidth) * fraction;
  drawBolt(context, points, 1, tail, scale * width, profile);
  if (splitStart !== undefined)
    drawBolt(context, points, splitEnd, splitStart, scale * width * 0.65, profile);
}

function assemble(
  context,
  to,
  scale,
  anchor,
  age,
  { intensity, jaggedness, reducedFlash },
  drawCapri,
) {
  if (age === 0) return;
  if (age >= 8) {
    drawCapri(to);
    return;
  }
  const area = to.clip ?? {
    x: to.x - scale * anchor.x,
    y: to.y - scale * anchor.y,
    width: scale,
    height: scale,
  };
  const apertures = [0, 0.21, 0.42, 0.66, 0.85, 1];
  const bands = [
    [0, 0.38],
    [0.35, 0.61],
    [0.58, 0.83],
    [0.8, 1],
  ];
  const seams = [];
  context.save();
  context.beginPath();
  for (const [index, [start, end]] of bands.entries()) {
    const progress = sample(apertures, age - index);
    if (progress === 0) continue;
    const side = index % 2 ? 1 : -1;
    const center = area.x + area.width * (0.5 + side * 0.13 * (1 - progress));
    const left = center + (area.x - center) * progress;
    const right = center + (area.x + area.width - center) * progress;
    const top = area.y + area.height * start;
    const height = area.height * (end - start);
    const bottom = top + height;
    const tooth = (right - left) * (0.065 + jaggedness * 0.15) * (1 - progress);
    const plate = [
      { x: left + tooth, y: top },
      { x: right, y: top },
      { x: right - tooth, y: top + height * 0.29 },
      { x: right - tooth, y: top + height * 0.5 },
      { x: right, y: top + height * 0.64 },
      { x: right - tooth, y: bottom },
      { x: left, y: bottom },
      { x: left + tooth, y: top + height * 0.59 },
      { x: left + tooth, y: top + height * 0.32 },
      { x: left, y: top + height * 0.2 },
    ];
    trace(context, plate);
    if (progress < 1)
      seams.push({
        edge: side > 0 ? plate.slice(1, 6) : [...plate.slice(6), plate[0]],
        width:
          Math.min(area.width, area.height) *
          (1 - progress) *
          (0.46 + intensity * 0.72) *
          (reducedFlash ? 0.009 : 0.018),
      });
  }
  context.clip();
  drawCapri(to);
  context.restore();
  for (const { edge, width } of seams)
    ribbon(
      context,
      edge,
      (_point, index) => (index === 0 || index === edge.length - 1 ? 0.2 : width),
      red,
    );
}

function arrivalStrike(context, focus, axis, scale, age, { branches, jaggedness, reducedFlash }) {
  const reach = age < strikeReach.length ? scale * sample([...strikeReach, 0], age) : 0;
  if (!reach) return;
  const slash = [
    along(focus, axis, -reach * 0.73, -reach),
    along(focus, axis, -reach * 0.28, -reach * 0.43),
    along(focus, axis, reach * 0.12, -reach * 0.45),
    along(focus, axis, 0, 0),
    along(focus, axis, reach * 0.28, reach * 0.42),
    along(focus, axis, reach * 0.7, reach * 0.86),
  ];
  const width = reach * (reducedFlash ? 0.04 : 0.09);
  ribbon(
    context,
    slash,
    (_point, index) => [0.15, width, width * 0.68, width, width * 0.62, 0.15][index],
    red,
    reducedFlash ? 0 : jaggedness,
  );
  if (branches > 0.5 && age < 4) {
    const reachSide = reach * branches;
    const echo = [
      slash[1],
      along(focus, axis, reachSide * 0.34, -reachSide * 0.55),
      along(focus, axis, reachSide * 0.28, -reachSide * 0.74),
      along(focus, axis, reachSide * 0.69, -reachSide * 1.02),
    ];
    ribbon(
      context,
      echo,
      (_point, i) => [0.8, 1.4, 0.72, 0.1][i] * (reducedFlash ? 0.5 : 1),
      filament,
    );
  }
  if (!reducedFlash && age > 0) {
    const chip = along(focus, axis, reach * 0.72, -reach * 0.69);
    const size = reach * 0.15;
    fill(
      context,
      [
        along(chip, axis, -size, 0),
        along(chip, axis, size, -size * 0.26),
        along(chip, axis, size * 0.55, size * 0.27),
      ],
      red,
    );
  }
}

export function prepareTeleportMotion({
  from,
  to,
  seed,
  scale,
  bounds,
  reducedFlash = false,
  effects,
}) {
  const departureScale = from.scale ?? scale;
  const arrivalScale = to.scale ?? scale;
  const start = from.focus ?? { x: from.x, y: from.y - departureScale * 0.52 };
  const end = to.focus ?? { x: to.x, y: to.y - arrivalScale * 0.52 };
  const axis = lineBetween(start, end);
  const profile = {
    intensity: effectLevel(effects?.teleportIntensity, 0.75),
    jaggedness: effectLevel(effects?.teleportJaggedness, 0.78),
    branches: effectLevel(effects?.teleportBranches, 0.75),
    reducedFlash: reducedFlash || effects?.teleportReducedFlash === true,
    seed,
  };
  // Build up the bend, width and branches over two sprite widths of travel.
  const travelStrength = Math.min(1, axis.length / (2 * scale));
  const energy = 0.38 + profile.intensity * 0.88;
  const boltScale = scale * travelStrength * energy;
  const amplitude =
    Math.min(scale * 0.53, axis.length * 0.31) *
    travelStrength *
    (0.18 + profile.jaggedness * 1.13);
  const points = makeRoute(start, end, axis, amplitude, profile, bounds);
  return { departureScale, arrivalScale, start, end, axis, energy, boltScale, profile, points };
}

export function teleportViewport(
  motion,
  from,
  to,
  anchor,
  { width, height },
  arrivalAnchor = anchor,
) {
  const padding = 14 + 0.85 * Math.max(from.scale, to.scale);
  const x = motion.points.map(({ x }) => x),
    y = motion.points.map(({ y }) => y);
  for (const [point, support] of [
    [from, anchor],
    [to, arrivalAnchor],
  ]) {
    const rect = point.clip ?? {
      x: point.x - support.x * point.scale,
      y: point.y - support.y * point.scale,
      width: point.scale,
      height: point.scale,
    };
    x.push(rect.x, rect.x + rect.width);
    y.push(rect.y, rect.y + rect.height);
  }
  const left = Math.min(width - 1, Math.max(0, Math.floor(Math.min(...x) - padding)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(Math.min(...y) - padding)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(Math.max(...x) + padding)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(Math.max(...y) + padding)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function draw(
  context,
  {
    frame,
    from,
    to,
    seed,
    scale,
    bounds,
    anchor = { x: 0.5, y: 1166 / 1254 },
    arrivalAnchor = anchor,
    reducedFlash = false,
    materialize = true,
    effects,
    drawCapri,
    motion = prepareTeleportMotion({ from, to, seed, scale, bounds, reducedFlash, effects }),
  },
) {
  const time = Math.max(0, frame);
  const current = phase(time);
  if (current === 'idle') {
    if (materialize) drawCapri(to);
    return current;
  }
  const { departureScale, arrivalScale, start, end, axis, energy, boltScale, profile, points } =
    motion;

  if (current === 'departure') {
    const reveal = sample([1, 1, 1, 0.74, 0.37, 0], time);
    const strength = sample([0, 0.25, 0.37, 0.7, 0.87, 1, 0], time);
    const tint = sample([0, 0, 0.13, 0.57, 0.93, 1], time) * (profile.reducedFlash ? 0.5 : 1);
    drawReveal(context, from, start, departureScale, reveal, tint, drawCapri);
    drawBreak(
      context,
      start,
      axis,
      departureScale * energy,
      strength,
      0.49 - time * 0.045,
      profile,
    );
    if (time >= transitStart - 2)
      drawBolt(
        context,
        points,
        sample([0, 0.09, headPositions[0]], time - transitStart + 2),
        0,
        boltScale,
        profile,
      );
  } else if (current === 'transit') {
    const head = sample(headPositions, time - transitStart);
    const tail = Math.max(0, head - (profile.reducedFlash ? 0.44 : 0.61));
    drawBolt(context, points, head, tail, boltScale, profile);
  } else {
    const age = time - arrivalStart;
    retractBolt(context, points, boltScale, age, profile);
    if (materialize) assemble(context, to, arrivalScale, arrivalAnchor, age, profile, drawCapri);
    arrivalStrike(context, end, axis, Math.min(arrivalScale * energy, boltScale * 2), age, profile);
  }
  return current;
}

export { fps, frames, transitStart, arrivalStart, boltOnlyFrames, red as color, phase, draw };
