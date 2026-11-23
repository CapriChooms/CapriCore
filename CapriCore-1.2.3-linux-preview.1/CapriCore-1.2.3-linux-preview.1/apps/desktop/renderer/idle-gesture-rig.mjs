// SPDX-License-Identifier: GPL-3.0-only
// Independently authored pose rig. Original PNG pixels remain unchanged.
export const CHANNELS = Object.freeze({
  lean: 0,
  lift: 0,
  head: 0,
  headX: 0,
  headY: 0,
  headStretch: 1,
  headShear: 0,
  leftShoulder: 0,
  rightShoulder: 0,
  leftArm: 0,
  rightArm: 0,
  leftElbow: 0,
  rightElbow: 0,
  leftWrist: 0,
  rightWrist: 0,
  handSmear: 0,
  bodyX: 0,
  bodyY: 0,
  legSwing: 0,
  breath: 0,
  expression: 'neutral',
  pose: 'idle',
});
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rot = (x, y, px, py, deg) => {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c];
};
const standingFrames = new Set(
  'neutral annoyed attentive concerned embarrassed flirty focused happy sad skeptical sleepy smirk surprised thinking'.split(
    ' ',
  ),
);
export function resolvePose(input = 'idle') {
  const raw = typeof input === 'object' ? input.frameId || input.pose || input.id || 'idle' : input;
  let id = String(raw || 'idle')
    .split(/[?#]/)[0]
    .split('/')
    .pop()
    .replace(/\.png$/, '')
    .replace(/^capri-/, '');
  const aliases = {
    'pose-sit-floor': 'sit_floor',
    'sit-floor': 'sit_floor',
    'pose-crouch': 'crouch',
    'pose-sleep': 'sleep',
    'pose-sit-edge': 'seat',
    'sit-edge': 'seat',
    'pose-ceiling': 'ceiling_hands',
    ceiling: 'ceiling_hands',
    'pose-ceiling-upside-down': 'ceiling_feet',
    'ceiling-upside-down': 'ceiling_feet',
    'pose-dock-left': 'wall_left',
    'dock-left': 'wall_left',
    'pose-dock-right': 'wall_right',
    'dock-right': 'wall_right',
    'music-floor': 'music_ground',
    'music-window': 'music_seat',
    standing: 'idle',
  };
  if (id.startsWith('desktop-perch')) return 'legacy_seat';
  if (standingFrames.has(id) || id.startsWith('idle-')) return 'idle';
  return (
    aliases[id] ||
    ([
      'idle',
      'sit_floor',
      'crouch',
      'sleep',
      'seat',
      'ceiling_hands',
      'ceiling_feet',
      'wall_left',
      'wall_right',
      'music_ground',
      'music_seat',
      'legacy_seat',
    ].includes(id)
      ? id
      : 'unknown')
  );
}
// Each profile is measured against its real full-size pose drawing, never the standing proxy.
export const POSE_RIGS = Object.freeze({
  idle: { bounds: [210, 115, 835, 1052], neck: [620, 470], body: [625, 660], anchor: [627, 1166] },
  sit_floor: {
    bounds: [186, 255, 884, 911],
    neck: [604, 654],
    body: [600, 1030],
    anchor: [627, 1166],
    core: [625, 685],
    left: [535, 555, 675, 702],
    right: [700, 725, 732, 760],
    bodyRange: [880, 1095],
  },
  crouch: {
    bounds: [225, 333, 803, 834],
    neck: [625, 716],
    body: [620, 1000],
    anchor: [627, 1166],
    core: [687, 740],
    left: [545, 565, 720, 750],
    right: [724, 748, 824, 858],
    bodyRange: [880, 1090],
  },
  seat: {
    bounds: [183, 110, 887, 1067],
    neck: [624, 510],
    body: [600, 773],
    anchor: [599, 773],
    core: [482, 532],
    left: [540, 562, 510, 540],
    right: [745, 773, 640, 675],
    bodyRange: [640, 755],
    legPivot: [500, 800],
  },
  ceiling_hands: {
    bounds: [208, 75, 836, 1102],
    neck: [620, 470],
    body: [625, 660],
    anchor: [615, 111],
    core: [440, 492],
    left: [537, 560, 480, 510],
    right: [710, 736, 610, 638],
    bodyRange: [650, 900],
    grip: 'top',
  },
  ceiling_feet: {
    bounds: [201, 84, 851, 933],
    neck: [625, 655],
    body: [625, 450],
    anchor: [629, 94],
    inverted: true,
    grip: 'top',
  },
  wall_left: {
    bounds: [219, 76, 815, 1101],
    neck: [589, 451],
    body: [530, 620],
    anchor: [239, 555],
    core: [424, 471],
    left: [510, 535, 450, 480],
    right: [660, 690, 600, 640],
    bodyRange: [580, 1000],
    grip: 'left',
  },
  wall_right: {
    bounds: [212, 75, 831, 1103],
    neck: [606, 432],
    body: [700, 610],
    anchor: [994, 505],
    core: [399, 446],
    left: [497, 525, 445, 477],
    right: [720, 750, 520, 553],
    bodyRange: [580, 1000],
    grip: 'right',
  },
  sleep: {
    bounds: [76, 709, 1102, 457],
    neck: [430, 1090],
    body: [665, 1110],
    anchor: [627, 1166],
  },
  music_ground: {
    bounds: [207, 295, 840, 871],
    neck: [637, 711],
    body: [627, 1030],
    anchor: [627, 1166],
    core: [676, 727],
    left: [529, 550, 706, 738],
    right: [724, 750, 818, 857],
    bodyRange: [890, 1015],
  },
  music_seat: {
    bounds: [188, 75, 877, 1090],
    neck: [650, 474],
    body: [650, 762],
    anchor: [650, 762],
    core: [448, 495],
    left: [480, 505, 458, 485],
    right: [756, 779, 595, 630],
    bodyRange: [640, 752],
    legPivot: [455, 797],
  },
  legacy_seat: {
    bounds: [180, 190, 900, 980],
    neck: [649, 565],
    body: [645, 815],
    anchor: [645, 815],
    core: [535, 582],
    left: [550, 576, 560, 590],
    right: [740, 767, 650, 680],
    bodyRange: [700, 800],
    legPivot: [575, 820],
    unverified: true,
  },
});
const customScales = Object.freeze({
  headTilt: 6,
  headX: 36,
  headY: 22,
  lean: 3.5,
  lift: 10,
  leftArm: 60,
  rightArm: -60,
  leftElbow: 85,
  rightElbow: -85,
  leftWrist: 55,
  rightWrist: -55,
  leftShoulder: 18,
  rightShoulder: 18,
  bodyX: 16,
  bodyY: 8,
  legSwing: 6,
  breath: 1,
});
const upperCustom = new Set(['headTilt', 'headX', 'headY', 'lean', 'lift']);
function sampleCustomRaw(clip, timeMs, { pose = 'idle', frameId, unquantized = false } = {}) {
  const actual = resolvePose(frameId || pose),
    out = { ...CHANNELS, pose: actual };
  if (
    !clip ||
    !Array.isArray(clip.keyframes) ||
    clip.keyframes.length < 3 ||
    clip.keyframes.length > 12 ||
    !Number.isFinite(clip.durationMs)
  )
    return out;
  const duration = clamp(clip.durationMs, 400, 8000),
    fps = clip.fps === 12 ? 12 : 24,
    exposure = 1000 / fps,
    time = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, duration),
    t = unquantized ? time : Math.floor((time + 0.01) / exposure) * exposure;
  if (time <= 0 || time >= duration || actual === 'unknown' || actual === 'legacy_seat') return out;
  let a = clip.keyframes[0],
    b = clip.keyframes.at(-1);
  for (let i = 1; i < clip.keyframes.length; i++)
    if (clip.keyframes[i].at >= t) {
      a = clip.keyframes[i - 1];
      b = clip.keyframes[i];
      break;
    }
  const f = b.at === a.at ? 1 : clamp((t - a.at) / (b.at - a.at));
  for (const [name, scale] of Object.entries(customScales)) {
    const allowed =
      actual === 'sleep'
        ? name === 'breath'
        : actual === 'idle'
          ? !['bodyX', 'bodyY', 'legSwing', 'breath'].includes(name)
          : upperCustom.has(name) ||
            name === 'bodyX' ||
            name === 'bodyY' ||
            (name === 'legSwing' && ['seat', 'music_seat'].includes(actual));
    if (!allowed) continue;
    const read = (k) =>
        clamp(Number.isFinite(k[name]) ? k[name] : 0, name === 'breath' ? 0 : -1, 1),
      value = (read(a) + (read(b) - read(a)) * f) * scale;
    out[name === 'headTilt' ? 'head' : name] = value;
  }
  if (actual !== 'idle') {
    out.head *= 0.65;
    out.headX *= 0.65;
    out.headY *= 0.7;
    out.lean *= 0.55;
    out.lift *= 0.5;
  }
  out.handSmear =
    actual === 'idle' &&
    clip.keyframes
      .slice(1, -1)
      .some(
        (k) => k.smear === 1 && Math.round(t / exposure) === Math.ceil((k.at - 0.01) / exposure),
      )
      ? 1
      : 0;
  return out;
}
export function sampleCustomGesture(clip, timeMs, options = {}) {
  const rest = { ...CHANNELS, pose: resolvePose(options.frameId || options.pose || 'idle') };
  if (!clip || !Array.isArray(clip.keyframes) || !Number.isFinite(clip.durationMs)) return rest;
  const duration = clamp(clip.durationMs, 400, 8000),
    exposure = 1000 / (clip.fps === 12 ? 12 : 24),
    time = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, duration),
    t = Math.floor((time + 0.01) / exposure) * exposure;
  const reserved = clip.fps === 12 && duration < 500 ? 1 : 2,
    holdStart = Math.max(exposure, Math.floor(duration / exposure - reserved + 0.0001) * exposure);
  if (time >= holdStart) return rest;
  let lastMotion = -1;
  for (let i = 0; i < clip.keyframes.length; i++)
    if (
      Object.entries(clip.keyframes[i]).some(
        ([k, v]) => k !== 'at' && k !== 'smear' && Number.isFinite(v) && v !== 0,
      )
    )
      lastMotion = i;
  if (lastMotion < 0) return rest;
  const peakInput = clip.keyframes[lastMotion].at,
    recovery = Math.min(Math.max(250, 3 * exposure), holdStart * 0.45),
    peakOutput = clamp(
      Math.round(Math.min((peakInput / duration) * holdStart, holdStart - recovery) / exposure) *
        exposure,
      exposure,
      Math.max(exposure, holdStart - exposure),
    );
  const f = clamp((t - peakOutput) / Math.max(exposure, holdStart - peakOutput));
  const inputTime =
    t <= peakOutput
      ? (t / peakOutput) * peakInput
      : peakInput + (duration - peakInput) * f * f * (3 - 2 * f);
  const out = sampleCustomRaw(clip, inputTime, { ...options, unquantized: true });
  out.handSmear =
    out.pose === 'idle' &&
    clip.keyframes
      .slice(1, -1)
      .some(
        (k) =>
          k.smear === 1 &&
          k.at <= peakInput &&
          Math.round(t / exposure) ===
            Math.ceil(((k.at / peakInput) * peakOutput - 0.01) / exposure),
      )
      ? 1
      : 0;
  return out;
}
function armPoint(x, y, side, c) {
  const l = side === 'left',
    shoulder = l ? [576, 527] : [657, 527],
    elbow = l ? [545, 642] : [690, 642],
    wrist = l ? [509, 750] : [730, 763];
  const up = c[side + 'Arm'],
    fore = c[side + 'Elbow'],
    hand = c[side + 'Wrist'];
  let q = [x, y];
  const wh = smooth(wrist[1] - 12, wrist[1] + 20, y);
  if (wh) {
    let h = rot(x, y, ...wrist, hand);
    if (l && c.handSmear) {
      h[0] = wrist[0] + (h[0] - wrist[0]) * 1.7;
      h[1] = wrist[1] + (h[1] - wrist[1]) * 0.8;
    }
    q = [q[0] + (h[0] - q[0]) * wh, q[1] + (h[1] - q[1]) * wh];
  }
  const wf = smooth(elbow[1] - 25, elbow[1] + 23, y);
  if (wf) {
    const e = rot(...q, ...elbow, fore);
    q = [q[0] + (e[0] - q[0]) * wf, q[1] + (e[1] - q[1]) * wf];
  }
  q = rot(...q, ...shoulder, up);
  q[1] -= c[side + 'Shoulder'];
  return q;
}
function deformStanding(x, y, c) {
  // Head is a rigid plate through the face. Only the narrow neck blends into spine.
  const leftHair = (1 - smooth(548, 576, x)) * (1 - smooth(500, 525, y));
  const rightHair =
    smooth(700 + Math.max(0, y - 470) * 0.32, 724 + Math.max(0, y - 470) * 0.32, x) *
    (1 - smooth(626, 655, y));
  const headWeight = Math.max(1 - smooth(455, 496, y), leftHair, rightHair);
  let q = [x, y];
  // Limb influence boundaries sit in transparent gaps, preventing torso distortion.
  const boundary = [
    [530, 600],
    [570, 596],
    [600, 592],
    [660, 558],
    [700, 549],
    [740, 544],
    [760, 554],
    [780, 554],
    [800, 546],
    [840, 541],
  ];
  let leftEdge = 600;
  for (let i = 1; i < boundary.length; i++) {
    if (y <= boundary[i][0]) {
      const [a, b] = boundary[i - 1],
        [d, e] = boundary[i];
      leftEdge = b + (e - b) * clamp((y - a) / (d - a));
      break;
    }
    leftEdge = 541;
  }
  const leftMask =
    (1 - smooth(leftEdge - 3, leftEdge + 3, x)) * smooth(500, 548, y) * (1 - smooth(826, 850, y));
  const rightBoundary = [
    [540, 650],
    [580, 651],
    [600, 654],
    [640, 667],
    [680, 678],
    [720, 687],
    [740, 692],
    [760, 685],
    [780, 684],
    [800, 692],
    [830, 698],
  ];
  let rightEdge = 650;
  for (let i = 1; i < rightBoundary.length; i++) {
    if (y <= rightBoundary[i][0]) {
      const [a, b] = rightBoundary[i - 1],
        [d, e] = rightBoundary[i];
      rightEdge = b + (e - b) * clamp((y - a) / (d - a));
      break;
    }
    rightEdge = 698;
  }
  const rightMask =
    smooth(rightEdge - 3, rightEdge + 3, x) * smooth(500, 548, y) * (1 - smooth(826, 850, y));
  const armMix = 1 - headWeight;
  if (leftMask * armMix > 0.001) {
    const a = armPoint(x, y, 'left', c),
      w = leftMask * armMix;
    q = [q[0] + (a[0] - x) * w, q[1] + (a[1] - y) * w];
  }
  if (rightMask * armMix > 0.001) {
    const a = armPoint(x, y, 'right', c),
      w = rightMask * armMix;
    q = [q[0] + (a[0] - x) * w, q[1] + (a[1] - y) * w];
  }
  // Gentle torso rotation tapers out before the knees; both feet stay exact.
  const bw = 1 - smooth(650, 900, y),
    body = rot(...q, 625, 660, c.lean * bw);
  q = [body[0], body[1] + c.lift * bw];
  if (headWeight > 0.001) {
    let hx = 620 + (x - 620) * c.headStretch + (470 - y) * c.headShear,
      hy = y;
    [hx, hy] = rot(hx, hy, 620, 470, c.head);
    [hx, hy] = rot(hx + c.headX, hy + c.headY + c.lift, 625, 660, c.lean);
    q = [q[0] + (hx - q[0]) * headWeight, q[1] + (hy - q[1]) * headWeight];
  }
  return q;
}

