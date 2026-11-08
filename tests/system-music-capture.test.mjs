// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemMusicClient } from '../apps/desktop/renderer/system-music-capture.mjs';
import {
  dominantAudioChannel,
  MUSIC_PACKET_SAMPLES,
} from '../apps/desktop/renderer/music-worklet.mjs';
import { PCMFramer } from '../apps/desktop/renderer/microphone-worklet.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function track(kind) {
  return {
    kind,
    readyState: 'live',
    stopped: 0,
    listeners: {},
    stop() {
      this.readyState = 'ended';
      this.stopped++;
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
  };
}
function fixture() {
  const audio = track('audio'),
    video = track('video');
  const state = {
    calls: [],
    updates: [],
    errors: [],
    modules: [],
    time: 0,
    clock: 10000,
    packets: [],
  };
  const stream = {
    tracks: [audio, video],
    getTracks() {
      return [...this.tracks];
    },
    getVideoTracks() {
      return this.tracks.filter((item) => item.kind === 'video');
    },
    getAudioTracks() {
      return this.tracks.filter((item) => item.kind === 'audio');
    },
    removeTrack(item) {
      this.tracks = this.tracks.filter((v) => v !== item);
    },
  };
  const node = () => ({
    links: [],
    disconnected: false,
    connect(other) {
      this.links.push(other);
      return other;
    },
    disconnect() {
      this.disconnected = true;
    },
  });
  const source = node(),
    silence = { ...node(), gain: { value: 1 } },
    worklet = { ...node(), port: {} };
  const context = {
    closed: false,
    destination: {},
    async resume() {
      state.calls.push('context-resume');
    },
    async close() {
      this.closed = true;
    },
    audioWorklet: {
      async addModule(url) {
        state.modules.push(String(url));
      },
    },
    createMediaStreamSource(value) {
      assert.equal(value.getVideoTracks().length, 0);
      return source;
    },
    createGain() {
      return silence;
    },
  };
  const api = {
    async musicAudioStart() {
      state.calls.push('start');
      return { sessionId: 'music-session', sampleRate: 16000 };
    },
    async prepareMusicAudio(id) {
      state.calls.push('prepare:' + id);
      return true;
    },
    async cancelMusicAudio(id) {
      state.calls.push('cancel:' + id);
      return true;
    },
    async musicAudioReady(id) {
      state.calls.push('ready:' + id);
      return { accepted: true };
    },
    async musicAudioPacket(value) {
      state.packets.push(value);
      return { accepted: true };
    },
    async musicAudioStop(id) {
      state.calls.push('stop:' + id);
      return true;
    },
  };
  const mediaDevices = {
    async getDisplayMedia(options) {
      state.displayOptions = options;
      return stream;
    },
    async getUserMedia() {
      assert.fail('Music capture never requests a microphone');
    },
  };
  const client = new SystemMusicClient({
    api,
    mediaDevices,
    contextFactory: () => context,
    workletFactory: () => worklet,
    now: () => state.time,
    clock: () => state.clock,
    onState: (value) => state.updates.push(value),
    onError: (value) => state.errors.push(value),
  });
  const packet = (mark = 0) => {
    const pcm = new ArrayBuffer(32000);
    new Uint8Array(pcm)[0] = mark;
    return { pcm };
  };
  return {
    state,
    client,
    api,
    mediaDevices,
    context,
    source,
    silence,
    worklet,
    audio,
    video,
    stream,
    packet,
  };
}

test('music listens to loopback without a microphone/ASR and immediately discards video without monitoring audio', async () => {
  const f = fixture();
  assert.equal(await f.client.start(), true);
  assert.equal(f.video.stopped, 1);
  assert.equal(f.audio.stopped, 0);
  assert.equal(f.silence.gain.value, 0);
  assert.equal(f.state.displayOptions.systemAudio, 'include');
  assert.equal(f.state.displayOptions.audio.suppressLocalAudioPlayback, false);
  assert.equal(f.state.modules.length, 1);
  assert.match(f.state.modules[0], /music-worklet\.mjs$/);
  assert.deepEqual(f.state.calls.slice(0, 3), ['context-resume', 'start', 'prepare:music-session']);
  f.worklet.port.onmessage({ data: f.packet() });
  await tick();
  assert.equal(f.state.packets.length, 1);
  assert.equal(f.state.packets[0].pcm.byteLength, 32000);
  assert.equal(f.state.packets[0].sequence, 0);
  assert.equal(f.client.state.status, 'listening');
  assert(f.state.updates.every((value) => !('pcm' in value)));
  f.client.stop();
  assert.equal(f.audio.stopped, 1);
  assert.equal(f.context.closed, true);
  assert.equal(f.worklet.port.onmessage, null);
  assert.equal(f.client.state.status, 'off');
});

