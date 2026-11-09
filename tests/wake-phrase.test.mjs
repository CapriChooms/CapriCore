import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { findWakePhrase, WakePhraseGate } from '../apps/desktop/wake-phrase.mjs';
import { MicrophoneService } from '../apps/desktop/microphone-service.mjs';
import { MicrophoneClient } from '../apps/desktop/renderer/microphone.mjs';
import { PresenceModel } from '../apps/desktop/renderer/presence-model.mjs';

const options = { enabled: true, commandWindowMs: 3000, ambiguityHoldMs: 15 };
async function fixture() {
  const worker = new EventEmitter();
  worker.send = async () => {};
  worker.close = () => {};
  const events = [],
    submitted = [],
    interrupted = [];
  const service = new MicrophoneService({
    worker,
    config: { wakeWord: options, autoSend: true, bargeIn: true },
    emit: (event) => events.push(event),
    submit: async (value) => submitted.push(value),
    interrupt: () => interrupted.push(true),
  });
  const capture = await service.start();
  service.confirm(capture.sessionId);
  const emit = (utterance, text, extra = {}) =>
    worker.emit('transcript', {
      sessionId: capture.sessionId,
      utterance,
      text,
      final: false,
      wakeOnly: !extra.final,
      ...extra,
    });
  return { worker, service, events, submitted, interrupted, emit, sessionId: capture.sessionId };
}

test('wake matcher tolerates phonetic and spacing errors but rejects ordinary near phrases', () => {
  for (const phrase of [
    'Hey, Capri',
    'HAY CAPREE',
    'hey kapry',
    'hey cap free',
    'hey cat free',
    'hey cappy',
    'hey caprice',
    'HeyCapri',
    'эй капри',
  ]) {
    const match = findWakePhrase(phrase + ', play music.');
    assert.ok(match, phrase);
    assert.equal(match.body, 'play music.', phrase);
  }
  for (const phrase of [
    'Hey, can we play music?',
    'hey captain',
    'hey camera',
    'a cup of tea',
    'I visited Capri',
    'hey coffee',
    'hey cap',
  ])
    assert.equal(findWakePhrase(phrase), null, phrase);
});

test('fuzzy wake uses a short stability hold, cancels revised candidates and cannot revive a closed gate', async () => {
  const wakes = [],
    ready = [],
    gate = new WakePhraseGate(options, {
      onWake: (e) => wakes.push(e),
      onReady: (e) => ready.push(e),
    });
  const draft = (text) => ({ utterance: 0, text, final: false });
  gate.observe(draft('hey cappy'));
  gate.observe(draft('hey captain'));
  await delay(25);
  assert.equal(wakes.length, 0);
  gate.observe(draft('hey cappy, turn it down'));
  await delay(25);
  assert.equal(wakes.length, 1);
  assert.equal(ready.length, 1);
  assert.equal(gate.observe(draft('Hey Capri, turn it down.')).text, 'turn it down.');
  gate.rearm(0);
  assert.equal(gate.snapshot().wakeState, 'waiting');
  gate.observe({ ...draft('hey cappy'), utterance: 1 });
  gate.close();
  await delay(25);
  assert.equal(wakes.length, 1);
});

test('a bare Capri address tolerates ASR variants but does not match embedded mentions or common commands', () => {
  for (const name of [
    'Capri',
    'CAPREE',
    'Kapry',
    'Cabrie',
    'cappy',
    'cap rice',
    'cat free',
    'ka pri',
    'Капри',
    'кэппи',
  ]) {
    const match = findWakePhrase(name + ', play music.');
    assert.ok(match, name);
    assert.equal(match.body, 'play music.', name);
  }
  for (const text of [
    'I visited Capri',
    'What did Capri say?',
    'copy the file',
    'coffee please',
    'captain',
    'cap',
    'happy now',
  ]) {
    assert.equal(findWakePhrase(text), null, text);
  }
  const gate = new WakePhraseGate(options);
  gate.observe({ utterance: 0, text: 'Capri, copy the file.', final: false });
  assert.equal(
    gate.observe({ utterance: 0, text: 'Copy the file.', final: true }).text,
    'Copy the file.',
  );
  gate.close();
});

