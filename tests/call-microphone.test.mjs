// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CallMicrophone,
  callMicrophoneConstraints,
  physicalCallInputs,
} from '../apps/desktop/renderer/call-microphone.mjs';
import { microphoneConstraints } from '../apps/desktop/renderer/microphone.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const input = (deviceId, label = 'Microphone (USB Audio)', groupId = deviceId) => ({
  kind: 'audioinput',
  deviceId,
  label,
  groupId,
});
function stream(deviceId = 'physical', label = 'Microphone (USB Audio)', sampleRate = 48000) {
  const track = Object.assign(new EventTarget(), {
    label,
    readyState: 'live',
    stops: 0,
    getSettings: () => ({ deviceId, sampleRate }),
    stop() {
      this.stops++;
      this.readyState = 'ended';
    },
  });
  return { getAudioTracks: () => [track], getTracks: () => [track], track };
}
function fixture(devices = [input('physical')], capture = async () => stream()) {
  const mediaDevices = Object.assign(new EventTarget(), {
    enumerateDevices: async () => devices,
    getUserMedia: capture,
  });
  let lost = 0;
  const mic = new CallMicrophone({ mediaDevices, onLost: () => lost++, timeoutMs: 1000 });
  return { mic, mediaDevices, lost: () => lost };
}

test('call input selection excludes default aliases, unnamed, playback and loopback devices', () => {
  assert.deepEqual(
    physicalCallInputs([
      null,
      input('default'),
      input('communications'),
      input('hidden', ''),
      { ...input('speaker'), kind: 'audiooutput' },
      ...[
        'Stereo Mix (Realtek)',
        'What U Hear',
        'CABLE Output (VB-Audio)',
        'Microphone (Steam Streaming Microphone)',
        'VoiceMeeter Output',
        'Virtual Audio Microphone',
        'Loopback',
        'OBS Audio',
      ].map((label, i) => input(`unsafe-${i}`, label)),
      input('real'),
    ]),
    [input('real')],
  );
  assert.deepEqual(physicalCallInputs(Array(129).fill(input('mic'))), []);
});

test('call microphone captures an exact physical input independently from ASR and releases owned tracks', async () => {
  let request;
  const physical = stream('preferred');
  const { mic } = fixture([input('first'), input('preferred')], async (value) => {
    request = value;
    return physical;
  });
  assert.equal(await mic.start({ deviceId: 'preferred' }), physical);
  assert.deepEqual(request, {
    video: false,
    audio: {
      sampleRate: { ideal: 48000 },
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: { exact: 'preferred' },
    },
  });
  assert.equal(mic.owned, true);
  assert.equal(mic.sync(null), true, 'Turning ASR off must not stop an independent call mic');
  mic.stop();
  mic.stop();
  assert.equal(physical.track.stops, 1);
  assert.equal(mic.stream, null);
});

test('call capture requests a compatible high rate without changing ASR capture constraints', () => {
  assert.deepEqual(callMicrophoneConstraints().audio.sampleRate, { ideal: 48000 });
  assert.equal(Object.hasOwn(microphoneConstraints().audio, 'sampleRate'), false);
  assert.equal(Object.hasOwn(callMicrophoneConstraints().audio, 'deviceId'), false);
});

test('a low or unknown ASR sample rate gets independent call capture without retuning shared tracks', async () => {
  for (const rate of [16000, 32000, undefined]) {
    const shared = stream();
    shared.track.getSettings = () => ({ deviceId: 'physical', sampleRate: rate });
    shared.track.applyConstraints = () => assert.fail('Calls cannot retune an ASR-owned track');
    const physical = stream();
    let requests = 0;
    const { mic } = fixture([input('physical')], async ({ audio }) => {
      requests++;
      assert.deepEqual(audio.sampleRate, { ideal: 48000 });
      return physical;
    });
    assert.equal(await mic.start({ shared }), physical);
    assert.equal(requests, 1);
    assert.equal(mic.owned, true);
    assert.equal(mic.sync(null), true);
    mic.stop();
    assert.equal(physical.track.stops, 1);
    assert.equal(shared.track.stops, 0);
  }
});

test('a physical 44.1 kHz ASR stream is safely borrowed without applying new constraints', async () => {
  const shared = stream('physical', 'Microphone (USB Audio)', 44100);
  shared.track.applyConstraints = () => assert.fail('Borrowing cannot retune shared capture');
  const { mic } = fixture([input('physical')], () =>
    assert.fail('A full-band physical stream is reusable'),
  );
  assert.equal(await mic.start({ shared }), shared);
  assert.equal(mic.owned, false);
  mic.stop();
  assert.equal(shared.track.stops, 0);
});

