// SPDX-License-Identifier: GPL-3.0-only
// Stable drawings on an anime exposure sheet; only the ink effects run at display refresh rate.
const boundaries = Object.freeze([0, 167, 375, 667, 1083, 1833, 2417, 3000]);
const phases = Object.freeze(['signal', 'gaze', 'arrival', 'landing', 'greeting', 'wink', 'ready']);
const red = '#ff003d';
const paleRed = '#ff3765';
const darkRed = '#9d0739';
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const easeOut = (value) => 1 - (1 - value) ** 3;

function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Pose motion is rigid and exposed at 24 fps. There is no interpolation of body parts. */
export function startupIntroSample(elapsedMs, durationMs = 3000) {
  const duration = Math.max(1, finite(durationMs, 3000));
  const elapsed = elapsedMs === Infinity ? duration : finite(elapsedMs, 0);
  const time = clamp(elapsed / duration) * 3000;
  let index = 0;
  while (index < 6 && time >= boundaries[index + 1]) index++;
  const age = time - boundaries[index];
  const span = boundaries[index + 1] - boundaries[index];
  const progress = clamp(age / span);
  const exposedAge = Math.floor(age / (1000 / 24)) * (1000 / 24);
  const exposedProgress = clamp(exposedAge / span);
  let poseY = 0;
  if (index === 2) poseY = -0.027 * (1 - exposedProgress) ** 2;
  if (index === 3 && exposedAge < 209) {
    const bounce = [0, -0.003, -0.006, -0.003, 0];
    poseY = bounce[Math.min(4, Math.floor(exposedAge / (1000 / 24)))];
  }
  let cut = 0;
  for (const at of boundaries.slice(1, -1))
    cut = Math.max(cut, clamp(1 - Math.abs(time - at) / 38));
  return {
    index,
    phase: phases[index],
    time,
    progress,
    exposure: Math.min(71, Math.floor((time * 24) / 1000)),
    poseX: 0,
    poseY,
    cut,
    effects: time < 2860,
    finished: elapsed >= duration,
  };
}

function polygon(ctx, points, color) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function ribbon(ctx, points, width, color) {
  if (points.length < 2 || width <= 0) return;
  const left = [],
    right = [];
  for (let index = 0; index < points.length; index++) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x,
      dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const radius =
      width * (index === 0 || index === points.length - 1 ? 0.09 : index % 2 ? 0.7 : 0.48);
    left.push({
      x: points[index].x - (dy / length) * radius,
      y: points[index].y + (dx / length) * radius,
    });
    right.push({
      x: points[index].x + (dy / length) * radius * 0.71,
      y: points[index].y - (dx / length) * radius * 0.71,
    });
  }
  polygon(ctx, left.concat(right.reverse()), color);
}

// Reveal and remove a length of a fixed path. Its topology does not randomize between frames.
function pathSegment(points, from, to) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths.at(-1) + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  const total = lengths.at(-1);
  const start = clamp(from) * total,
    end = clamp(to) * total;
  const result = [];
  for (let i = 1; i < points.length; i++) {
    const low = lengths[i - 1],
      high = lengths[i];
    if (high < start || low > end || high === low) continue;
    const mix = (distance) => {
      const fraction = clamp((distance - low) / (high - low));
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * fraction,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * fraction,
      };
    };
    if (!result.length) result.push(mix(start));
    result.push(mix(Math.min(end, high)));
  }
  return result;
}

function sparkBurst(ctx, project, { age, length, seed, count, origin, spread, upward = false }) {
  if (age < 0 || age >= length) return 0;
  const random = randomSource(seed);
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const delay = random() * length * 0.12;
    const lifetime = length * (0.68 + random() * 0.2);
    const life = (age - delay) / lifetime;
    const side = random() < 0.5 ? -1 : 1;
    const reach = spread * (0.36 + random() * 0.64);
    const lift = (upward ? -1 : side) * spread * (0.08 + random() * 0.4);
    const startX = origin.x + (random() - 0.5) * 0.06;
    const startY = origin.y + (random() - 0.5) * 0.04;
    const size = 0.003 + random() * 0.006;
    if (life < 0 || life >= 1) continue;
    const distance = easeOut(life);
    const x = startX + side * reach * distance;
    const y = startY + lift * distance + (upward ? 0.1 : 0.018) * life * life;
    const taper = (1 - life) ** 1.2;
    const tail = size * (1.4 + distance) * taper;
    polygon(
      ctx,
      [
        project(x + side * tail * 1.8, y + tail * 0.3),
        project(x - side * tail, y - tail * 0.6),
        project(x - side * tail * 0.65, y + tail * 0.7),
      ],
      i % 3 ? red : paleRed,
    );
    drawn++;
  }
  return drawn;
}

