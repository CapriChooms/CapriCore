import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PresenceModel,
  SIGNAL_STATES,
  shardPoints,
  signalRandom,
  interferenceFrame,
  interfaceFloat,
} from '../apps/desktop/renderer/presence-model.mjs';
import { spriteHit, validateRegions } from '../apps/desktop/geometry.mjs';

test('presence follows text and audio independently and rejects stale text', () => {
  let clock = 0;
  const model = new PresenceModel({ now: () => clock });
  model.phase = 'ready';
  assert.equal(model.snapshot().state, 'idle');
  model.typing = true;
  assert.equal(model.snapshot().state, 'input');
  model.typing = false;
  model.begin('first');
  assert.equal(model.snapshot().state, 'thinking');
  assert.equal(model.snapshot().expanded, false);
  model.begin('second');
  model.text('first');
  assert.equal(model.snapshot().expanded, false);
  model.text('second');
  assert.equal(model.snapshot().expanded, true);
  assert.equal(model.snapshot().state, 'replying');
  model.voiceBusy = true;
  model.finish('second');
  assert.equal(model.snapshot().state, 'buffering');
  model.playback({ busy: true, speaking: true });
  assert.equal(model.snapshot().state, 'speaking');
  clock = 90000;
  assert.equal(model.snapshot().expanded, true);
  model.playback({ busy: false, speaking: false });
  assert.equal(model.snapshot().state, 'online');
  clock += 44999;
  assert.equal(model.snapshot().expanded, true);
  clock += 2;
  assert.equal(model.snapshot().expanded, false);
  assert.equal(model.snapshot().state, 'idle');
});

test('pin and user interaction prevent automatic collapse; listening needs a real microphone flag', () => {
  let clock = 0;
  const model = new PresenceModel({ now: () => clock });
  model.phase = 'ready';
  model.toggle();
  clock = 100000;
  assert.equal(model.snapshot().expanded, true);
  model.toggle();
  assert.equal(model.snapshot().expanded, false);
  model.reveal();
  model.interacting = true;
  clock += 90000;
  assert.equal(model.snapshot().expanded, true);
  model.interacting = false;
  model.touch();
  clock += 45001;
  assert.equal(model.snapshot().expanded, false);
  model.typing = true;
  assert.notEqual(model.snapshot().state, 'listening');
  model.microphone = true;
  assert.equal(model.snapshot().state, 'listening');
  model.phase = 'offline';
  assert.equal(model.snapshot().state, 'offline');
  assert.ok(SIGNAL_STATES[model.snapshot().state]);
});

test('sleep visuals reveal once and allow manual collapse without waking or repinning', () => {
  for (const autonomous of [false, true]) {
    let now = 0;
    const model = new PresenceModel({ now: () => now });
    model.autonomous = autonomous;
    model.phase = 'sleeping';
    model.setSleeping(true);
    assert.equal(model.snapshot().expanded, true);
    model.toggle();
    assert.equal(model.snapshot().expanded, false);
    assert.equal(model.pinned, false);
    model.phase = 'asleep';
    model.setSleeping(true);
    now += 90000;
    assert.equal(model.snapshot().expanded, false);
    assert.equal(model.snapshot().state, 'asleep');
    model.toggle();
    assert.equal(model.snapshot().expanded, true);
    assert.equal(model.sleeping, true);
    model.toggle();
    model.setSleeping(false);
    assert.equal(model.snapshot().expanded, false);
    model.wakeUp();
    assert.equal(model.snapshot().expanded, true);
    // The control says collapse even when a reply or wake expanded an unpinned portrait.
    model.toggle();
    assert.equal(model.snapshot().expanded, false);
  }
});

test('hidden sprite never intercepts desktop clicks and visibility is validated', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100, enabled: false };
  assert.equal(
    spriteHit({ x: 50, y: 50 }, rect, new Uint8Array([255]), { width: 1, height: 1 }),
    false,
  );
  assert.equal(
    validateRegions({ controls: [], sprite: rect }, { width: 480, height: 660 }).sprite.enabled,
    false,
  );
  assert.throws(() =>
    validateRegions(
      { controls: [], sprite: { ...rect, enabled: 'false' } },
      { width: 480, height: 660 },
    ),
  );
});

test('procedural shards and seeded interference are finite and repeatable', () => {
  const a = signalRandom(42),
    b = signalRandom(42);
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
  for (const time of [0, 0.1, 1000])
    for (let i = 0; i < 7; i++) {
      assert.ok(
        shardPoints(i, time, 1)
          .flat()
          .every((value) => Number.isFinite(value) && Math.abs(value) < 60),
      );
    }
});

test('speech starts and each new audio segment trigger a burst without retriggering an ongoing segment', () => {
  let now = 0;
  const model = new PresenceModel({ now: () => now });
  model.phase = 'ready';
  model.toggle();
  now = 100;
  model.playback({ busy: true, speaking: true });
  assert.equal(model.snapshot().burstAt, 100);
  now = 200;
  model.playback({ busy: true, speaking: true });
  assert.equal(model.snapshot().burstAt, 100);
  now = 300;
  model.playback({ busy: true, speaking: false });
  now = 400;
  model.playback({ busy: true, speaking: true });
  assert.equal(model.snapshot().burstAt, 400);
});

test('online interference is sparse, deterministic, bounded and disabled by reduced motion', () => {
  for (let cycle = 0; cycle < 4; cycle++) {
    const frames = Array.from({ length: 1094 }, (_, i) =>
      interferenceFrame(cycle * 35000 + i * 32, -Infinity),
    );
    const active = frames.filter((frame) => frame.strength > 0.04);
    assert.ok(active.length > 0 && active.length < 35);
    for (const frame of frames) {
      assert.ok(
        frame.strength >= 0 &&
          frame.strength <= 1 &&
          Math.abs(frame.x) <= 11 &&
          Math.abs(frame.y) <= 2.5,
      );
    }
  }
  assert.deepEqual(interferenceFrame(2250, 2200), interferenceFrame(2250, 2200));
  assert.ok(interferenceFrame(2250, 2200).strength > 0.5);
  assert.equal(interferenceFrame(2250, 2200, true).strength, 0);
  for (let now = 0; now < 100000; now += 60) assert.ok(Math.abs(interfaceFloat(now)) < 2.46);
});
