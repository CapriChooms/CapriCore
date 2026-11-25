import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CaptureWatchdog,
  MAX_RESTARTS,
  STALL_MS,
} from '../apps/desktop/renderer/capture-watchdog.mjs';
import { MicrophoneClient } from '../apps/desktop/renderer/microphone.mjs';

const clocked = (options = {}) => {
  const clock = { time: 1000 };
  return { clock, dog: new CaptureWatchdog({ ...options, now: () => clock.time }) };
};

test('nothing is reported before capture starts or after it is stopped on purpose', () => {
  const { clock, dog } = clocked();
  clock.time += STALL_MS * 10;
  assert.equal(dog.check(), 'ok');
  dog.packet(); // a late packet from a stopped capture does not arm it
  clock.time += STALL_MS * 10;
  assert.equal(dog.check(), 'ok');
  dog.arm();
  dog.disarm();
  clock.time += STALL_MS * 10;
  assert.equal(dog.check(), 'ok');
});

test('steady packets keep capture healthy, a long gap asks for a restart', () => {
  const { clock, dog } = clocked();
  dog.arm();
  for (let i = 0; i < 100; i++) {
    clock.time += 100;
    dog.packet();
    assert.equal(dog.check(), 'ok');
  }
  clock.time += STALL_MS - 1;
  assert.equal(dog.check(), 'ok');
  clock.time += 1;
  assert.equal(dog.check(), 'restart');
  // Until the restarted capture arms it again there is nothing to judge.
  clock.time += STALL_MS * 3;
  assert.equal(dog.check(), 'ok');
});

test('capture that never delivers a packet after starting is also restarted', () => {
  const { clock, dog } = clocked();
  dog.arm();
  clock.time += STALL_MS;
  assert.equal(dog.check(), 'restart');
});

test('it gives up when capture keeps stalling, and forgives old stalls', () => {
  const { clock, dog } = clocked({ windowMs: 60000 });
  for (let i = 0; i < MAX_RESTARTS; i++) {
    dog.arm();
    clock.time += STALL_MS;
    assert.equal(dog.check(), 'restart', 'stall ' + i);
  }
  dog.arm();
  clock.time += STALL_MS;
  assert.equal(dog.check(), 'give-up');
  assert.equal(dog.check(), 'ok'); // disarmed after giving up
  clock.time += 60000; // the earlier stalls are now outside the window
  dog.arm();
  clock.time += STALL_MS;
  assert.equal(dog.check(), 'restart');
});

test('invalid limits are refused', () => {
  assert.throws(() => new CaptureWatchdog({ stallMs: 0 }), TypeError);
  assert.throws(() => new CaptureWatchdog({ maxRestarts: -1 }), TypeError);
  assert.throws(() => new CaptureWatchdog({ maxRestarts: 1.5 }), TypeError);
  assert.throws(() => new CaptureWatchdog({ windowMs: 0 }), TypeError);
});

function listeningClient() {
  const calls = [];
  const errors = [];
  const client = new MicrophoneClient({
    api: {
      stopMicrophone: async (id, keepModelWarm) => {
        calls.push(['stop', id, keepModelWarm]);
      },
      microphoneAudio: async () => ({ accepted: true }),
    },
    onState: () => {},
    onText: () => {},
    onInterrupt: () => {},
    onError: (message) => errors.push(message),
    onLevel: () => {},
  });
  const clock = { time: 0 };
  client.watchdog = new CaptureWatchdog({ now: () => clock.time });
  client.start = async () => {
    calls.push(['start']);
  };
  const begin = () => {
    const run = { id: 'session-' + calls.length, queue: [], sequence: 0, pumping: false };
    client.run = run;
    client.state = { ...client.state, status: 'listening', available: true, modelLoaded: true };
    client.watchdog.arm();
    return run;
  };
  return { client, calls, errors, clock, begin };
}

