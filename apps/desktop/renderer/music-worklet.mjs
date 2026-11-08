// SPDX-License-Identifier: GPL-3.0-only
import { PCMFramer } from './microphone-worklet.mjs';

export const MUSIC_PACKET_SAMPLES = 8000;

/** Preserve stereo music even if L/R are out of phase or only one side is audible. */
export function dominantAudioChannel(channels) {
  let selected = null,
    maximum = -1;
  for (const channel of channels ?? []) {
    if (!(channel instanceof Float32Array) || !channel.length) continue;
    let energy = 0;
    for (const sample of channel) if (Number.isFinite(sample)) energy += sample * sample;
    if (energy > maximum) {
      maximum = energy;
      selected = channel;
    }
  }
  return selected;
}

if (typeof registerProcessor === 'function') {
  class CapriMusicPCM extends AudioWorkletProcessor {
    constructor() {
      super();
      this.framer = new PCMFramer(sampleRate, 16000, MUSIC_PACKET_SAMPLES, (value) =>
        this.port.postMessage({ ...value, capturedTime: currentTime }, [value.pcm]),
      );
    }
    process(inputs, outputs) {
      const channel = dominantAudioChannel(inputs[0]);
      if (channel) this.framer.accept(channel);
      for (const output of outputs[0] ?? []) output.fill(0);
      return true;
    }
  }
  registerProcessor('capri-music-pcm', CapriMusicPCM);
}
