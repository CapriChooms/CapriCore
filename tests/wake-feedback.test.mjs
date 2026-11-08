import assert from 'node:assert/strict';
import test from 'node:test';
import { WakeFeedback, playWakeChime } from '../apps/desktop/renderer/wake-feedback.mjs';

test('visual wake confirmation survives a fast submission but never implies capture after microphone off', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const labels = new Map(),
    root = { dataset: {} };
  const element = {
    hidden: true,
    dataset: {},
    querySelector: (key) => {
      if (!labels.has(key)) labels.set(key, {});
      return labels.get(key);
    },
  };
  const feedback = new WakeFeedback({ element, root, now: () => now });
  const state = { enabled: true, status: 'listening', wakeState: 'waiting' };
  feedback.settings(state);
  assert.equal(element.hidden, true);
  feedback.activate(null);
  assert.equal(element.dataset.activation, undefined);
  feedback.settings({ ...state, wakeState: 'command' });
  feedback.activate(null);
  assert.equal(element.hidden, false);
  assert.equal(root.dataset.commandListening, 'true');
  assert.equal(element.dataset.activation, '1');
  assert.equal(element.dataset.sound, 'unavailable');
  assert.equal(labels.get('[data-wake-title]').textContent, "I'M LISTENING");
  feedback.settings(state);
  assert.equal(element.hidden, false);
  assert.equal(root.dataset.commandListening, 'false');
  assert.equal(labels.get('[data-wake-title]').textContent, 'HEARD YOU');
  now = 1000;
  t.mock.timers.tick(1000);
  assert.equal(element.hidden, true);
  feedback.settings({ ...state, wakeState: 'command' });
  feedback.activate(null);
  feedback.settings({ enabled: false, status: 'off' });
  assert.equal(element.hidden, true);
  assert.equal(root.dataset.wakeBurst, 'false');
  feedback.settings(state);
  assert.equal(element.hidden, true);
  t.mock.timers.tick(1000);
  assert.equal(element.hidden, true);
});

test('an unavailable audio context does not break wake acknowledgement', () => {
  assert.equal(playWakeChime(null), false);
  assert.equal(playWakeChime({ state: 'closed' }), false);
  assert.equal(
    playWakeChime({
      state: 'running',
      createGain: () => {
        throw Error('device unavailable');
      },
    }),
    false,
  );
});