test('a bare name activates once, strips the address and sends only the accurate command', async () => {
  const f = await fixture();
  f.emit(0, 'CAPPY', { final: false });
  await delay(25);
  f.emit(0, 'Capri.', { final: true });
  assert.equal(f.events.filter((e) => e.type === 'microphone.wake').length, 1);
  assert.equal(f.service.snapshot().wakeState, 'command');
  f.emit(1, 'Copy that file.', { final: true });
  await delay(0);
  assert.deepEqual(
    f.submitted.map((e) => e.text),
    ['Copy that file.'],
  );
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  f.service.stop();
});

test('manual listening treats Capri as ordinary text across interim and final transcripts', () => {
  for (const phrase of [
    'Capri, play music.',
    'Hey Capri, tell me what Capri means.',
    'Капри, расскажи о себе.',
    'Эй Капри, какая сегодня погода?',
    'Tell me, hey Capri, how this works.',
  ]) {
    const wakes = [],
      gate = new WakePhraseGate(options, { onWake: (event) => wakes.push(event) });
    try {
      assert.equal(gate.continueListening(), true);
      assert.deepEqual(gate.observe({ utterance: 0, text: 'Capri', final: false }), {
        accepted: true,
        text: 'Capri',
      });
      assert.deepEqual(gate.observe({ utterance: 0, text: phrase, final: true }), {
        accepted: true,
        text: phrase,
      });
      assert.equal(gate.snapshot().wakeState, 'command');
      assert.equal(wakes.length, 0);
    } finally {
      gate.close();
    }
  }
});

test('a manually activated microphone sends the complete name-containing request without waking again', async () => {
  for (const phrase of ['Hey Capri, play music.', 'Капри, расскажи про Капри.']) {
    const f = await fixture();
    try {
      assert.equal(f.service.listenNow(), true);
      f.emit(0, 'Capri');
      assert.equal(f.service.snapshot().wakeState, 'command');
      assert.equal(f.events.filter((event) => event.type === 'microphone.wake').length, 1);
      f.emit(0, phrase, { final: true });
      await f.service.tail;
      assert.deepEqual(
        f.submitted.map((value) => value.text),
        [phrase],
      );
      assert.equal(f.events.filter((event) => event.type === 'microphone.wake').length, 1);
      assert.equal(f.service.snapshot().wakeState, 'waiting');
    } finally {
      f.service.stop();
    }
  }
});

test('the utterance after a keyword-only wake and follow-up listening preserve further names', () => {
  const wakes = [],
    gate = new WakePhraseGate(options, { onWake: (event) => wakes.push(event) });
  try {
    assert.equal(gate.observe({ utterance: 0, text: 'Hey Capri.', final: true }).text, '');
    assert.equal(
      gate.observe({ utterance: 1, text: 'Capri, tell me more.', final: true }).text,
      'Capri, tell me more.',
    );
    assert.equal(wakes.length, 1);
    gate.rearm(1);
    gate.continueListening();
    assert.equal(
      gate.observe({ utterance: 2, text: 'Hey Capri, continue.', final: true }).text,
      'Hey Capri, continue.',
    );
    assert.equal(wakes.length, 1);
  } finally {
    gate.close();
  }
});

