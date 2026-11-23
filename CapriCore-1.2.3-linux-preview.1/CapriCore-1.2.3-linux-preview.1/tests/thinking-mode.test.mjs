// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ThinkingMode } from '../apps/desktop/renderer/thinking-mode.mjs';

class Element {
  attributes = {};
  listeners = {};
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(key, value) {
    this.listeners[key] = value;
  }
  set innerHTML(_value) {
    assert.fail('Thinking text must not render HTML.');
  }
}
function fixture({ save = async (enabled) => ({ enabled }) } = {}) {
  const button = new Element(),
    preface = new Element(),
    progress = new Element(),
    approachButton = new Element(),
    approach = new Element(),
    errors = [],
    calls = [];
  const mode = new ThinkingMode({
    button,
    preface,
    progress,
    approachButton,
    approach,
    ui: { text: (value) => value },
    api: {
      setThinkingMode: async (enabled) => {
        calls.push(enabled);
        return save(enabled);
      },
    },
    onError: (message) => errors.push(message),
  });
  return { mode, button, preface, progress, approachButton, approach, errors, calls };
}

test('thinking is opt-in, exposes its pressed state and uses the session host setter', async () => {
  const f = fixture();
  assert.equal(f.mode.enabled, false);
  assert.equal(f.button.attributes['aria-pressed'], 'false');
  assert.equal(f.button.disabled, true);
  assert.equal(f.preface.hidden, true);
  assert.equal(await f.mode.setEnabled(true), false);
  assert.deepEqual(f.calls, []);
  f.mode.setReady(true);
  assert.equal(await f.mode.setEnabled(true), true);
  assert.deepEqual(f.calls, [true]);
  assert.equal(f.button.attributes['aria-pressed'], 'true');
  assert.equal(f.button.attributes['aria-label'], 'Thinking mode: On');
  assert.match(f.button.title, /Take more time to check difficult answers/);
  assert.deepEqual(f.mode.snapshot(), {
    enabled: true,
    label: 'Thinking mode: On',
    hint: 'Take more time to check difficult answers.',
  });
  await f.mode.setEnabled(false);
  assert.deepEqual(f.calls, [true, false]);
  assert.equal(f.button.attributes['aria-pressed'], 'false');
});

test('pending mode changes are single-flight and a rejected setting restores the previous state', async () => {
  let reject;
  const f = fixture({ save: () => new Promise((_, no) => (reject = no)) });
  f.mode.setReady(true);
  const pending = f.mode.setEnabled(true);
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.attributes['aria-busy'], 'true');
  assert.equal(await f.mode.setEnabled(false), false);
  reject(new Error('Session setting could not be changed.'));
  assert.equal(await pending, false);
  assert.equal(f.mode.enabled, false);
  assert.equal(f.button.disabled, false);
  assert.deepEqual(f.calls, [true]);
  assert.deepEqual(f.errors, ['Session setting could not be changed.']);
});

test('only a current turn preface is rendered as bounded plain text, never reasoning events', () => {
  const f = fixture();
  f.mode.begin('current');
  assert.equal(f.mode.event({ type: 'turn.preface', turnId: 'old', text: 'Stale' }), false);
  assert.equal(
    f.mode.event({ type: 'turn.reasoning', turnId: 'current', text: 'Private reasoning' }),
    false,
  );
  assert.equal(f.preface.hidden, true);
  assert.equal(
    f.mode.event({
      type: 'turn.preface',
      turnId: 'current',
      text: '<img src=x>\n' + 'a'.repeat(400),
    }),
    true,
  );
  assert.equal(f.preface.hidden, false);
  assert.equal(f.preface.textContent.length, 280);
  assert.match(f.preface.textContent, /^<img src=x> /);
  f.mode.configure({ enabled: false });
  assert.equal(
    f.preface.hidden,
    false,
    'Changing the next-turn mode does not rewrite the active preface.',
  );
  f.mode.event({ type: 'turn.delta', turnId: 'current', text: 'Final answer' });
  assert.equal(f.preface.hidden, true);
  assert.equal(f.mode.event({ type: 'turn.preface', turnId: 'current', text: 'Late' }), false);
});

test('terminal events and conversation reset remove transient prefaces', () => {
  const f = fixture();
  for (const type of ['turn.completed', 'turn.failed', 'turn.cancelled']) {
    f.mode.begin(type);
    f.mode.event({ type: 'turn.preface', turnId: type, text: 'I will check the details.' });
    f.mode.event({ type, turnId: type });
    assert.equal(f.preface.hidden, true);
    assert.equal(f.mode.prefaceText, '');
  }
  f.mode.begin('reset');
  f.mode.event({ type: 'turn.preface', turnId: 'reset', text: 'Checking.' });
  f.mode.clear();
  assert.equal(f.preface.hidden, true);
  assert.equal(f.mode.turnId, null);
});

test('a public plan opens only on click, survives the answer, and resets on a new request', () => {
  const f = fixture();
  f.mode.begin('math');
  assert.equal(f.mode.event({ type: 'turn.approach', turnId: 'old', text: 'Stale' }), false);
  f.mode.event({
    type: 'turn.preface',
    turnId: 'math',
    text: 'I will compare the two train arrival times.',
  });
  f.mode.event({
    type: 'turn.approach',
    turnId: 'math',
    text: 'Convert the speeds to the same units, then compare their arrival times.',
  });
  assert.equal(f.progress.hidden, false);
  assert.equal(f.approachButton.hidden, false);
  assert.equal(f.approach.hidden, true);
  assert.equal(f.approachButton.attributes['aria-expanded'], 'false');
  f.approachButton.listeners.click();
  assert.equal(f.approach.hidden, false);
  assert.match(f.approach.textContent, /arrival times/);
  assert.equal(f.approachButton.attributes['aria-expanded'], 'true');
  f.mode.event({ type: 'turn.delta', turnId: 'math', text: 'The first train arrives earlier.' });
  f.mode.event({ type: 'turn.completed', turnId: 'math' });
  assert.equal(f.preface.hidden, true);
  assert.equal(f.progress.hidden, false);
  assert.equal(f.approach.hidden, false);
  f.approachButton.listeners.click();
  assert.equal(f.approach.hidden, true);
  f.mode.begin('next');
  assert.equal(f.progress.hidden, true);
  assert.equal(f.approachButton.hidden, true);
  assert.equal(f.approach.textContent, '');
});

test('public plan uses bounded plain text and ignores unknown private events', () => {
  const f = fixture();
  f.mode.begin('current');
  f.mode.event({ type: 'turn.reasoning', turnId: 'current', text: 'Hidden deliberation' });
  assert.equal(f.approachButton.hidden, true);
  f.mode.event({
    type: 'turn.approach',
    turnId: 'current',
    text: '<b>Data</b>\n' + 'a'.repeat(1200),
  });
  assert.equal(f.approach.textContent.length, 900);
  assert.match(f.approach.textContent, /^<b>Data<\/b> /);
  f.mode.clear();
  assert.equal(f.progress.hidden, true);
  assert.equal(f.approach.textContent, '');
});