test('physical default is resolved to a specific endpoint; a virtual Windows default is never captured', async () => {
  let selected;
  const { mic } = fixture(
    [input('default', 'Default', 'second'), input('first'), input('second')],
    async ({ audio }) => {
      selected = audio.deviceId.exact;
      return stream(selected);
    },
  );
  await mic.start();
  assert.equal(selected, 'second');
  mic.stop();
  const unsafe = fixture(
    [input('default', 'CABLE Output', 'cable'), input('cable', 'CABLE Output'), input('physical')],
    async ({ audio }) => {
      selected = audio.deviceId.exact;
      return stream(selected);
    },
  );
  await assert.rejects(
    unsafe.mic.start({ deviceId: 'cable' }),
    /selected microphone is unavailable/,
  );
  await unsafe.mic.start();
  assert.equal(selected, 'physical');
  unsafe.mic.stop();
});

test('safe live ASR stream is borrowed and never stopped by call teardown', async () => {
  const borrowed = stream();
  const { mic } = fixture([input('physical')], () =>
    assert.fail('Borrowing must not ask for another mic'),
  );
  assert.equal(await mic.start({ shared: borrowed }), borrowed);
  assert.equal(mic.owned, false);
  assert.equal(mic.sync(borrowed), true);
  mic.stop();
  assert.equal(borrowed.track.stops, 0);
});

test('default, missing, stale and virtual-retargeted ASR tracks require a fresh exact physical capture', async () => {
  for (const settings of [
    { deviceId: 'default', groupId: 'cable' },
    { deviceId: 'communications', groupId: 'cable' },
    { deviceId: undefined },
    { deviceId: 'removed', groupId: 'removed' },
    { deviceId: 'cable', groupId: 'cable' },
    { deviceId: 'physical', groupId: 'cable' },
  ]) {
    const borrowed = stream();
    borrowed.track.getSettings = () => ({ ...settings, sampleRate: 48000 });
    borrowed.track.applyConstraints = () => assert.fail('Shared tracks must not be retuned');
    const physical = stream();
    let requests = 0;
    const { mic } = fixture(
      [input('cable', 'CABLE Output'), input('physical')],
      async ({ audio }) => {
        requests++;
        assert.deepEqual(audio.deviceId, { exact: 'physical' });
        return physical;
      },
    );
    assert.equal(await mic.start({ shared: borrowed }), physical);
    assert.equal(requests, 1);
    assert.equal(mic.owned, true);
    mic.stop();
    assert.equal(borrowed.track.stops, 0);
    assert.equal(physical.track.stops, 1);
  }
});

test('a changed physical default takes precedence over an old live shared input', async () => {
  const borrowed = stream('first');
  const physical = stream('second');
  const { mic } = fixture(
    [input('default', 'Default', 'second'), input('first'), input('second')],
    async ({ audio }) => {
      assert.deepEqual(audio.deviceId, { exact: 'second' });
      return physical;
    },
  );
  assert.equal(await mic.start({ shared: borrowed }), physical);
  mic.stop();
  assert.equal(borrowed.track.stops, 0);
});

test('shared microphone settings are refreshed after device enumeration completes', async () => {
  const borrowed = stream();
  const physical = stream();
  let list;
  const { mic, mediaDevices } = fixture([], async () => physical);
  mediaDevices.enumerateDevices = () =>
    new Promise((resolve) => {
      list = resolve;
    });
  const pending = mic.start({ shared: borrowed });
  borrowed.track.getSettings = () => ({ deviceId: 'cable', groupId: 'cable', sampleRate: 48000 });
  list([input('physical'), input('cable', 'CABLE Output')]);
  assert.equal(await pending, physical);
  mic.stop();
  assert.equal(borrowed.track.stops, 0);
});

test('borrowed ASR replacement disconnects the call without stopping either shared stream', async () => {
  const borrowed = stream();
  const replacement = stream('second');
  const { mic, lost } = fixture();
  await mic.start({ shared: borrowed });
  assert.equal(mic.sync(replacement), false);
  assert.equal(lost(), 1);
  assert.equal(borrowed.track.stops, 0);
  assert.equal(replacement.track.stops, 0);
});

test('virtual ASR input is not reused and a new physical stream is selected', async () => {
  const shared = stream('cable', 'CABLE Output');
  const physical = stream();
  const { mic } = fixture([input('physical')], async () => physical);
  assert.equal(await mic.start({ shared }), physical);
  mic.stop();
  assert.equal(shared.track.stops, 0);
  assert.equal(physical.track.stops, 1);
});

