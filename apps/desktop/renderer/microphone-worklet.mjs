/** Incremental integration resampler; normally AudioContext already runs at 16k. */
export class PCMFramer {
  constructor(inputRate, outputRate = 16000, length = 1600, emit = () => {}) {
    this.ratio = inputRate / outputRate;
    this.remaining = this.ratio;
    this.area = 0;
    this.index = 0;
    this.energy = 0;
    this.pending = new Float32Array(length);
    this.length = length;
    this.emit = emit;
  }
  accept(channel) {
    for (const sample of channel) {
      let available = 1;
      const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      while (available > 1e-8) {
        const portion = Math.min(available, this.remaining);
        this.area += value * portion;
        this.remaining -= portion;
        available -= portion;
        if (this.remaining < 1e-8) {
          const output = this.area / this.ratio;
          this.pending[this.index++] = output;
          this.energy += output * output;
          this.area = 0;
          this.remaining = this.ratio;
          if (this.index === this.length) {
            const pcm = this.pending,
              rms = Math.sqrt(this.energy / this.length);
            this.pending = new Float32Array(this.length);
            this.index = 0;
            this.energy = 0;
            this.emit({ pcm: pcm.buffer, rms });
          }
        }
      }
    }
  }
}

if (typeof registerProcessor === 'function') {
  class CapriPCM extends AudioWorkletProcessor {
    constructor() {
      super();
      this.framer = new PCMFramer(sampleRate, 16000, 1600, (value) =>
        this.port.postMessage(value, [value.pcm]),
      );
    }
    process(inputs, outputs) {
      const channel = inputs[0]?.[0];
      if (channel) this.framer.accept(channel);
      for (const output of outputs[0] ?? []) output.fill(0); // Never monitor the mic.
      return true;
    }
  }
  registerProcessor('capri-microphone-pcm', CapriPCM);
}
