import assert from 'node:assert/strict';
import test from 'node:test';
import { ReplyVisibility } from '../apps/desktop/renderer/reply-visibility.mjs';
function fixture() {
  let clock = 0,
    sequence = 0;
  const pending = new Map(),
    changes = [];
  const controller = new ReplyVisibility({
    onChange: (value) => changes.push(value),
    setTimer: (callback, delay) => {
      const id = ++sequence;
      pending.set(id, { callback, at: clock + delay });
      return id;
    },
    clearTimer: (id) => pending.delete(id),
  });
  const advance = (ms) => {
    clock += ms;
    for (const [id, entry] of pending)
      if (entry.at <= clock) {
        pending.delete(id);
        entry.callback();
      }
  };
  const reply = (id = 'one', status = 'complete', speech = true) =>
    controller.update({ turnId: id, status, text: 'A short response.' }, speech);
  return { controller, pending, changes, advance, reply };
}
test('text completion and generated audio never hide a reply before the last sentence has played', () => {
  const { controller, pending, advance, reply } = fixture();
  reply();
  assert.equal(pending.size, 0);
  controller.playback('one', true);
  controller.generated('one');
  advance(60000);
  assert.equal(controller.hidden, false);
  controller.playback('one', false);
  advance(7999);
  assert.equal(controller.hidden, false);
  advance(1);
  assert.equal(controller.hidden, true);
});
test('text-only replies use one timer, and repeated rendering cannot postpone it indefinitely', () => {
  const { controller, pending, advance, reply } = fixture();
  reply('one', 'complete', false);
  advance(4000);
  reply('one', 'complete', false);
  assert.equal(pending.size, 1);
  advance(4000);
  assert.equal(controller.hidden, true);
});
test('hover, selection and history pause dismissal without a polling timer', () => {
  const { controller, pending, advance, reply } = fixture();
  reply('one', 'complete', false);
  controller.hold('hover', true);
  controller.hold('history', true);
  assert.equal(pending.size, 0);
  advance(60000);
  assert.equal(controller.hidden, false);
  controller.hold('hover', false);
  assert.equal(pending.size, 0);
  controller.hold('history', false);
  advance(8000);
  assert.equal(controller.hidden, true);
});
test('a new turn, cancellation and late events cannot hide a different response', () => {
  const { controller, pending, advance, reply } = fixture();
  reply('one', 'complete', false);
  advance(7000);
  reply('two', 'streaming');
  controller.generated('one');
  controller.playback('one', false);
  advance(60000);
  assert.equal(controller.hidden, false);
  assert.equal(pending.size, 0);
  reply('two', 'complete');
  controller.protect('two');
  controller.generated('two');
  advance(60000);
  assert.equal(controller.hidden, false);
});
test('errors remain visible, manual reveal stays open and disabling the option restores hidden text', () => {
  const { controller, pending, advance, reply } = fixture();
  reply('one', 'error', false);
  advance(60000);
  assert.equal(pending.size, 0);
  reply('two', 'complete', false);
  advance(8000);
  assert.equal(controller.hidden, true);
  controller.reveal();
  advance(60000);
  assert.equal(controller.hidden, false);
  reply('three', 'complete', false);
  advance(8000);
  assert.equal(controller.hidden, true);
  controller.configure({ replyAutoHide: false });
  assert.equal(controller.hidden, false);
  controller.dispose();
  assert.equal(pending.size, 0);
});

test('manual collapse survives same-turn streaming, speech, errors and auto-hide settings until reopened', () => {
  const { controller, pending, reply } = fixture();
  reply('one', 'streaming', true);
  controller.hide();
  assert.equal(controller.hidden, true);
  reply('one', 'complete', true);
  controller.expectSpeech('one');
  controller.playback('one', true);
  controller.protect('one');
  controller.configure({ replyAutoHide: false });
  assert.equal(controller.hidden, true);
  assert.equal(pending.size, 0);
  controller.reveal();
  assert.equal(controller.hidden, false);
  controller.hide();
  reply('two', 'streaming', false);
  assert.equal(controller.hidden, false);
  assert.equal(controller.manual, false);
});

test('restored auto-hide defaults apply to the next reply without dismissing the current reset-time answer', () => {
  const { controller, advance, reply } = fixture();
  controller.configure({ replyAutoHide: false });
  reply('before-reset', 'complete', false);
  advance(60000);
  controller.configure({ replyAutoHide: true, replyAutoHideSeconds: 8 });
  controller.reveal();
  advance(60000);
  assert.equal(controller.hidden, false);
  reply('after-reset', 'complete', false);
  advance(7999);
  assert.equal(controller.hidden, false);
  advance(1);
  assert.equal(controller.hidden, true);
});