test('stopping an unresolved browser capture kills every late track and cannot revive listening', async () => {
  const f = fixture();
  let deliver;
  f.mediaDevices.getDisplayMedia = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const starting = f.client.start();
  await tick();
  f.client.stop();
  deliver(f.stream);
  assert.equal(await starting, false);
  assert.equal(f.audio.stopped, 1);
  assert.equal(f.video.stopped, 1);
  assert.equal(f.client.state.status, 'off');
  assert(!f.state.updates.some((value) => value.status === 'listening'));
  assert.equal(f.state.errors.length, 0);
});

test('a denied capture or failed worklet setup cleans its session and reports no private native error text', async () => {
  for (const stage of ['capture', 'worklet', 'ready']) {
    const f = fixture();
    const failure = () => {
      throw Error('private audio device and owner text');
    };
    if (stage === 'capture') f.mediaDevices.getDisplayMedia = failure;
    if (stage === 'worklet') f.context.audioWorklet.addModule = failure;
    if (stage === 'ready') f.api.musicAudioReady = async () => ({ accepted: false });
    assert.equal(await f.client.start(), false);
    assert.equal(f.context.closed, true);
    assert.equal(f.client.state.status, 'off');
    assert(f.state.calls.includes('stop:music-session'));
    assert(!JSON.stringify(f.state.errors).includes('private'));
    if (stage !== 'capture') assert.equal(f.audio.stopped, 1);
  }
});

test('slow consumers keep only the newest pending half-second block, and loading workers may drop packets', async () => {
  const f = fixture();
  await f.client.start();
  let release;
  f.api.musicAudioPacket = async (value) => {
    f.state.packets.push(value);
    if (f.state.packets.length === 1)
      return new Promise((resolve) => {
        release = resolve;
      });
    return { accepted: false, ready: false };
  };
  f.client.packet(f.client.run, f.packet(1));
  for (let i = 2; i <= 10; i++) f.client.packet(f.client.run, f.packet(i));
  assert.equal(f.state.packets.length, 1);
  assert.equal(f.client.run.pending.pcm.byteLength, 32000);
  release({ accepted: false, ready: false });
  await tick();
  assert.equal(f.state.packets.length, 2);
  assert.equal(f.state.packets[1].pcm[0], 10);
  assert.equal(f.state.packets[1].sequence, 9, 'Dropped capture time must create a rhythm gap');
  assert.equal(f.client.state.status, 'listening');
  f.client.stop();
});

test('own TTS packets and playback tail are suppressed while the loopback track remains alive', async () => {
  const f = fixture();
  await f.client.start();
  f.client.playback({ speaking: true });
  f.client.packet(f.client.run, f.packet());
  await tick();
  assert.equal(f.state.packets.length, 0);
  f.client.playback({ speaking: false });
  f.state.time = 399;
  f.client.packet(f.client.run, f.packet());
  await tick();
  assert.equal(f.state.packets.length, 0);
  f.state.time = 401;
  f.client.packet(f.client.run, f.packet());
  await tick();
  assert.equal(f.state.packets.length, 1);
  assert.equal(f.state.packets[0].sequence, 2, 'TTS suppression must not join disconnected beats');
  assert.equal(f.audio.stopped, 0);
  f.client.stop();
});

test('music packets retain audio capture time when worklet messages arrive late', async () => {
  const f = fixture();
  await f.client.start();
  f.context.currentTime = 12.5;
  f.client.packet(f.client.run, { ...f.packet(), capturedTime: 12 });
  await tick();
  assert.equal(f.state.packets[0].capturedAt, 9500);
  assert.equal(f.state.packets[0].sequence, 0);
  f.client.stop();
});

test('host session stop and removed output device cannot continue capturing or restart themselves', async () => {
  for (const mode of ['host', 'device']) {
    const f = fixture();
    await f.client.start();
    f.client.setState({ stoppedSessionId: 'different' });
    assert(f.client.run);
    if (mode === 'host') f.client.setState({ stoppedSessionId: 'music-session' });
    else f.audio.listeners.ended();
    assert.equal(f.client.state.status, 'off');
    assert.equal(f.audio.stopped, 1);
    if (mode === 'host') assert(!f.state.calls.includes('stop:music-session'));
  }
});

test('stereo channel selection preserves anti-phase music, and resampling emits exact finite 16k packets', () => {
  const left = Float32Array.from(
    { length: 48000 },
    (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.3,
  );
  const right = left.map((value) => -value);
  const selected = dominantAudioChannel([left, right]);
  assert.equal(selected, left);
  assert.equal(dominantAudioChannel([new Float32Array(48000), right]), right);
  const frames = [],
    framer = new PCMFramer(48000, 16000, MUSIC_PACKET_SAMPLES, (value) => frames.push(value));
  for (let i = 0; i < selected.length; i += 128) framer.accept(selected.subarray(i, i + 128));
  assert.equal(frames.length, 2);
  assert(
    frames.every(
      ({ pcm, rms }) =>
        pcm.byteLength === 32000 && rms > 0.1 && [...new Float32Array(pcm)].every(Number.isFinite),
    ),
  );
});
