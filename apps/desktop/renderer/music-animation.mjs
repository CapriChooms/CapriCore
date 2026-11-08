// SPDX-License-Identifier: GPL-3.0-only
// Music moves rigid, held drawings on twos. Floating notes use their own smooth
// display clock; speech mouth plates remain entirely independent of this layer.
export const MUSIC_POSES = Object.freeze({
  'music-window': Object.freeze({
    anchor: [628, 771],
    emitters: [
      [533, 402],
      [764, 365],
    ],
  }),
  'music-floor': Object.freeze({
    anchor: [641, 1164],
    emitters: [
      [522, 642],
      [775, 591],
    ],
  }),
});
export const MUSIC_NOTE_ASSETS = Object.freeze(
  ['01-eighth-cyan', '02-beamed-lime', '03-quarter-pink', '04-sixteenth-violet'].map((name) =>
    Object.freeze({ url: `capri://desktop/music/${name}.png` }),
  ),
);
const extent = 1254;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const noise = (n, seed) => {
  const v = Math.sin((n + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const cubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};
const turn = (beats) => ((beats % 1) + 1) % 1;
const nearestBeat = (beats) => turn(beats + 0.5) - 0.5;
const holdMs = 1000 / 12;
const tempoSmoothingMs = 600;

function advanceTempo(bpm, target, milliseconds) {
  const decay = Math.exp(-milliseconds / tempoSmoothingMs);
  return {
    bpm: target + (bpm - target) * decay,
    beats: (target * milliseconds + (bpm - target) * tempoSmoothingMs * (1 - decay)) / 60000,
  };
}

// Integrate a bounded correction exactly, including the transition from a
// constant correction speed to exponential convergence near the beat.
function correctPhase(error, milliseconds, confidence) {
  const seconds = milliseconds / 1000;
  const speed = 0.18 * confidence;
  if (!speed || !seconds || !error) return 0;
  const tau = 0.9;
  const threshold = speed * tau;
  const magnitude = Math.abs(error);
  const linear = Math.max(0, (magnitude - threshold) / speed);
  const remaining =
    seconds <= linear
      ? magnitude - speed * seconds
      : Math.min(magnitude, threshold) * Math.exp(-(seconds - linear) / tau);
  return Math.sign(error) * (magnitude - remaining);
}

function positionAt(clock, milliseconds) {
  return (
    clock.beats +
    advanceTempo(clock.bpm, clock.target, milliseconds).beats +
    correctPhase(clock.correction, milliseconds, clock.confidence)
  );
}

function beatDelay(clock, beat, milliseconds) {
  let low = 0,
    high = milliseconds;
  for (let iteration = 0; iteration < 20; iteration++) {
    const middle = (low + high) / 2;
    if (positionAt(clock, middle) < beat) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** A bounded visual envelope. It never detects music or makes audio/network calls. */
export class MusicAnimation {
  constructor() {
    this.reset();
  }
  reset() {
    this.startedAt = null;
    this.lastAt = null;
    this.amount = 0;
    this.bodyStep = '';
    this.bodyAngle = 0;
    this.rhythmAmount = 0;
    this.clockStarted = false;
    this.beats = 0;
    this.bpm = 0;
    this.targetBpm = 0;
    this.correction = 0;
    this.anchorConfidence = 0;
    this.anchorKey = '';
    this.nextBeat = 1;
    this.noteBirths = [];
    this.noteIndex = 0;
    this.reduced = false;
  }
  sample(
    now,
    {
      active = false,
      strength = 0.5,
      autoBpm = true,
      tempo,
      tempoConfidence = 1,
      beatAt = 0,
      wallTime = Date.now(),
      reduced = false,
      frameId = 'music-floor',
    } = {},
  ) {
    if (!Number.isFinite(now) || !Object.hasOwn(MUSIC_POSES, frameId))
      return { active: false, amount: 0, angle: 0, dy: 0, notes: [], frameId, frame: 0 };
    if (this.lastAt !== null && (now < this.lastAt || now - this.lastAt > 5000)) this.reset();
    if (this.reduced !== reduced) {
      this.reset();
      this.reduced = reduced;
    }
    const dt = this.lastAt === null ? 0 : now - this.lastAt;
    this.lastAt = now;
    if (active && this.startedAt === null) this.startedAt = now;
    const target = active ? 1 : 0;
    this.amount +=
      (target - this.amount) * (1 - Math.exp(-Math.min(250, dt) / (active ? 180 : 210)));
    if (this.amount < 0.003 && !active) {
      this.reset();
      return { active: false, amount: 0, angle: 0, dy: 0, notes: [], frameId, frame: 0 };
    }
    const strengthValue = Number.isFinite(strength) ? clamp(strength) : 0.5;
    const legacy = autoBpm === false || tempo === undefined;
    const confidence = Number.isFinite(tempoConfidence) ? clamp(tempoConfidence) : 0;
    const measured =
      !legacy && Number.isFinite(tempo) && tempo >= 40 && tempo <= 240 && confidence > 0;
    const rhythmic = !reduced && active && (legacy || measured);
    const bpm = legacy ? 110 : measured ? tempo : 0;
    const freshAnchor =
      measured &&
      Number.isFinite(wallTime) &&
      Number.isFinite(beatAt) &&
      beatAt > 0 &&
      wallTime - beatAt >= -100 &&
      wallTime - beatAt <= 5000;
    const anchorPhase = freshAnchor ? turn(((wallTime - beatAt) * bpm) / 60000) : 0;
    const rhythmTarget = rhythmic ? (legacy ? 1 : confidence) : 0;
    this.rhythmAmount += (rhythmTarget - this.rhythmAmount) * (1 - Math.exp(-dt / 260));
    const previous = {
      started: this.clockStarted,
      beats: this.beats,
      bpm: this.bpm,
      target: this.targetBpm,
      correction: this.correction,
      confidence: this.anchorConfidence,
    };
    if (!reduced && this.clockStarted) {
      const step = advanceTempo(this.bpm, this.targetBpm, dt);
      const correction = correctPhase(this.correction, dt, this.anchorConfidence);
      this.beats += step.beats + correction;
      this.bpm = step.bpm;
      this.correction -= correction;
    }
    if (rhythmic) {
      if (!this.clockStarted) {
        this.clockStarted = true;
        this.beats = freshAnchor ? anchorPhase : 0;
        this.bpm = bpm;
        this.nextBeat = Math.floor(this.beats) + 1;
      }
      this.targetBpm = bpm;
      const anchorKey = freshAnchor ? `${beatAt}:${bpm}` : '';
      if (anchorKey && anchorKey !== this.anchorKey) {
        this.correction = nearestBeat(anchorPhase - this.beats);
      }
      if (freshAnchor) this.anchorConfidence = confidence;
      this.anchorKey = anchorKey;
    } else if (this.rhythmAmount < 0.003) {
      this.clockStarted = false;
      this.correction = 0;
      this.anchorKey = '';
    }
    if (!freshAnchor) this.correction = 0;
    const age = Math.max(0, now - (this.startedAt ?? now));
    if (rhythmic && previous.started && this.beats > previous.beats) {
      while (this.nextBeat <= this.beats) {
        const at = now - dt + beatDelay(previous, this.nextBeat, dt);
        this.noteBirths = this.noteBirths.filter((birth) => at - birth.at < 3150);
        if (now - at < 3150 && this.noteBirths.length < 7)
          this.noteBirths.push({ index: this.noteIndex++, at });
        this.nextBeat++;
      }
    } else if (!rhythmic) this.nextBeat = Math.floor(this.beats) + 1;
    this.noteBirths = this.noteBirths.filter((birth) => now - birth.at < 3150);
    if (reduced) this.noteBirths = [];
    const holdTime = !legacy && Number.isFinite(wallTime) ? wallTime : age;
    const held = Math.floor(holdTime / holdMs);
    const overshoot = holdTime - held * holdMs;
    const stepKey = `${frameId}:${held}:${reduced}`;
    if (stepKey !== this.bodyStep) {
      this.bodyStep = stepKey;
      let heldBeats = this.beats;
      if (previous.started && overshoot <= dt) {
        const heldDt = dt - overshoot;
        heldBeats = positionAt(previous, heldDt);
      }
      const phase = heldBeats * 2 * Math.PI;
      const sway = legacy
        ? Math.sin(phase) * 0.85 + Math.sin(phase / 2) * 0.22
        : Math.sin(phase) * 0.85 + Math.sin(phase * 2) * 0.12;
      const calm = Math.sin((Math.max(0, age - overshoot) * 2 * Math.PI) / 8000) * 0.1;
      this.bodyAngle = reduced
        ? 0
        : this.amount *
          ((1 - this.rhythmAmount) * calm + this.rhythmAmount * sway * (0.5 + strengthValue * 0.5));
    }
    const angle = this.bodyAngle;
    const notes =
      reduced || this.startedAt === null
        ? []
        : musicNoteParticles(age / 1000, frameId, {
            amount: this.amount,
            strength: strengthValue,
            births: this.noteBirths.map(({ index, at }) => ({
              index,
              at: (at - this.startedAt) / 1000,
            })),
          });
    return {
      active: active || this.amount > 0.003,
      listening: active,
      amount: this.amount,
      frameId,
      frame: held,
      tempo: bpm,
      beatLocked: Boolean(rhythmic && freshAnchor),
      beatPhase: rhythmic ? turn(this.beats) : null,
      angle,
      dy: 0,
      notes,
    };
  }
}

/** Deterministic particles in the shared 1254px character canvas. At most seven. */
export function musicNoteParticles(
  time,
  frameId,
  { amount = 1, strength = 0.5, birthsUntil = time, births } = {},
) {
  const pose = MUSIC_POSES[frameId];
  if (!pose || !Number.isFinite(time) || time < 0 || !Number.isFinite(amount) || amount <= 0)
    return [];
  const interval = 0.48,
    last = Math.floor(Math.min(time, birthsUntil) / interval),
    first = Math.max(0, Math.floor((time - 3.15) / interval));
  const output = [];
  const emissions =
    births ??
    Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => ({
      index: first + index,
      at: (first + index) * interval,
    }));
  for (const { index: n, at } of emissions) {
    const life = 2.5 + noise(n, 1) * 0.65,
      age = time - at,
      progress = age / life;
    if (progress <= 0 || progress >= 1) continue;
    const side = n % 2,
      direction = side ? 1 : -1,
      [x, y] = pose.emitters[side];
    const dx = direction * (270 + 60 * noise(n, 2)),
      dy = -(185 + 65 * noise(n, 3));
    const rise = cubic(0, -14, dy * 0.52, dy, progress);
    output.push({
      index: n,
      spriteIndex: (Math.floor(n / 2) + side) % 4,
      side: side ? 'right' : 'left',
      x: cubic(x, x + direction * 74, x + dx * 0.85, x + dx, progress),
      y: y + rise,
      size:
        (92 + 28 * noise(n, 4)) *
        (0.62 + 0.38 * smooth(0, 0.22, progress)) *
        (0.88 + clamp(strength) * 0.12),
      alpha: smooth(0, 0.16, progress) * (1 - smooth(0.68, 1, progress)) * clamp(amount),
      rotation:
        (direction * ((noise(n, 5) - 0.5) * 8 + Math.sin(progress * Math.PI) * 14) * Math.PI) / 180,
      progress,
    });
  }
  return output;
}

export function drawMusicNotes(
  ctx,
  notes,
  images,
  { x = 0, y = 0, width = extent, height = width, alpha = 1 } = {},
) {
  if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / extent, height / extent);
  for (const note of notes) {
    const image = images[note.spriteIndex];
    if (!image || !image.complete || !image.naturalWidth) continue;
    ctx.save();
    ctx.globalAlpha *= clamp(note.alpha * alpha);
    ctx.translate(note.x, note.y);
    ctx.rotate(note.rotation);
    ctx.drawImage(image, -note.size / 2, -note.size / 2, note.size, note.size);
    ctx.restore();
  }
  ctx.restore();
}

/** Body-only texture at 12FPS. Notes must not force a 1254px GL upload at 60FPS. */
export class MusicPoseLayer {
  image(source, state) {
    const pose = MUSIC_POSES[state?.frameId];
    if (!pose || !state?.active || !state.angle) return source;
    const identity = [source, source.avatarTextureRevision, state.frame, state.angle, state.dy];
    if (this.source?.every((value, i) => value === identity[i])) return this.canvas;
    this.canvas ??= document.createElement('canvas');
    const canvas = this.canvas;
    if (canvas.width !== extent) canvas.width = canvas.height = extent;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.resetTransform();
    ctx.clearRect(0, 0, extent, extent);
    ctx.save();
    const [x, y] = pose.anchor;
    ctx.translate(x, y + (state.dy ?? 0));
    ctx.rotate((state.angle * Math.PI) / 180);
    ctx.translate(-x, -y);
    ctx.drawImage(source, 0, 0, extent, extent);
    ctx.restore();
    canvas.avatarTextureRevision = (canvas.avatarTextureRevision ?? 0) + 1;
    this.source = identity;
    return canvas;
  }
  clear() {
    this.source = null;
    this.canvas = null;
  }
}

/** Small, clipped display-paced notes canvas, reusable in framed and desktop modes. */
export class MusicNotesLayer {
  constructor(host, notes) {
    this.host = host;
    this.images = notes.map(({ url }) => {
      const image = new Image();
      image.src = url;
      return image;
    });
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    this.canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:14;';
    host.append(this.canvas);
  }
  update(state, { rect, clip = rect, origin = this.host.getBoundingClientRect() } = {}) {
    if (!state?.notes?.length || !rect || !clip || !origin) {
      this.clear();
      return;
    }
    const x = Math.max(rect.x, clip.x),
      y = Math.max(rect.y, clip.y),
      width = Math.min(rect.x + rect.width, clip.x + clip.width) - x,
      height = Math.min(rect.y + rect.height, clip.y + clip.height) - y;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      this.clear();
      return;
    }
    const ratio = Math.min(
      globalThis.devicePixelRatio || 1,
      2,
      Math.sqrt(1_048_576 / (width * height)),
    );
    const canvas = this.canvas,
      pixelsX = Math.max(1, Math.ceil(width * ratio)),
      pixelsY = Math.max(1, Math.ceil(height * ratio));
    if (canvas.width !== pixelsX) canvas.width = pixelsX;
    if (canvas.height !== pixelsY) canvas.height = pixelsY;
    Object.assign(canvas.style, {
      left: `${x - origin.x}px`,
      top: `${y - origin.y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio, 0, 0, ratio, -x * ratio, -y * ratio);
    drawMusicNotes(ctx, state.notes, this.images, rect);
    canvas.hidden = false;
  }
  clear() {
    this.canvas.hidden = true;
  }
  destroy() {
    this.canvas.remove();
    this.images.length = 0;
  }
}