test('a stalled microphone is stopped, keeps its model and starts again', () => {
  const { client, calls, errors, clock, begin } = listeningClient();
  const run = begin();
  clock.time += 1000;
  client.capturePacket(run, { pcm: new ArrayBuffer(8), rms: 0 });
  client.watchCapture(run);
  assert.deepEqual(calls, []);
  clock.time += STALL_MS;
  client.watchCapture(run);
  assert.deepEqual(calls, [['stop', run.id, true], ['start']]);
  assert.equal(client.run, null);
  assert.equal(client.state.modelLoaded, true);
  assert.deepEqual(errors, []);
});

test('a microphone that keeps stalling is turned off with an explanation', () => {
  const { client, calls, errors, clock, begin } = listeningClient();
  let run;
  for (let i = 0; i <= MAX_RESTARTS; i++) {
    run = begin();
    clock.time += STALL_MS;
    client.watchCapture(run);
  }
  assert.deepEqual(calls.at(-1), ['stop', run.id, false]);
  assert.equal(calls.filter(([name]) => name === 'start').length, MAX_RESTARTS);
  assert.match(errors[0], /stopped delivering sound/);
  assert.equal(client.state.status, 'off');
});

test('the check ignores a capture that was replaced or is not listening', () => {
  const { client, calls, clock, begin } = listeningClient();
  const old = begin();
  const current = begin();
  clock.time += STALL_MS;
  client.watchCapture(old);
  assert.deepEqual(calls, []);
  client.state = { ...client.state, status: 'starting' };
  client.watchCapture(current);
  assert.deepEqual(calls, []);
});

test('every file the microphone code imports is one the window is allowed to load', () => {
  // The window only receives files named in main/resources.mjs. A missing
  // name stops every script in the window from loading.
  const source = readFileSync(
    new URL('../apps/desktop/renderer/microphone.mjs', import.meta.url),
    'utf8',
  );
  const allowed = readFileSync(
    new URL('../apps/desktop/main/resources.mjs', import.meta.url),
    'utf8',
  );
  const imports = [...source.matchAll(/from '\.\/([^']+)'/g)].map((match) => match[1]);
  assert.ok(imports.includes('capture-watchdog.mjs'));
  for (const name of imports)
    assert.ok(allowed.includes("'" + name + "'"), name + ' is not listed');
});

test('by default it measures time with performance.now', () => {
  const dog = new CaptureWatchdog();
  dog.arm();
  assert.equal(dog.check(), 'ok');
  dog.packet();
  assert.equal(dog.check(), 'ok');
  dog.disarm();
  assert.equal(dog.check(), 'ok');
});

test('a microphone that starts listening arms the watchdog and checks it every second', async () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const realAudioContext = globalThis.AudioContext;
  const realWorkletNode = globalThis.AudioWorkletNode;
  const node = () => {
    const audioNode = { disconnect: () => {}, gain: { value: 1 } };
    audioNode.connect = () => audioNode;
    return audioNode;
  };
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
    }
    async resume() {}
    createMediaStreamSource() {
      return node();
    }
    createGain() {
      return node();
    }
    async close() {}
  };
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = {};
      Object.assign(this, node());
    }
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [],
          getAudioTracks: () => [{ addEventListener() {}, label: 'Test mic' }],
        }),
      },
    },
  });
  const calls = [];
  const client = new MicrophoneClient({
    api: {
      startMicrophone: async () => ({ sessionId: 'session-1', deviceId: 'device-1' }),
      microphoneReady: async () => {},
      microphonePlayback: async () => {},
      stopMicrophone: async (id, keepModelWarm) => calls.push(['stop', id, keepModelWarm]),
    },
    onState: () => {},
    onText: () => {},
    onInterrupt: () => {},
    onError: (message) => calls.push(['error', message]),
    onLevel: () => {},
  });
  client.state = { ...client.state, available: true };
  try {
    await client.start();
    assert.deepEqual(calls, []);
    assert.equal(client.state.status, 'listening');
    assert.equal(client.run.id, 'session-1');
    assert.ok(client.run.watch, 'a watch interval is running');
    client.stop(false);
    assert.equal(client.run, null);
  } finally {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete globalThis.navigator;
    globalThis.AudioContext = realAudioContext;
    globalThis.AudioWorkletNode = realWorkletNode;
  }
});
