// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { MicrophoneService } from '../apps/desktop/microphone-service.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function fixture(t, config = {}, submit) {
  const worker = new EventEmitter();
  worker.child = {};
  worker.commands = [];
  worker.send = async (command) => worker.commands.push(command);
  worker.close = () => {};
  const events = [],
    submitted = [],
    interrupted = [];
  const service = new MicrophoneService({
    worker,
    config: {
      autoSend: true,
      bargeIn: true,
      wakeWord: { enabled: false, ambiguityHoldMs: 0 },
      ...config,
    },
    emit: (event) => events.push(event),
    interrupt: () => interrupted.push(true),
    submit: async (value, current) => {
      submitted.push(value);
      await submit?.(value, current);
    },
  });
  t.after(() => service.close());
  const { sessionId } = await service.start();
  service.confirm(sessionId);
  const speak = (utterance, text, extra = {}) =>
    worker.emit('transcript', {
      sessionId,
      utterance,
      text,
      final: true,
      ...extra,
    });
  const drafts = () => events.filter((event) => event.type === 'microphone.partial' && event.text);
  return { worker, service, events, submitted, interrupted, sessionId, speak, drafts };
}

test('mixed wake sends one addressed final reply without requiring a manual Send', async (t) => {
  for (const [phrase, expected] of [
    ['Capri, hello there', 'hello there'],
    ['Капри, привет', 'привет'],
  ]) {
    const f = await fixture(t);
    assert.equal(f.service.enableSystemAudioReview(f.sessionId, true), true);
    assert.equal(f.service.snapshot().autoSend, true);
    assert.equal(f.service.snapshot().wakeState, 'waiting');
    f.speak(0, phrase, { final: false });
    assert.equal(f.drafts().length, 0);
    f.speak(0, phrase);
    f.speak(0, phrase);
    await settle();
    assert.deepEqual(
      f.submitted.map(({ text }) => text),
      [expected],
    );
    assert.equal(f.drafts().at(-1).autoSend, true);
    assert.equal(f.service.snapshot().wakeState, 'waiting');
    assert.equal(f.events.filter(({ type }) => type === 'microphone.sent').length, 1);
  }
});

test('mixed wake accepts a name-only wake probe followed by the next final utterance', async (t) => {
  const f = await fixture(t);
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.speak(0, 'Capri', { final: false, wakeOnly: true });
  f.speak(0, 'Capri');
  assert.equal(f.service.snapshot().wakeState, 'command');
  f.speak(1, 'Tell me a short joke');
  await settle();
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['Tell me a short joke'],
  );
  assert.equal(f.events.filter(({ type }) => type === 'microphone.wake').length, 1);
  assert.equal(f.service.snapshot().wakeState, 'waiting');
});

test('mixed background speech stays out of chat before wake and after a sent reply', async (t) => {
  const f = await fixture(t);
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.speak(0, 'We are discussing tomorrow plans.');
  f.speak(1, 'Hey Capri, say hello');
  await settle();
  f.speak(2, 'More ordinary background conversation.');
  await settle();
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['say hello'],
  );
  assert.deepEqual(
    f.drafts().map(({ text }) => text),
    ['say hello'],
  );
  assert.equal(f.service.continueListening(5000, f.sessionId), false);
  assert.equal(f.service.listenNow(), false);
});

test('review-only mixed audio and manual-send mode continue to publish drafts only', async (t) => {
  for (const options of [
    { wake: false, autoSend: true },
    { wake: true, autoSend: false },
  ]) {
    const f = await fixture(t, { autoSend: options.autoSend });
    f.service.enableSystemAudioReview(f.sessionId, options.wake);
    f.speak(0, 'Capri, keep this as a draft');
    await settle();
    assert.deepEqual(f.submitted, []);
    assert.equal(f.service.snapshot().autoSend, false);
    assert.equal(f.drafts().length, 1);
    assert.equal(f.drafts()[0].autoSend, false);
    assert.equal(f.service.status, 'listening');
  }
});

test('mixed wake does not turn background audio into barge-in or local microphone-stop commands', async (t) => {
  const f = await fixture(t);
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.speak(0, 'Capri, tell me about stars');
  await settle();
  f.speak(1, 'Capri, turn off the microphone');
  await settle();
  assert.equal(f.service.status, 'listening');
  assert.deepEqual(f.interrupted, []);
  assert.equal(
    f.events.some(({ type }) => type === 'microphone.stop-request'),
    false,
  );
  assert.equal(
    f.events.some(({ type }) => type === 'microphone.interrupt'),
    false,
  );
  assert.equal(f.submitted[0]?.text, 'tell me about stars');
});