test('ambient speech is neither sent nor previewed; wake opens promptly and one accurate command rearms it', async () => {
  const f = await fixture();
  f.emit(0, 'PLAY MUSIC', { final: true });
  await delay(0);
  assert.equal(f.submitted.length, 0);
  assert.equal(f.interrupted.length, 0);
  assert.equal(
    f.events.some((e) => e.type === 'microphone.partial'),
    false,
  );
  f.emit(1, 'HEY CAPRI TURN SPOT IF I DOWN');
  assert.equal(f.events.filter((e) => e.type === 'microphone.wake').length, 1);
  assert.equal(f.interrupted.length, 1);
  assert.equal(
    f.events.some((e) => e.type === 'microphone.partial' && e.text),
    false,
  );
  f.emit(1, 'Hey, Capri, turn Spotify down.', { final: true });
  await delay(0);
  assert.deepEqual(
    f.submitted.map((e) => e.text),
    ['turn Spotify down.'],
  );
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  f.emit(2, 'PLAY THE NEXT SONG', { final: true });
  await delay(0);
  assert.equal(f.submitted.length, 1);
  f.service.stop();
});

test('keyword-only wake accepts the following utterance; echoes and late final results cannot wake it', async () => {
  const f = await fixture();
  f.service.playback({
    sessionId: f.sessionId,
    speaking: true,
    text: 'Say Hey Capri to talk to me.',
  });
  f.emit(0, 'HEY CAPRI');
  assert.equal(
    f.events.some((e) => e.type === 'microphone.wake'),
    false,
  );
  f.service.playback({ sessionId: f.sessionId, speaking: false, text: '' });
  f.service.echo.history = [];
  f.emit(1, 'HEY CAPRI');
  f.emit(1, 'Hey Capri.', { final: true });
  assert.equal(f.service.snapshot().wakeState, 'command');
  assert.equal(f.submitted.length, 0);
  f.emit(2, 'What time is it?', { final: true });
  await delay(0);
  assert.equal(f.submitted[0].text, 'What time is it?');
  f.emit(1, 'HEY CAPRI', { final: true });
  assert.equal(f.events.filter((e) => e.type === 'microphone.wake').length, 1);
  f.emit(3, 'Stop listening.', { final: true });
  assert.equal(f.service.snapshot().enabled, false);
});

test('a confirmed timed wake is forwarded to the worker and the command is never stripped twice', async () => {
  const f = await fixture();
  const commands = [];
  f.worker.send = async (value) => commands.push(value);
  f.emit(0, 'Capri', { boundaries: [{ start: 0, end: 5, startSample: 1280, endSample: 10240 }] });
  assert.ok(
    commands.some((c) => c.type === 'attention' && c.wakeEndSample === 10240 && c.utterance === 0),
  );
  f.emit(0, 'Copy that file.', { final: true, prefixRemoved: true });
  await delay(0);
  assert.deepEqual(
    f.submitted.map((e) => e.text),
    ['Copy that file.'],
  );
  f.service.stop();
});

test('wake raises a collapsed companion only for the active microphone session', () => {
  const presence = new PresenceModel();
  presence.phase = 'ready';
  presence.wake = true;
  assert.equal(presence.snapshot().expanded, false);
  assert.equal(presence.snapshot().state, 'wake');
  const client = new MicrophoneClient({
    api: {},
    onState() {},
    onText() {},
    onError() {},
    onInterrupt() {},
    onLevel() {},
    onWake: () => presence.wakeUp(),
  });
  client.run = { id: 'current' };
  client.event({ type: 'microphone.wake', sessionId: 'old' });
  assert.equal(presence.expanded, false);
  client.event({ type: 'microphone.wake', sessionId: 'current' });
  assert.equal(presence.expanded, true);
  presence.begin('addressed-voice-turn');
  assert.equal(presence.expanded, true);
});

test('an unused wake window expires and ignores late results from that utterance', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = new WakePhraseGate(options);
  gate.observe({ utterance: 0, text: 'Hey Capri', final: false });
  t.mock.timers.tick(1000);
  gate.observe({ utterance: 0, text: 'Hey Capri', final: false, refining: true });
  t.mock.timers.tick(2001);
  assert.equal(gate.snapshot().wakeState, 'waiting');
  assert.equal(
    gate.observe({ utterance: 0, text: 'Hey Capri, play music.', final: true }).accepted,
    false,
  );
  gate.close();
});
