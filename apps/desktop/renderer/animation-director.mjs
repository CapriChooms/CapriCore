/** Local visual autonomy. No generated dialogue, network calls or keyword guessing. */
export class AnimationDirector {
  constructor({ choices, frames, clips, settings, random = Math.random }) {
    this.choices = new Map(choices.map((choice) => [choice.id, choice]));
    this.frames = new Map(frames.map((frame) => [frame.id, frame]));
    this.clips = new Map(clips.map((clip) => [clip.id, clip]));
    this.settings = settings;
    this.random = random;
    this.revision = -1;
    this.base = this.choices.get('neutral');
    this.semantic = this.base;
    this.sequence = null;
    this.nextActivity = Infinity;
    this.nextBlink = 0;
    this.lastTick = null;
  }
  select(id, revision, now) {
    const choice = this.choices.get(id);
    if (!choice || revision < this.revision) return false;
    this.semantic = choice;
    this.revision = revision;
    this.base = this.choices.get(choice.returnTo ?? choice.id);
    this.sequence = null;
    if (choice.animation) this.play(choice.animation, now, 'reaction');
    this.attend(now);
    this.nextBlink = now + 3000 + this.random() * 3000;
    return true;
  }
  attend(now, interrupt = false) {
    this.lastAttention = now;
    this.nextActivity = now + this.settings.firstActivityMs;
    if (interrupt || this.sequence?.kind === 'ambient') this.sequence = null;
  }
  play(id, now, kind = 'reaction') {
    const clip = this.clips.get(id);
    if (!clip) return false;
    this.sequence = {
      id,
      start: now,
      frames: clip.frames.map((frame) => ({ ...frame })),
      effect: clip.effect,
      kind,
    };
    return true;
  }
  activity(now) {
    const resting = this.random() < 0.65 ? 'pose-sit-floor' : 'pose-crouch';
    if (this.frames.has(resting)) {
      this.sequence = {
        id: resting,
        frames: [
          { id: resting, ms: 4200 },
          { id: 'neutral', ms: 220 },
        ],
        start: now,
        kind: 'ambient',
      };
      return;
    }
    const frames = [
      ['neutral', 1500],
      ['idle-look_left', 1100],
      ['idle-look_up', 900],
      ['idle-look_right', 1400],
      ['idle-look_down', 900],
      ['neutral', 2800],
    ].filter(([id]) => this.frames.has(id));
    this.sequence = {
      id: 'looking-around',
      frames: frames.map(([id, ms]) => ({ id, ms })),
      start: now,
      kind: 'ambient',
    };
  }
  tick(
    now,
    {
      expanded,
      active,
      typing,
      speaking,
      sleeping = false,
      reduced = false,
      dragging = false,
    } = {},
  ) {
    const gap = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
    if (gap > 1000) {
      if (this.sequence) this.sequence.start += gap;
      this.nextActivity += gap;
      this.nextBlink += gap;
    }
    const dt = Math.min(1000, gap);
    this.lastTick = now;
    if (this.revision < 0) return null;
    if (sleeping) {
      this.sequence = null;
      this.nextActivity = now + this.settings.firstActivityMs;
      this.nextBlink = now + 3000;
      return this.result(
        this.frames.has('idle-blink_closed') ? 'idle-blink_closed' : this.base.frameId,
        'sleep',
      );
    }
    if (!expanded) {
      if (this.sequence) this.sequence.start += dt;
      this.nextActivity = now + this.settings.firstActivityMs;
      return this.result(this.base.frameId);
    }
    if (dragging) {
      if (this.sequence) this.sequence.start += dt;
      this.nextActivity = now + this.settings.firstActivityMs;
    }
    if (active || typing || speaking) this.attend(now);
    if (reduced) {
      this.sequence = null;
      return this.result(this.base.frameId);
    }
    if (
      !this.sequence &&
      this.settings.enabled &&
      this.base.id === 'neutral' &&
      now >= this.nextActivity &&
      !active &&
      !typing &&
      !speaking &&
      !dragging
    )
      this.activity(now);
    if (this.sequence) {
      let age = now - this.sequence.start;
      for (const frame of this.sequence.frames) {
        if (age < frame.ms) {
          const effect =
            this.sequence.effect?.onFrame === frame.id
              ? { ...this.sequence.effect, progress: Math.max(0, age / frame.ms) }
              : null;
          return this.result(frame.id, this.sequence.id, effect);
        }
        age -= frame.ms;
      }
      this.sequence = null;
      this.nextActivity = now + this.settings.activityGapMs + this.random() * 6000;
    }
    if (this.base.id === 'neutral' && !speaking) {
      if (now >= this.nextBlink) {
        const age = now - this.nextBlink;
        if (age < 280)
          return this.result(
            age < 80 || age > 190 ? 'idle-blink_half' : 'idle-blink_closed',
            'blink',
          );
        this.nextBlink = now + 3000 + this.random() * 4500;
      }
    }
    if (this.base.id === 'surprised' && now % 4600 < 220)
      return this.result('idle-surprised_closed', 'surprise');
    return this.result(this.base.frameId);
  }
  result(frameId, activity = 'dialogue', effect = null) {
    return { frameId, choiceId: this.semantic.id, revision: this.revision, activity, effect };
  }
}

/** Small decoded-frame cache; new poses do not upload an entire atlas to VRAM. */
export class SpriteImages {
  constructor(frames, limit = 20) {
    this.frames = new Map(frames.map((frame) => [frame.id, frame]));
    this.cache = new Map();
    this.limit = limit;
  }
  get(id) {
    if (!this.frames.has(id)) return Promise.reject(new Error('Unknown frame'));
    if (this.cache.has(id)) {
      const value = this.cache.get(id);
      this.cache.delete(id);
      this.cache.set(id, value);
      return value;
    }
    const image = new Image();
    image.src = this.frames.get(id).url;
    const value = image.decode().then(() => image);
    this.cache.set(id, value);
    value.catch(() => {
      if (this.cache.get(id) === value) this.cache.delete(id);
    });
    while (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
}
