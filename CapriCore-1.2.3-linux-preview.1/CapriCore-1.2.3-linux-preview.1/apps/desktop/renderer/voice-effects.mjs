import { VOICE_EFFECT_DEFAULTS, validateVoiceEffects } from './voice-effects-settings.mjs';

export function roomImpulse(context, spacious = false) {
  const length = Math.ceil(context.sampleRate * (spacious ? 1.6 : 0.32)),
    buffer = context.createBuffer(1, length, context.sampleRate);
  const pcm = buffer.getChannelData(0);
  let seed = 417;
  // A procedural, deterministic small room; no sound assets or audio downloads.
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pcm[i] =
      (seed / 2147483648 - 1) *
      Math.exp(-i / (context.sampleRate * (spacious ? 0.3 : 0.055))) *
      0.025;
  }
  return buffer;
}

const extension = (amount) => Math.max(0, amount / 100 - 1);
const driveAmount = (intensity) => 1 + (intensity / 100) * 0.25 + extension(intensity) * 0.75;
const lowFrequency = (sampleRate, filter) =>
  Math.min(sampleRate / 2 - 100, 14000 - Math.min(filter, 100) * 110 - extension(filter) * 1600);
const glitchInterval = (amount, first = false) =>
  ((first ? 2 : 3) + Math.max(0, 100 - amount) * 0.12) / (1 + extension(amount) * 7);

