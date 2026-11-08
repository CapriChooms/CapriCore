// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SystemAudioCapture } from '../apps/desktop/system-audio-capture.mjs';
import { MicrophoneClient } from '../apps/desktop/renderer/microphone.mjs';

test('system audio requires exact frame, active session, recent consent and a real gesture', () => {
  let sessionId = 'current',
    now = 0;
  const frame = { url: 'capri://desktop/index.html' };
  const calls = [];
  const policy = new SystemAudioCapture({
    ownerFrame: () => frame,
    sessionId: () => sessionId,
    enableReview: (id, wake) => calls.push({ id, wake }),
    available: true,
    now: () => now,
  });
  const request = {
    frame,
    securityOrigin: 'capri://desktop',
    videoRequested: true,
    audioRequested: true,
    userGesture: true,
  };
  const result = [];
  const read = (options = {}) => policy.consume({ ...request, ...options }, (x) => result.push(x));
  assert.equal(read(), true);
  assert.deepEqual(result.pop(), {});
  assert.throws(() => policy.prepare('stale', frame), /active microphone/);
  assert.throws(() => policy.prepare(sessionId, { ...frame }), /active microphone/);
  policy.prepare(sessionId, frame, true);
  assert.equal(policy.armed(), true);
  assert.equal(read({ audioRequested: false }), false);
  assert.deepEqual(result, []);
  for (const invalid of [
    { userGesture: false },
    { frame: { ...frame } },
    { videoRequested: false },
    { securityOrigin: 'https://example.com' },
  ]) {
    assert.equal(read(invalid), true);
    assert.deepEqual(result.pop(), {});
  }
  assert.deepEqual(calls, []);
  assert.equal(read(), true);
  assert.deepEqual(result.pop(), { video: frame, audio: 'loopback' });
  assert.deepEqual(calls, [{ id: sessionId, wake: true }]);
  assert.equal(policy.armed(), false);
  read();
  assert.deepEqual(result.pop(), {});
  policy.prepare(sessionId, frame);
  now = 5000;
  read();
  assert.deepEqual(result.pop(), {});
  policy.prepare(sessionId, frame);
  assert.equal(policy.cancel(sessionId, frame), true);
  read();
  assert.deepEqual(result.pop(), {});
  policy.prepare(sessionId, frame);
  sessionId = 'new';
  assert.equal(policy.armed(), false);
  read();
  assert.deepEqual(result.pop(), {});
});

test('system audio feeds the ASR worklet only and releases both media tracks on stop', async (t) => {
  const stopped = [],
    cancelled = [],
    states = [];
  const track = (kind) => ({
    kind,
    readyState: 'live',
    stop: () => stopped.push(kind),
    addEventListener() {},
  });
  const audio = track('audio');
  const video = track('video');
  const tracks = [audio, video];
  const stream = {
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getTracks: () => tracks,
    removeTrack: (track) => tracks.splice(tracks.indexOf(track), 1),
  };
  t.mock.getter(globalThis, 'navigator', () => ({
    mediaDevices: {
      getDisplayMedia: async (options) => {
        assert.equal(options.audio.restrictOwnAudio, true);
        return stream;
      },
    },
  }));
  const node = () => ({
    gain: {
      values: [],
      setValueAtTime(value, time) {
        this.values.push([value, time]);
      },
      cancelScheduledValues() {},
    },
    connect(to) {
      this.connected = to;
    },
    disconnect() {
      this.connected = null;
    },
  });
  const client = new MicrophoneClient({
    api: {
      prepareSystemAudio: async (id) => assert.equal(id, 'session'),
      cancelSystemAudio: async (id) => cancelled.push(id),
      microphonePlayback: async () => {},
      stopMicrophone: async () => {},
    },
    onState: (value) => states.push(value),
    onError: assert.fail,
    onLevel() {},
  });
  const microphoneTrack = track('microphone');
  const microphoneStream = { getTracks: () => [microphoneTrack] };
  const run = (client.run = {
    id: 'session',
    context: {
      currentTime: 0,
      createMediaStreamSource: () => node(),
      createGain: node,
      close: async () => {},
    },
    stream: microphoneStream,
    micGain: node(),
    worklet: { port: {}, disconnect() {} },
  });
  client.settings({ enabled: true, status: 'listening' });
  assert.equal(await client.setSystemAudio(true), true);
  const loopback = run.systemAudio;
  assert.equal(loopback.gain.connected, run.worklet);
  assert.deepEqual(stopped, ['video']);
  assert.equal(states.at(-1).systemAudioActive, true);
  assert.deepEqual(loopback.gain.gain.values.at(-1), [0.4, 0]);
  assert.deepEqual(run.micGain.gain.values.at(-1), [0.6, 0]);
  client.playback({ speaking: true, text: 'Own output' });
  assert.deepEqual(loopback.gain.gain.values.at(-1), [0, 0]);
  assert.deepEqual(run.micGain.gain.values.at(-1), [1, 0]);
  client.playback({ speaking: false });
  assert.deepEqual(loopback.gain.gain.values.slice(-2), [
    [0, 0],
    [0.4, 0.4],
  ]);
  await client.setSystemAudio(false);
  assert.equal(states.at(-1).systemAudioActive, false);
  assert.equal(client.run, run);
  assert.equal(loopback.gain.connected, null);
  assert.deepEqual(stopped, ['video', 'audio']);
  assert.deepEqual(cancelled, ['session']);
  client.stop();
  assert.deepEqual(stopped, ['video', 'audio', 'microphone']);
});

test('an audio stream returned after disabling is released without entering recognition', async (t) => {
  let grantStream, captureStarted;
  const requested = new Promise((resolve) => (captureStarted = resolve));
  const tracks = [];
  t.mock.getter(globalThis, 'navigator', () => ({
    mediaDevices: {
      getDisplayMedia: () => {
        captureStarted();
        return new Promise((resolve) => (grantStream = resolve));
      },
    },
  }));
  const client = new MicrophoneClient({
    api: { prepareSystemAudio: async () => {}, cancelSystemAudio: async () => {} },
    onState() {},
    onError: assert.fail,
  });
  const run = (client.run = {
    id: 'session',
    micGain: {},
    context: { createMediaStreamSource: assert.fail },
  });
  client.settings({ status: 'listening' });
  const pending = client.setSystemAudio(true);
  await requested;
  assert.equal(await client.setSystemAudio(false), true);
  assert.equal(await client.setSystemAudio(true), false);
  const video = { stop: () => tracks.push('video') };
  grantStream({
    getVideoTracks: () => [video],
    getTracks: () => [{ stop: () => tracks.push('audio') }],
    removeTrack: (track) => assert.equal(track, video),
  });
  assert.equal(await pending, false);
  assert.deepEqual(tracks, ['video', 'audio']);
  assert.equal(run.systemAudioRequest, null);
  assert.equal(client.state.systemAudioPending, false);
  assert.equal(client.state.systemAudioActive, false);
});