function headWeight(x, y, r) {
  if (r.inverted) return smooth(645, 698, y);
  const [a, b] = r.core,
    core = 1 - smooth(a, b, y),
    l = r.left,
    rr = r.right;
  let w = Math.max(
    core,
    (1 - smooth(l[0], l[1], x)) * (1 - smooth(l[2], l[3], y)),
    smooth(rr[0] + Math.max(0, y - a) * 0.25, rr[1] + Math.max(0, y - a) * 0.25, x) *
      (1 - smooth(rr[2], rr[3], y)),
  );
  if (r.grip === 'top') w *= smooth(160, 275, y);
  if (r.grip === 'left') w *= smooth(275, 330, x);
  if (r.grip === 'right') w *= 1 - smooth(955, 990, x);
  return w;
}
export function deformPoint(x, y, channels) {
  const c = channels,
    pose = resolvePose(c.pose),
    r = POSE_RIGS[pose];
  if (!r || r.unverified) return [x, y];
  if (pose === 'idle') return deformStanding(x, y, c);
  if (pose === 'sleep') return [x, y - c.breath * 8 * (1 - smooth(900, 1158, y))];
  const hw = headWeight(x, y, r);
  let q = [x, y];
  let bodyWeight = r.inverted ? smooth(145, 450, y) : 1 - smooth(...r.bodyRange, y);
  if (pose === 'sit_floor' || pose === 'crouch' || pose === 'music_ground')
    bodyWeight *= smooth(475, 550, x) * (1 - smooth(700, 770, x));
  if (r.grip === 'left') bodyWeight *= smooth(280, 530, x);
  if (r.grip === 'right') bodyWeight *= 1 - smooth(735, 960, x);
  if (r.grip === 'top') bodyWeight *= smooth(160, 330, y);
  const body = rot(x, y, ...r.body, c.lean * bodyWeight);
  q = [body[0] + c.bodyX * bodyWeight, body[1] + (c.lift + c.bodyY) * bodyWeight];
  if (hw) {
    let h = rot(x, y, ...r.neck, c.head);
    h = rot(h[0] + c.headX, h[1] + c.headY + c.lift + c.bodyY, ...r.body, c.lean);
    h[0] += c.bodyX * (r.grip === 'top' ? smooth(160, 330, y) : 1);
    q = [q[0] + (h[0] - q[0]) * hw, q[1] + (h[1] - q[1]) * hw];
  }
  if (r.legPivot && c.legSwing) {
    const lw = smooth(r.legPivot[1] - 8, r.legPivot[1] + 75, y) * (1 - smooth(650, 710, x)),
      leg = rot(x, y, ...r.legPivot, c.legSwing);
    q = [q[0] + (leg[0] - x) * lw, q[1] + (leg[1] - y) * lw];
  }
  return q;
}
const extentPointCache = new Map();
function extentPoints(pose) {
  if (extentPointCache.has(pose)) return extentPointCache.get(pose);
  const r = POSE_RIGS[pose] || POSE_RIGS.idle,
    [x, y, w, h] = r.bounds,
    out = [];
  // Dense conservative coverage of the complete registered visible rectangle.
  for (let yy = y; yy <= y + h; yy += 24)
    for (let xx = x; xx <= x + w; xx += 24) out.push([xx, yy]);
  for (let xx = x; xx <= x + w; xx += 12) {
    out.push([xx, y], [xx, y + h]);
  }
  for (let yy = y; yy <= y + h; yy += 12) out.push([x, yy], [x + w, yy]);
  out.push([x + w, y + h]);
  extentPointCache.set(pose, out);
  return out;
}
export function motionExtent(channels, { points } = {}) {
  const c = { ...CHANNELS, ...channels },
    pose = resolvePose(c.pose);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points || extentPoints(pose)) {
    const [x, y] = deformPoint(...p, c);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, right: maxX, bottom: maxY };
}
export function fitChannelsToCanvas(channels, { padding = 3, bounds, points } = {}) {
  const c = { ...CHANNELS, ...channels },
    rest = { ...CHANNELS, pose: c.pose },
    r = motionExtent(rest, { points }),
    valid =
      bounds &&
      ['left', 'top', 'right', 'bottom'].every((k) => Number.isFinite(bounds[k])) &&
      bounds.right > bounds.left &&
      bounds.bottom > bounds.top;
  // A zoomed/docked rest image may already intersect the viewport edge. Keep its
  // existing rest extent, and prevent only additional outward movement.
  const limit = {
    left: Math.max(padding, valid ? Math.min(bounds.left, r.x) : padding),
    top: Math.max(padding, valid ? Math.min(bounds.top, r.y) : padding),
    right: Math.min(1254 - padding, valid ? Math.max(bounds.right, r.right) : 1254 - padding),
    bottom: Math.min(1254 - padding, valid ? Math.max(bounds.bottom, r.bottom) : 1254 - padding),
  };
  const fits = (e) =>
    e.x >= limit.left - 1e-6 &&
    e.y >= limit.top - 1e-6 &&
    e.right <= limit.right + 1e-6 &&
    e.bottom <= limit.bottom + 1e-6;
  if (fits(motionExtent(c, { points }))) return c;
  // When only the crown is constrained, retain a safe hand/leg action and soften
  // the head/body component first instead of suppressing the entire gesture.
  const crownKeys = [
      'head',
      'headX',
      'headY',
      'headStretch',
      'headShear',
      'lean',
      'lift',
      'bodyX',
      'bodyY',
    ],
    withoutCrown = { ...c };
  for (const k of crownKeys) withoutCrown[k] = CHANNELS[k];
  if (fits(motionExtent(withoutCrown, { points }))) {
    let lo = 0,
      hi = 1,
      best = withoutCrown;
    for (let i = 0; i < 10; i++) {
      const strength = (lo + hi) / 2,
        test = { ...c };
      for (const k of crownKeys) test[k] = CHANNELS[k] + (c[k] - CHANNELS[k]) * strength;
      if (fits(motionExtent(test, { points }))) {
        lo = strength;
        best = test;
      } else hi = strength;
    }
    return best;
  }
  let lo = 0,
    hi = 1,
    best = rest;
  for (let i = 0; i < 10; i++) {
    const strength = (lo + hi) / 2,
      test = { ...c };
    for (const k of Object.keys(CHANNELS))
      if (typeof CHANNELS[k] === 'number') test[k] = CHANNELS[k] + (c[k] - CHANNELS[k]) * strength;
    if (fits(motionExtent(test, { points }))) {
      lo = strength;
      best = test;
    } else hi = strength;
  }
  return best;
}
export function imageSupportPoints(image) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1254;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 1254, 1254);
    const data = context.getImageData(0, 0, 1254, 1254).data,
      top = new Int32Array(1254).fill(-1),
      bottom = new Int32Array(1254).fill(-1),
      points = [];
    let firstRow = -1,
      lastRow = -1,
      minX = 1254,
      maxX = -1,
      minPoint = null,
      maxPoint = null;
    for (let y = 0; y < 1254; y++) {
      let first = -1,
        last = -1;
      for (let x = 0; x < 1254; x++)
        if (data[(y * 1254 + x) * 4 + 3] > 2) {
          if (first < 0) first = x;
          last = x;
          if (top[x] < 0) top[x] = y;
          bottom[x] = y;
          if (x < minX) {
            minX = x;
            minPoint = [x, y];
          }
          if (x > maxX) {
            maxX = x;
            maxPoint = [x, y];
          }
        }
      if (first >= 0) {
        if (firstRow < 0) {
          firstRow = y;
          points.push([first, y], [last, y]);
        }
        lastRow = y;
        if (y % 4 === 0) points.push([first, y], [last, y]);
      }
    }
    for (let x = 0; x < 1254; x++)
      if (top[x] >= 0 && (x % 4 === 0 || x === minX || x === maxX || bottom[x] === lastRow))
        points.push([x, top[x]], [x, bottom[x]]);
    if (minPoint) points.push(minPoint, maxPoint);
    return points.length ? points : null;
  } catch {
    return null;
  }
}
export function createRenderer(canvas, images = {}, { grid = 180 } = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw Error('Surface pose rendering requires WebGL.');
  // Transparent warped cells must never erase opaque hair already beneath them.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      'attribute vec2 a_position;attribute vec2 a_uv;varying vec2 v_uv;void main(){gl_Position=vec4(a_position.x/627.0-1.0,1.0-a_position.y/627.0,0.,1.);v_uv=a_uv;}',
    ),
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      'precision mediump float;varying vec2 v_uv;uniform sampler2D u_image;void main(){vec4 color=texture2D(u_image,v_uv);gl_FragColor=vec4(color.rgb*color.a,color.a);}',
    ),
  );
  gl.linkProgram(program);
  gl.useProgram(program);
  const points = [],
    uv = [],
    indices = [];
  for (let y = 0; y <= grid; y++)
    for (let x = 0; x <= grid; x++) {
      points.push((x / grid) * 1254, (y / grid) * 1254);
      uv.push(x / grid, y / grid);
    }
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++) {
      let a = y * (grid + 1) + x;
      indices.push(a, a + 1, a + grid + 1, a + 1, a + grid + 2, a + grid + 1);
    }
  const bindAttrib = (name, data, usage) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const a = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    return b;
  };
  const positions = new Float32Array(points),
    positionBuffer = bindAttrib('a_position', positions, gl.DYNAMIC_DRAW),
    uvBuffer = bindAttrib('a_uv', new Float32Array(uv), gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  const cache = new WeakMap(),
    allTextures = [],
    textureSupport = new Map();
  const textureFor = (img) => {
    const key = img.currentSrc || img.src || null,
      old = cache.get(img);
    if (old && key && old.key === key) return old.tex;
    const tex = old?.tex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (!old) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      allTextures.push(tex);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    textureSupport.set(tex, imageSupportPoints(img));
    cache.set(img, { tex, key });
    return tex;
  };
  const textures = {};
  for (const [key, img] of Object.entries(images)) textures[key] = textureFor(img);
  let disposed = false,
    lastKey = null,
    lastTexture = null,
    lastExtent = null,
    lastChannels = null;
  function paint(channels, texture, force = false, bounds = null) {
    if (disposed) return;
    let c = { ...CHANNELS, ...channels };
    const key =
      canvas.width + ':' + canvas.height + ':' + JSON.stringify(c) + ':' + JSON.stringify(bounds);
    if (!force && key === lastKey && texture === lastTexture) return;
    lastKey = key;
    lastTexture = texture;
    const support = textureSupport.get(texture);
    c = fitChannelsToCanvas(c, { bounds, points: support });
    lastChannels = c;
    lastExtent = motionExtent(c, { points: support });
    canvas.avatarMotionExtent = lastExtent;
    for (let i = 0; i < points.length; i += 2) {
      const q = deformPoint(points[i], points[i + 1], c);
      positions[i] = q[0];
      positions[i + 1] = q[1];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  }
  return {
    get extent() {
      return lastExtent;
    },
    get channels() {
      return lastChannels;
    },
    render(channels = {}) {
      paint(channels, textures[channels.expression] || textures.neutral);
    },
    draw(image, channels, { bounds } = {}) {
      if (!disposed) paint(channels, textureFor(image), !(image.currentSrc || image.src), bounds);
    },
    clear() {
      lastKey = null;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    dispose() {
      disposed = true;
      for (const t of allTextures) gl.deleteTexture(t);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(uvBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
    },
  };
}
