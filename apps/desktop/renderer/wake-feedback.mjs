/** Procedural acknowledgement on the already-unlocked capture context. No TTS or files. */
export function playWakeChime(context, volume = 1) {
  if (!context || context.state === 'closed') return false;
  let bus;
  try {
    if (context.state === 'suspended') context.resume?.().catch(() => {});
    const start = context.currentTime + 0.006;
    bus = context.createGain();
    bus.gain.value = 0.085 * volume;
    bus.connect(context.destination);
    let remaining = 2;
    for (const [offset, frequency, duration] of [
      [0, 740, 0.115],
      [0.085, 1110, 0.14],
    ]) {
      const oscillator = context.createOscillator(),
        envelope = context.createGain(),
        at = start + offset;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, at + duration);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(1, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(envelope);
      envelope.connect(bus);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        if (!--remaining) bus.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + duration + 0.005);
    }
    return true;
  } catch {
    bus?.disconnect();
    return false;
  }
}

export function screenshotShutterSamples(rate) {
  const samples = new Float32Array(Math.ceil(rate * 0.17));
  let seed = 2078,
    previous = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const pulse = (at) => {
      const age = t - at;
      return age < 0 ? 0 : Math.min(1, age / 0.0015) * Math.exp(-age / 0.013);
    };
    samples[i] =
      ((noise - previous * 0.7) * 0.1 + Math.sin(t * 2 * Math.PI * 1700) * 0.025) *
      (pulse(0) + 0.8 * pulse(0.065));
    previous = noise;
  }
  return samples;
}

export function playScreenshotShutter(context) {
  const samples = screenshotShutterSamples(context.sampleRate),
    buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => source.disconnect();
  source.start();
}

export class WakeFeedback {
  configure(settings, readAudio) {
    this.soundSettings = settings;
    this.sample = null;
    const revision = (this.sampleRevision = (this.sampleRevision ?? 0) + 1);
    if (['file', 'voice'].includes(settings.wakeSound))
      readAudio()
        .then((sample) => {
          if (revision === this.sampleRevision) this.sample = sample;
        })
        .catch(() => {});
  }
  play(context) {
    const settings = this.soundSettings ?? { wakeSound: 'tone', wakeVolume: 0.7 };
    if (settings.wakeSound === 'off') return true;
    if (settings.wakeSound === 'tone') return playWakeChime(context, settings.wakeVolume);
    // A selected voice/file must never quietly turn into the standard signal.
    if (!this.sample) return false;
    const sample = this.sample;
    const play = (buffer) => {
      if (buffer.duration > 10) throw new Error('Wake audio exceeds 10 seconds');
      const source = context.createBufferSource(),
        gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = settings.wakeVolume;
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        this.onSound?.({ speaking: false, text: '' });
      };
      this.onSound?.({
        speaking: true,
        text: settings.wakeSound === 'voice' ? (sample.text ?? settings.wakePhrase) : '',
      });
      source.start();
    };
    try {
      const bytes = Uint8Array.from(sample.bytes);
      if (sample.pcm) {
        const buffer = context.createBuffer(1, bytes.byteLength / 4, sample.sampleRate);
        buffer.copyToChannel(new Float32Array(bytes.buffer), 0);
        play(buffer);
      } else
        context
          .decodeAudioData(bytes.buffer)
          .then(play)
          .catch(() => false);
      return true;
    } catch {
      return false;
    }
  }
  constructor({ element, root, text = (value) => value, now = () => performance.now(), onSound }) {
    Object.assign(this, { element, root, text, now, onSound });
    this.active = false;
    this.count = 0;
    this.ackUntil = 0;
  }
  settings(state) {
    if (!state.enabled || state.status !== 'listening') this.ackUntil = 0;
    this.active = state.enabled && state.status === 'listening' && state.wakeState !== 'waiting';
    clearTimeout(this.ackTimer);
    const acknowledging =
      state.enabled && state.status === 'listening' && this.now() < this.ackUntil;
    this.element.hidden = !this.active && !acknowledging;
    this.root.dataset.commandListening = String(Boolean(this.active));
    this.element.querySelector('[data-wake-title]').textContent = this.text(
      this.active ? "I'M LISTENING" : 'HEARD YOU',
    );
    this.element.querySelector('[data-wake-hint]').textContent = this.text(
      this.active ? 'SPEAK NOW' : 'REQUEST RECEIVED',
    );
    if (!this.active && acknowledging)
      this.ackTimer = setTimeout(() => {
        if (!this.active) this.element.hidden = true;
      }, this.ackUntil - this.now());
    if (!this.active && !acknowledging) {
      clearTimeout(this.timer);
      this.root.dataset.wakeBurst = 'false';
    }
  }
  activate(context) {
    if (!this.active) return;
    clearTimeout(this.timer);
    clearTimeout(this.ackTimer);
    this.root.dataset.wakeBurst = 'true';
    this.ackUntil = this.now() + 900;
    this.element.dataset.activation = String(++this.count);
    this.element.dataset.sound = this.play(context) ? 'scheduled' : 'unavailable';
    this.timer = setTimeout(() => {
      this.root.dataset.wakeBurst = 'false';
    }, 700);
  }
}