test('mixed wake filters Capri playback and its tail while allowing a distinct addressed request', async (t) => {
  const f = await fixture(t);
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.service.playback({
    sessionId: f.sessionId,
    speaking: true,
    text: 'Capri, the neon streets can wait for us.',
  });
  f.speak(0, 'Capri, the neon streets can wait for us.');
  f.service.playback({ sessionId: f.sessionId, speaking: false, text: '' });
  f.speak(1, 'Capri, the neon streets can wait for us.');
  f.speak(2, 'Capri, what time is it');
  await settle();
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['what time is it'],
  );
  assert.deepEqual(
    f.drafts().map(({ text }) => text),
    ['what time is it'],
  );
});

test('stopping a mixed session cancels queued sending and ignores late results after restart', async (t) => {
  const f = await fixture(t);
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.speak(0, 'Capri, cancel this pending request');
  f.service.stop(f.sessionId);
  const next = await f.service.start();
  f.service.confirm(next.sessionId);
  f.service.enableSystemAudioReview(next.sessionId, true);
  f.speak(1, 'Capri, this is an obsolete session');
  f.worker.emit('transcript', {
    sessionId: next.sessionId,
    utterance: 0,
    final: true,
    text: 'Capri, a fresh request',
  });
  await settle();
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['a fresh request'],
  );
});

test('changing mixed input policy revokes pending sends even if wake is immediately enabled again', async (t) => {
  for (const startedMixed of [false, true]) {
    const f = await fixture(t);
    if (startedMixed) f.service.enableSystemAudioReview(f.sessionId, true);
    f.speak(
      0,
      startedMixed ? 'Capri, revoke this old request' : 'Revoke this normal-microphone request',
    );
    f.service.enableSystemAudioReview(f.sessionId, false);
    f.service.enableSystemAudioReview(f.sessionId, true);
    await settle();
    assert.deepEqual(f.submitted, []);
    f.speak(1, 'Capri, this new request is allowed');
    await settle();
    assert.deepEqual(
      f.submitted.map(({ text }) => text),
      ['this new request is allowed'],
    );
  }
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const f = await fixture(t, {}, async (_value, current) => {
    entered.resolve(current);
    await release.promise;
  });
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.speak(0, 'Capri, revoke this in-progress request');
  const current = await entered.promise;
  assert.equal(current(), true);
  f.service.enableSystemAudioReview(f.sessionId, false);
  f.service.enableSystemAudioReview(f.sessionId, true);
  assert.equal(current(), false, 'The same policy cannot resurrect a revoked send callback.');
  release.resolve();
  await settle();
  assert.equal(
    f.events.some(({ type }) => type === 'microphone.sent'),
    false,
  );
});

test('an utterance-limit reset retains mixed wake auto-send and discards the old utterance', async (t) => {
  const f = await fixture(t);
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.worker.emit('activity', { sessionId: f.sessionId, utterance: 0, phase: 'speech' });
  f.worker.emit('reset', {
    sessionId: f.sessionId,
    utterance: 0,
    nextUtterance: 1,
    reason: 'utterance_limit',
  });
  f.speak(0, 'Capri, stale discarded request');
  f.speak(1, 'Capri, a new short request');
  await settle();
  assert.equal(f.service.snapshot().autoSend, true);
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['a new short request'],
  );
  assert.equal(f.service.snapshot().wakeState, 'waiting');
});

test('failed mixed wake submission keeps the recognized draft and reports the send failure', async (t) => {
  const f = await fixture(t, {}, async () => {
    throw new Error('synthetic transport failure');
  });
  f.service.enableSystemAudioReview(f.sessionId, true);
  f.speak(0, 'Capri, preserve this recognized text');
  await settle();
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['preserve this recognized text'],
  );
  assert.equal(f.drafts().at(-1).text, 'preserve this recognized text');
  assert.equal(f.events.filter(({ type }) => type === 'microphone.error').length, 1);
  assert.equal(
    f.events.some(({ type }) => type === 'microphone.sent'),
    false,
  );
});