/** Persistent playback graph: chunks share filters, room and delay state. */
export class VoiceEffects {
  constructor(context, destination) {
    Object.assign(this, { context, destination });
    this.input = context.createGain();
    this.input.connect(destination);
    this.settings = { ...VOICE_EFFECT_DEFAULTS };
    this.nodes = [];
    this.active = false;
    this.nextGlitch = 0;
    this.timer = null;
  }
  parameter(param, value) {
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    if (this.fresh) param.setValueAtTime(value, now);
    else param.setTargetAtTime(value, now, 0.008);
  }
  build() {
    const c = this.context,
      nodes = this.nodes;
    this.fresh = true;
    const gain = () => {
      const n = c.createGain();
      nodes.push(n);
      return n;
    };
    this.dry = gain();
    this.wet = gain();
    this.roomGain = gain();
    this.spaceGain = gain();
    this.echoGain = gain();
    this.feedback = gain();
    this.sum = gain();
    this.drive = gain();
    this.normal = gain();
    this.robot = gain();
    this.modulator = gain();
    this.modulator.gain.value = 0;
    this.carrier = c.createOscillator();
    this.carrier.frequency.value = 60;
    this.carrier.connect(this.modulator.gain);
    this.carrier.start();
    nodes.push(this.carrier);
    this.high = c.createBiquadFilter();
    this.high.type = 'highpass';
    this.low = c.createBiquadFilter();
    this.low.type = 'lowpass';
    this.room = c.createConvolver();
    this.room.buffer = roomImpulse(c);
    this.space = c.createConvolver();
    this.space.buffer = roomImpulse(c, true);
    this.echo = c.createDelay(0.25);
    this.echo.delayTime.value = 0.095;
    this.safety = c.createWaveShaper();
    this.safety.curve = Float32Array.from({ length: 4097 }, (_, i) => {
      const x = i / 2048 - 1;
      return 0.96 * Math.tanh(x / 0.96);
    });
    nodes.push(this.high, this.low, this.room, this.space, this.echo, this.safety);
    this.input.disconnect();
    this.input.connect(this.dry);
    this.dry.connect(this.sum);
    this.input.connect(this.high);
    this.high.connect(this.low);
    this.low.connect(this.drive);
    this.drive.connect(this.normal);
    this.normal.connect(this.wet);
    this.drive.connect(this.modulator);
    this.modulator.connect(this.robot);
    this.robot.connect(this.wet);
    this.drive.connect(this.room);
    this.room.connect(this.roomGain);
    this.roomGain.connect(this.wet);
    this.drive.connect(this.space);
    this.space.connect(this.spaceGain);
    this.spaceGain.connect(this.wet);
    this.drive.connect(this.echo);
    this.echo.connect(this.echoGain);
    this.echoGain.connect(this.wet);
    this.echo.connect(this.feedback);
    this.feedback.connect(this.echo);
    this.wet.connect(this.sum);
    this.sum.connect(this.safety);
    this.safety.connect(this.destination);
  }
  configure(value) {
    const next = validateVoiceEffects(value),
      was = this.settings.enabled,
      previousGlitch = this.settings.glitch;
    this.settings = next;
    if (!next.enabled) {
      if (was || this.nodes.length) this.resetGraph();
      return;
    }
    if (!this.nodes.length) this.build();
    const mix = next.mix / 100,
      roomBoost = extension(next.reverb),
      echoBoost = extension(next.delay);
    this.parameter(this.dry.gain, 1 - mix);
    this.parameter(this.wet.gain, mix * 0.85);
    this.parameter(this.drive.gain, driveAmount(next.intensity));
    this.parameter(this.normal.gain, 1 - next.electronicMix / 100);
    this.parameter(this.robot.gain, next.electronicMix / 100);
    this.parameter(this.carrier.frequency, next.carrierHz);
    this.parameter(
      this.roomGain.gain,
      Math.min(next.reverb / 100, 1) * 0.35 * (1 - roomBoost * 0.65),
    );
    this.parameter(this.spaceGain.gain, roomBoost * 0.9);
    this.parameter(this.echoGain.gain, Math.min(next.delay / 100, 1) * 0.24 + echoBoost * 0.71);
    this.parameter(this.echo.delayTime, 0.095 + echoBoost * 0.125);
    this.parameter(this.feedback.gain, echoBoost * 0.42);
    this.parameter(
      this.high.frequency,
      25 + Math.min(next.filter, 100) * 4.2 + extension(next.filter) * 555,
    );
    this.parameter(this.low.frequency, lowFrequency(this.context.sampleRate, next.filter));
    if (previousGlitch !== next.glitch)
      this.nextGlitch = this.context.currentTime + glitchInterval(next.glitch, true);
    this.fresh = false;
    if (this.active) this.arm();
  }
  speaking(active) {
    this.active = active;
    if (active && this.settings.enabled) this.arm();
    else {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  arm() {
    if (this.timer) return;
    if (!this.nextGlitch)
      this.nextGlitch = this.context.currentTime + glitchInterval(this.settings.glitch, true);
    this.timer = setInterval(() => {
      const now = this.context.currentTime;
      if (
        this.active &&
        this.settings.enabled &&
        this.settings.glitch > 0 &&
        now >= this.nextGlitch
      ) {
        this.burst();
        this.nextGlitch = now + glitchInterval(this.settings.glitch);
      }
    }, 150);
  }
  burst(strong = false) {
    if (!this.settings.enabled || !this.active || !this.nodes.length || !this.settings.glitch)
      return;
    const now = this.context.currentTime,
      amount = this.settings.intensity / 100,
      boost = extension(this.settings.glitch);
    this.low.frequency.cancelScheduledValues(now);
    const base = lowFrequency(this.context.sampleRate, this.settings.filter);
    this.low.frequency.setTargetAtTime(
      Math.max(boost ? 600 : 1800, (base * (strong ? 0.45 : 0.7)) / (1 + boost * 2)),
      now,
      0.003,
    );
    this.low.frequency.setTargetAtTime(
      base,
      now + (strong ? 0.06 : 0.025) * amount + boost * 0.065,
      0.009,
    );
    // Brief timbre interference, never missing words or a zero-volume gate.
    this.drive.gain.cancelScheduledValues(now);
    this.drive.gain.setTargetAtTime(
      1 + amount * (strong ? 0.65 : 0.4) + boost * amount,
      now,
      0.004,
    );
    this.drive.gain.setTargetAtTime(
      driveAmount(this.settings.intensity),
      now + 0.045 + boost * 0.065,
      0.008,
    );
  }
  get tailSeconds() {
    return this.settings.enabled && (this.settings.reverb || this.settings.delay)
      ? 0.36 +
          Math.max(extension(this.settings.reverb) * 1.28, extension(this.settings.delay) * 1.64)
      : 0;
  }
  resetGraph() {
    if (this.carrier) {
      this.carrier.stop();
      this.carrier = null;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.nextGlitch = 0;
    this.input.disconnect();
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    this.input.connect(this.destination);
  }
  reset() {
    this.speaking(false);
    this.nextGlitch = 0;
    this.resetGraph();
    if (this.settings.enabled) {
      this.build();
      this.configure(this.settings);
    }
  }
  destroy() {
    this.speaking(false);
    this.resetGraph();
    this.input.disconnect();
  }
}