test('Stop invalidates pending capture and closes any late permission grant', async () => {
  let grant;
  const physical = stream();
  const { mic } = fixture(
    undefined,
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const starting = mic.start();
  await tick();
  const stopped = assert.rejects(starting, /cancelled/);
  mic.stop();
  await stopped;
  grant(physical);
  await tick();
  assert.equal(physical.track.stops, 1);
  assert.equal(mic.stream, null);
});

test('timed-out capture cleans its late grant and cannot replace a subsequent call', async () => {
  let grant;
  const late = stream();
  const physical = stream();
  let requests = 0;
  const { mic } = fixture(undefined, () =>
    ++requests === 1
      ? new Promise((resolve) => {
          grant = resolve;
        })
      : Promise.resolve(physical),
  );
  mic.timeoutMs = 8;
  await assert.rejects(mic.start(), /timed out/);
  await mic.start();
  grant(late);
  await tick();
  assert.equal(late.track.stops, 1);
  assert.equal(mic.stream, physical);
  assert.equal(physical.track.stops, 0);
  mic.stop();
});

test('a late enumeration cannot request a microphone after Stop', async () => {
  let list;
  const { mic, mediaDevices } = fixture([], () => assert.fail('Stopped setup must not capture'));
  mediaDevices.enumerateDevices = () =>
    new Promise((resolve) => {
      list = resolve;
    });
  const starting = mic.start();
  const stopped = assert.rejects(starting, /cancelled/);
  mic.stop();
  await stopped;
  list([input('physical')]);
  await tick();
  assert.equal(mic.stream, null);
});

test('input loss shuts down owned capture and reports once; unrelated device changes do not', async () => {
  const physical = stream();
  const { mic, mediaDevices, lost } = fixture([input('physical')], async () => physical);
  await mic.start();
  mediaDevices.dispatchEvent(new Event('devicechange'));
  await tick();
  assert.equal(lost(), 0);
  mediaDevices.enumerateDevices = async () => [];
  mediaDevices.dispatchEvent(new Event('devicechange'));
  await tick();
  physical.track.dispatchEvent(new Event('ended'));
  assert.equal(lost(), 1);
  assert.equal(physical.track.stops, 1);
  assert.equal(mic.stream, null);
});

test('a borrowed input that retargets after setup disconnects without stopping the ASR track', async () => {
  for (const settings of [
    { deviceId: 'cable', groupId: 'cable', sampleRate: 48000 },
    { deviceId: 'physical', groupId: 'cable', sampleRate: 48000 },
  ]) {
    const borrowed = stream();
    const { mic, mediaDevices, lost } = fixture([input('physical')]);
    await mic.start({ shared: borrowed });
    borrowed.track.getSettings = () => settings;
    mediaDevices.dispatchEvent(new Event('devicechange'));
    await tick();
    assert.equal(lost(), 1);
    assert.equal(mic.stream, null);
    assert.equal(borrowed.track.stops, 0);
  }
});

test('ended owned and borrowed microphone tracks both disconnect the call once', async () => {
  for (const borrowed of [false, true]) {
    const physical = stream();
    const { mic, lost } = fixture(undefined, async () => physical);
    await mic.start(borrowed ? { shared: physical } : {});
    physical.track.readyState = 'ended';
    physical.track.dispatchEvent(new Event('ended'));
    physical.track.dispatchEvent(new Event('ended'));
    assert.equal(lost(), 1);
    assert.equal(mic.stream, null);
    assert.equal(physical.track.stops, borrowed ? 0 : 1);
  }
});

test('privacy denial, missing physical inputs, and an unexpected granted endpoint fail clearly', async () => {
  const denied = fixture(undefined, async () => {
    throw Object.assign(new Error('private'), { name: 'NotAllowedError' });
  });
  await assert.rejects(denied.mic.start(), /Windows privacy settings/);
  const missing = fixture([input('cable', 'CABLE Output')], () =>
    assert.fail('No physical inputs'),
  );
  await assert.rejects(missing.mic.start(), /No physical microphone/);
  for (const wrong of [stream('physical', 'CABLE Output'), stream('different')]) {
    const { mic } = fixture(undefined, async () => wrong);
    await assert.rejects(mic.start(), /physical microphone instead/);
    assert.equal(wrong.track.stops, 1);
    assert.equal(mic.stream, null);
  }
});
