/** UI state follows actual dialog/playback events, never a staged status cycle. */
export const SIGNAL_STATES = Object.freeze({
  starting: { label: 'CONNECTING', color: '#a295ff' },
  idle: { label: 'STANDBY', color: '#8ef5ed' },
  input: { label: 'TEXT INPUT', color: '#8ef5ed' },
  listening: { label: 'LISTENING', color: '#8ef5ed' },
  wake: { label: 'SAY CAPRI', color: '#8ef5ed' },
  thinking: { label: 'THINKING', color: '#f4ed75' },
  replying: { label: 'RECEIVING', color: '#f4ed75' },
  buffering: { label: 'VOICE PENDING', color: '#f4ed75' },
  speaking: { label: 'SPEAKING', color: '#f4ed75' },
  online: { label: 'ONLINE', color: '#8ef5ed' },
  offline: { label: 'OFFLINE', color: '#ff5679' },
  stopping: { label: 'DISCONNECTING', color: '#ff5679' },
  sleeping: { label: 'GOING TO SLEEP', color: '#a295ff' },
  asleep: { label: 'SLEEPING', color: '#a295ff' },
});

export class PresenceModel {
  constructor({ now = () => performance.now(), idleMs = 45000 } = {}) {
    Object.assign(this, { now, idleMs });
    this.phase = 'starting';
    this.turnId = null;
    this.hasText = false;
    this.voiceBusy = false;
    this.speaking = false;
    this.typing = false;
    this.microphone = false;
    this.wake = false;
    this.pinned = false;
    this.expanded = false;
    this.sleeping = false;
    this.interacting = false;
    this.lastActivity = now();
    this.burstAt = -Infinity;
    this.autonomous = false;
    this.voiceAttentionUntil = -Infinity;
    this.expandOnReply = true;
  }
  touch() {
    this.lastActivity = this.now();
  }
  burst() {
    this.burstAt = this.now();
  }
  reveal() {
    if (!this.expanded) {
      this.expanded = true;
      this.burst();
    }
    this.touch();
  }
  wakeUp({ reveal = true } = {}) {
    this.voiceAttentionUntil = this.now() + 60000;
    if (reveal) this.reveal();
    else this.touch();
  }
  setSleeping(value) {
    const sleeping = Boolean(value);
    const entering = sleeping && !this.sleeping;
    this.sleeping = sleeping;
    // Show the sleep animation once; later status updates must respect manual collapse.
    if (entering) this.reveal();
  }
  toggle() {
    this.setPinned(!this.expanded);
  }
  setPinned(pinned) {
    this.voiceAttentionUntil = -Infinity;
    this.pinned = pinned;
    if (this.pinned) this.reveal();
    else {
      this.expanded = false;
      this.touch();
    }
  }
  begin(id) {
    this.turnId = id;
    this.hasText = false;
    this.speaking = false;
    this.voiceBusy = false;
    if (!this.pinned && !this.autonomous && this.now() > this.voiceAttentionUntil)
      this.expanded = false;
    this.voiceAttentionUntil = -Infinity;
    this.touch();
    this.burst();
  }
  text(id) {
    if (id === this.turnId) {
      this.hasText = true;
      this.replyAttention();
    }
  }
  finish(id) {
    if (id === this.turnId) {
      this.turnId = null;
      this.touch();
    }
  }
  playback({ busy, speaking }) {
    if (speaking && !this.speaking) this.burst();
    this.voiceBusy = Boolean(busy);
    this.speaking = Boolean(speaking);
    if (speaking) this.replyAttention();
    this.touch();
  }
  replyAttention() {
    if (this.expandOnReply) this.reveal();
    else this.touch();
  }
  snapshot() {
    if (
      this.expanded &&
      !this.autonomous &&
      !this.pinned &&
      !this.sleeping &&
      !this.turnId &&
      !this.voiceBusy &&
      !this.interacting &&
      this.now() - this.lastActivity >= this.idleMs
    )
      this.expanded = false;
    const state =
      this.phase !== 'ready'
        ? this.phase
        : this.speaking
          ? 'speaking'
          : this.turnId
            ? this.hasText
              ? 'replying'
              : 'thinking'
            : this.voiceBusy
              ? 'buffering'
              : this.microphone
                ? 'listening'
                : this.typing
                  ? 'input'
                  : this.wake
                    ? 'wake'
                    : this.expanded
                      ? 'online'
                      : 'idle';
    return {
      state: SIGNAL_STATES[state] ? state : 'offline',
      expanded: this.expanded,
      pinned: this.pinned,
      burstAt: this.burstAt,
    };
  }
}

/** Sparse bursts rather than a full-screen strobe. Independent of idle mode. */
export function interferenceFrame(
  now,
  burstAt,
  reduced = false,
  { enabled = true, strength: amount = 0.65, intervalMs = 35000, events = true } = {},
) {
  if (reduced || !enabled || amount <= 0)
    return { strength: 0, x: 0, y: 0, seed: 0, ambient: false };
  const envelope = (age) =>
    age < 0 || age > 820
      ? 0
      : age < 85
        ? 0.96
        : age < 170
          ? 0.22
          : age < 310
            ? 0.86
            : age < 430
              ? 0.08
              : 0.48 * (1 - (age - 430) / 390);
  const cycle = Math.floor(now / intervalMs),
    schedule = signalRandom(cycle + 2078);
  const ambientAge = now - cycle * intervalMs - (0.2 + schedule() * 0.6) * intervalMs;
  const ambient = envelope(ambientAge) * 0.8;
  const strength = Math.max(events ? envelope(now - burstAt) : 0, ambient) * amount;
  const seed = Math.floor(now / 56),
    random = signalRandom(seed);
  return {
    strength,
    x: (random() - 0.5) * 22 * strength,
    y: (random() - 0.5) * 5 * strength,
    seed,
    ambient: ambient > 0,
  };
}

export function interfaceFloat(now, { amplitude = 2.45, periodSeconds = 11 } = {}) {
  const phase = (now / (periodSeconds * 1000)) * 2 * Math.PI;
  return amplitude * (Math.sin(phase) * 0.75 + Math.sin(phase * 0.53 + 1.4) * 0.25);
}

export function signalRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Unequal faceted shards around Capri's eye, generated as polygons. */
export function shardPoints(index, time, activity = 0) {
  const angle = (index * Math.PI * 2) / 7 + time * (0.12 + activity * 0.38);
  const reach = 27 + Math.sin(time * 1.4 + index * 2) * 2 + activity * 4;
  const length = [19, 11, 23, 15, 12, 20, 14][index % 7];
  const point = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
  return [
    point(reach, angle - 0.18),
    point(reach + length, angle + 0.05),
    point(reach + 4, angle + 0.18),
  ];
}
