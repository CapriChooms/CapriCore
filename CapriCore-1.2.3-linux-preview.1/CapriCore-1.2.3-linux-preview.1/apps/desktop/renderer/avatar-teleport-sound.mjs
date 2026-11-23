// SPDX-License-Identifier: GPL-3.0-only

export function playTeleportSound(context, preset) {
  if (!context || context.state === 'closed' || !['spark', 'thunder', 'pulse'].includes(preset))
    return;
  if (context.state === 'suspended') void context.resume().catch(() => {});
  const start = context.currentTime + 0.007;
  const duration = { spark: 0.16, thunder: 0.37, pulse: 0.26 }[preset];
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(preset === 'thunder' ? 0.14 : 0.085, start + 0.025);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  envelope.connect(context.destination);
  const sweep = context.createOscillator();
  sweep.type = preset === 'spark' ? 'triangle' : 'sine';
  sweep.frequency.setValueAtTime({ spark: 1900, thunder: 132, pulse: 360 }[preset], start);
  sweep.frequency.exponentialRampToValueAtTime(
    { spark: 630, thunder: 45, pulse: 920 }[preset],
    start + duration * 0.7,
  );
  sweep.connect(envelope);
  let crackle, filter;
  if (preset !== 'pulse') {
    const noise = context.createBuffer(
      1,
      Math.floor(context.sampleRate * duration),
      context.sampleRate,
    );
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.6;
    crackle = context.createBufferSource();
    crackle.buffer = noise;
    filter = context.createBiquadFilter();
    filter.type = preset === 'spark' ? 'highpass' : 'lowpass';
    filter.frequency.value = preset === 'spark' ? 1900 : 420;
    crackle.connect(filter).connect(envelope);
    crackle.start(start);
  }
  sweep.onended = () => {
    crackle?.disconnect();
    filter?.disconnect();
    sweep.disconnect();
    envelope.disconnect();
  };
  sweep.start(start);
  sweep.stop(start + duration);
}
