// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { StartupIntroGate } from '../apps/desktop/main/startup-intro.mjs';

test('a cold process grants exactly one startup presentation and pending reads have no side effects', () => {
  const gate = new StartupIntroGate({ enabled: true });
  for (let read = 0; read < 50; read++) assert.equal(gate.pending, true);
  assert.equal(gate.claim('play'), 'play');
  assert.equal(gate.pending, false);
  for (let repeat = 0; repeat < 50; repeat++) assert.equal(gate.claim('play'), 'skip');
});

test('hidden or covered windows wait without consuming the first presentation', () => {
  let visible = false;
  const gate = new StartupIntroGate({ enabled: true, available: () => visible });
  for (let repeat = 0; repeat < 5; repeat++) {
    assert.equal(gate.claim('play'), 'wait');
    assert.equal(gate.pending, true);
  }
  visible = true;
  assert.equal(gate.claim('play'), 'play');
  assert.equal(gate.pending, false);
});

test('an explicit skip or reduced-motion decision consumes the intro even while hidden', () => {
  const gate = new StartupIntroGate({
    enabled: true,
    available: () => assert.fail('Skip must not inspect visibility'),
  });
  assert.equal(gate.claim('skip'), 'skip');
  assert.equal(gate.pending, false);
  assert.equal(gate.claim('play'), 'skip');
});

test('disabled artwork never calls availability or starts an intro', () => {
  for (const enabled of [false, undefined, 'true', 1]) {
    const gate = new StartupIntroGate({
      enabled,
      available: () => assert.fail('Disabled intro must not inspect availability'),
    });
    assert.equal(gate.pending, false);
    assert.equal(gate.claim('play'), 'skip');
    assert.equal(gate.claim('skip'), 'skip');
  }
});

test('simultaneous renderer claims cannot grant duplicate playback', async () => {
  const gate = new StartupIntroGate({ enabled: true });
  const claims = await Promise.all(
    Array.from({ length: 20 }, () => Promise.resolve().then(() => gate.claim('play'))),
  );
  assert.equal(claims.filter((result) => result === 'play').length, 1);
  assert.equal(claims.filter((result) => result === 'skip').length, 19);
});

test('renderer recovery, reconnect, tray restore and cancelled playback cannot reset a spent process grant', () => {
  let available = true;
  const gate = new StartupIntroGate({ enabled: true, available: () => available });
  assert.equal(gate.claim('play'), 'play');
  for (const surface of ['renderer recovery', 'reconnect', 'tray restore', 'cancelled playback']) {
    available = false;
    assert.equal(gate.claim('play'), 'skip', surface);
    available = true;
    assert.equal(gate.claim('play'), 'skip', surface);
  }
  assert.equal(
    new StartupIntroGate({ enabled: true }).claim('play'),
    'play',
    'A new process owns a new grant',
  );
});

test('only exact actions are accepted, including after a grant was consumed or disabled', () => {
  const gates = [new StartupIntroGate({ enabled: true }), new StartupIntroGate({ enabled: false })];
  gates[0].claim('skip');
  for (const gate of gates)
    for (const action of [undefined, null, true, 1, {}, ['play'], 'PLAY', 'play ', 'reset'])
      assert.throws(() => gate.claim(action), /Invalid startup intro action/);
  assert.throws(() => new StartupIntroGate({ enabled: true, available: true }), /availability/);
});

test('a temporary availability failure cannot consume a pending grant', () => {
  let available = false;
  const gate = new StartupIntroGate({
    enabled: true,
    available: () => {
      if (!available) throw new Error('Surface not ready');
      return true;
    },
  });
  assert.throws(() => gate.claim('play'), /Surface not ready/);
  assert.equal(gate.pending, true);
  available = true;
  assert.equal(gate.claim('play'), 'play');
});