function fitRect(width, height, rect) {
  const box = rect ?? { x: 0, y: 0, width, height };
  const boxWidth = Math.max(0, finite(box.width, width));
  const boxHeight = Math.max(0, finite(box.height, height));
  const size = Math.min(boxWidth, boxHeight);
  return {
    x: finite(box.x, 0) + (boxWidth - size) / 2,
    y: finite(box.y, 0) + (boxHeight - size) / 2,
    width: size,
    height: size,
  };
}

/** Draw one approved pose and restrained procedural red ink on a transparent CSS-pixel canvas. */
export function drawStartupIntro(
  ctx,
  { time = 0, width, height, images = [], rect, seed = 1, durationMs = 3000 } = {},
) {
  const sample = startupIntroSample(time, durationMs);
  const viewportWidth = Math.max(0, finite(width, 0));
  const viewportHeight = Math.max(0, finite(height, 0));
  if (!ctx || !viewportWidth || !viewportHeight) return { ...sample, sparkCount: 0 };
  const box = fitRect(viewportWidth, viewportHeight, rect);
  const project = (x, y) => ({ x: box.x + x * box.width, y: box.y + y * box.height });
  let sparkCount = 0;
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, viewportWidth, viewportHeight);
  ctx.clip();
  const t = sample.time;
  const signal = [
    [0.16, 0.4],
    [0.35, 0.3],
    [0.29, 0.46],
    [0.6, 0.36],
    [0.53, 0.51],
    [0.86, 0.33],
  ].map(([x, y]) => project(x, y));
  if (t < 590) {
    const head = easeOut(clamp(t / 145));
    const tail = easeOut(clamp((t - 220) / 370));
    ribbon(ctx, pathSegment(signal, tail, head), box.width * 0.018 * (1 - tail * 0.45), darkRed);
    ribbon(ctx, pathSegment(signal, tail, head), box.width * 0.011, red);
  }
  const image = images[sample.index];
  if (image && box.width > 0) {
    ctx.save();
    if (sample.index === 0) {
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width * easeOut(clamp(t / 115)), box.height);
      ctx.clip();
    }
    ctx.drawImage(
      image,
      box.x + box.width * sample.poseX,
      box.y + box.height * sample.poseY,
      box.width,
      box.height,
    );
    ctx.restore();
  }
  if (sample.effects) {
    sparkCount += sparkBurst(ctx, project, {
      age: t,
      length: 430,
      seed: seed ^ 0x181,
      count: 6,
      origin: { x: 0.51, y: 0.4 },
      spread: 0.25,
    });
    sparkCount += sparkBurst(ctx, project, {
      age: t - 330,
      length: 470,
      seed: seed ^ 0x237,
      count: 8,
      origin: { x: 0.51, y: 0.52 },
      spread: 0.26,
    });
    sparkCount += sparkBurst(ctx, project, {
      age: t - 667,
      length: 490,
      seed: seed ^ 0x349,
      count: 12,
      origin: { x: 627 / 1254, y: 1166 / 1254 },
      spread: 0.34,
      upward: true,
    });
    sparkCount += sparkBurst(ctx, project, {
      age: t - 1083,
      length: 365,
      seed: seed ^ 0x453,
      count: 5,
      origin: { x: 0.57, y: 0.43 },
      spread: 0.22,
    });
    sparkCount += sparkBurst(ctx, project, {
      age: t - 1833,
      length: 320,
      seed: seed ^ 0x569,
      count: 3,
      origin: { x: 0.61, y: 0.27 },
      spread: 0.09,
    });
    sparkCount += sparkBurst(ctx, project, {
      age: t - 2417,
      length: 410,
      seed: seed ^ 0x671,
      count: 4,
      origin: { x: 0.62, y: 0.58 },
      spread: 0.13,
    });
    // The impact travels outwards and breaks into shrinking ink shards, rather than fading a halo.
    if (t >= 667 && t < 1067) {
      const progress = clamp((t - 667) / 400);
      for (const side of [-1, 1]) {
        const trail = [
          [0.5, 0.93],
          [0.5 + side * 0.1, 0.915],
          [0.5 + side * 0.16, 0.939],
          [0.5 + side * 0.32, 0.918],
        ].map(([x, y]) => project(x, y));
        ribbon(
          ctx,
          pathSegment(trail, Math.max(0, progress * 1.4 - 0.45), easeOut(progress)),
          box.width * 0.012 * (1 - progress),
          red,
        );
      }
    }
    if (sample.cut > 0) {
      const slash = [
        [0.18, 0.19],
        [0.59, 0.36],
        [0.43, 0.51],
        [0.77, 0.69],
      ].map(([x, y]) => project(x, y));
      ribbon(ctx, slash, box.width * 0.052 * sample.cut, red);
      const filament = [
        [0.12, 0.23],
        [0.41, 0.18],
        [0.34, 0.29],
        [0.75, 0.2],
      ].map(([x, y]) => project(x, y));
      ribbon(ctx, filament, box.width * 0.004 * sample.cut, paleRed);
    }
  }
  ctx.restore();
  return { ...sample, rect: box, sparkCount };
}
