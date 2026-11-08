import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  MicrophoneService,
  EchoGuard,
  audioPermission,
} from '../apps/desktop/microphone-service.mjs';
import { PCMFramer } from '../apps/desktop/renderer/microphone-worklet.mjs';
import { MicrophoneClient } from '../apps/desktop/renderer/microphone.mjs';

function fixture(config = {}) {
  const worker = new EventEmitter();
  worker.commands = [];
  worker.child = {};
  worker.send = async (command) => {
    worker.commands.push(command);
  };
  worker.close = () => {};
  const events = [],
    submitted = [],
    interrupted = [];
  const service = new MicrophoneService({
    worker,
    config: { autoSend: true, bargeIn: true, ...config },
    emit: (event) => events.push(event),
    interrupt: () => interrupted.push(true),
    submit: async (value) => submitted.push(value),
  });
  return { service, worker, events, submitted, interrupted };
}
async function enable(f) {
  const state = await f.service.start();
  f.service.confirm(state.sessionId);
  return state.sessionId;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('startup failure survives capture shutdown as a bounded diagnostic', async () => {
  const { worker, service, events } = fixture({ language: 'ru' });
  worker.send = async () => {
    const failure = Object.assign(new Error('private machine path'), { code: 'ASR_START_MODEL' });
    worker.emit('failure', failure);
    throw failure;
  };
  await assert.rejects(service.start(), { code: 'ASR_START_MODEL' });
  assert.equal(service.snapshot().status, 'off');
  const failure = service.diagnostics().lastFailure;
  assert.equal(failure.code, 'ASR_START_MODEL');
  assert.doesNotMatch(failure.message, /private/);
  assert.equal(events.filter(({ type }) => type === 'microphone.error').length, 1);
});

test('microphone diagnostics retain only an allowlisted startup stage on startup failures', async () => {
  for (const startupStage of ['ASR_START_MODEL', 'private path', undefined]) {
    const { worker, service, events } = fixture();
    worker.send = async () => {
      const error = Object.assign(new Error('private exception and machine path'), {
        code: 'ASR_START_NATIVE_CRASH',
        startupStage,
        metadata: 'private extra data',
      });
      worker.emit('failure', error);
      throw error;
    };
    await assert.rejects(service.start(), { code: 'ASR_START_NATIVE_CRASH' });
    const last = service.diagnostics().lastFailure;
    assert.equal(last.code, 'ASR_START_NATIVE_CRASH');
    assert.equal(last.startupStage, startupStage === 'ASR_START_MODEL' ? startupStage : undefined);
    assert(!JSON.stringify(last).includes('private'));
    assert(!JSON.stringify(events).includes('private'));
  }
  const f = fixture();
  await enable(f);
  f.worker.emit(
    'failure',
    Object.assign(new Error('private runtime error'), {
      code: 'ASR_WORKER_EXIT',
      startupStage: 'ASR_START_MODEL',
    }),
  );
  assert.equal(Object.hasOwn(f.service.diagnostics().lastFailure, 'startupStage'), false);
});

test('confirmed overlong turns reset attention quietly while the same microphone and model keep listening', async () => {
  const f = fixture({ wakeWord: { enabled: true, ambiguityHoldMs: 0 } });
  const sessionId = await enable(f),
    child = f.worker.child;
  const pcm = new Uint8Array(new Float32Array(1600).buffer);
  assert.equal(f.service.listenNow(), true);
  for (let utterance = 0; utterance < 4; utterance++) {
    f.worker.emit('activity', { sessionId, phase: 'speech', utterance });
    f.worker.emit('reset', {
      sessionId,
      utterance,
      nextUtterance: utterance + 1,
      reason: 'utterance_limit',
    });
    assert.equal(f.service.snapshot().status, 'listening');
    assert.equal(f.service.snapshot().wakeState, 'waiting');
    assert.equal(f.service.snapshot().recognitionPhase, 'idle');
    assert.equal(f.service.snapshot().sessionId, sessionId);
    assert.equal(f.worker.child, child);
    assert.equal((await f.service.audio({ sessionId, sequence: utterance, pcm })).accepted, true);
    f.worker.emit('transcript', {
      sessionId,
      utterance,
      text: 'Hey Capri, stale instructions',
      final: true,
    });
    f.worker.emit('transcript', {
      sessionId,
      utterance,
      text: 'Hey Capri',
      final: false,
      wakeOnly: true,
    });
    f.worker.emit('activity', { sessionId, phase: 'processing', utterance });
    assert.equal(f.service.snapshot().wakeState, 'waiting');
    assert.equal(f.service.snapshot().recognitionPhase, 'idle');
  }
  await settle();
  assert.deepEqual(f.submitted, []);
  assert.deepEqual(f.interrupted, []);
  assert(!f.events.some((e) => e.type === 'microphone.error'));
  assert(f.events.filter((e) => e.type === 'microphone.partial').every((e) => !e.text));
  assert.equal(f.worker.commands.filter((c) => c.type === 'start').length, 1);
  assert.equal(f.worker.commands.filter((c) => c.type === 'stop').length, 0);
  f.worker.emit('transcript', { sessionId, utterance: 4, text: 'Hey Capri, hello.', final: true });
  await settle();
  assert.equal(f.submitted.length, 1);
  assert.equal(f.submitted[0].text, 'hello.');
  assert.equal(f.service.diagnostics().lastFailure, null);
  f.service.close();
});

test('a reset cancels a pending wake candidate and rejects stale or foreign reset notifications', async () => {
  const f = fixture({ wakeWord: { enabled: true, ambiguityHoldMs: 10 } });
  const sessionId = await enable(f);
  // A fuzzy address is pending; resetting must cancel its delayed activation.
  f.worker.emit('transcript', {
    sessionId,
    utterance: 0,
    text: 'Hey capra',
    final: false,
    wakeOnly: true,
  });
  f.worker.emit('reset', { sessionId, utterance: 0, nextUtterance: 1, reason: 'utterance_limit' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  assert(!f.events.some((e) => e.type === 'microphone.wake'));
  f.worker.emit('transcript', {
    sessionId,
    utterance: 1,
    text: 'Hey Capri',
    final: false,
    wakeOnly: true,
  });
  assert.equal(f.service.snapshot().wakeState, 'command');
  for (const changed of [
    { sessionId: 'old-capture' },
    { utterance: 0, nextUtterance: 1 },
    { utterance: 1, nextUtterance: 2, reason: 'unapproved' },
    { utterance: 1, nextUtterance: 3 },
  ])
    f.worker.emit('reset', {
      sessionId,
      utterance: 0,
      nextUtterance: 1,
      reason: 'utterance_limit',
      ...changed,
    });
  assert.equal(f.service.snapshot().wakeState, 'command');
  f.service.close();
});

test('system-audio review keeps its explicit non-command attention after a bounded reset', async () => {
  const f = fixture({ wakeWord: { enabled: true } });
  const sessionId = await enable(f);
  f.service.enableSystemAudioReview(sessionId, false);
  f.worker.emit('reset', { sessionId, utterance: 0, nextUtterance: 1, reason: 'utterance_limit' });
  await settle();
  assert.equal(f.service.snapshot().systemAudioReview, true);
  assert.equal(f.service.snapshot().wakeState, 'disabled');
  assert.equal(f.service.snapshot().status, 'listening');
  assert.deepEqual(f.worker.commands.at(-1), { type: 'attention', sessionId, active: true });
  f.worker.emit('transcript', {
    sessionId,
    utterance: 1,
    text: 'Background discussion.',
    final: true,
  });
  await settle();
  assert.deepEqual(f.submitted, []);
  assert.equal(f.events.findLast((e) => e.type === 'microphone.partial').autoSend, false);
  f.service.close();
});

test('an unconfirmed legacy utterance-limit error still fails closed instead of keeping poisoned PCM', async () => {
  const f = fixture();
  const sessionId = await enable(f);
  f.worker.send = async () => {
    throw Object.assign(new Error('The spoken phrase is too long.'), {
      code: 'ASR_UTTERANCE_LIMIT',
    });
  };
  await assert.rejects(
    f.service.audio({ sessionId, sequence: 0, pcm: new Uint8Array(new Float32Array(1600).buffer) }),
    { code: 'ASR_UTTERANCE_LIMIT' },
  );
  assert.equal(f.service.snapshot().status, 'off');
  assert(f.events.some((e) => e.type === 'microphone.error'));
});

test('composer stop keeps the recognizer warm; the header can unload it without reopening capture', async () => {
  const calls = [],
    tracks = [];
  const client = new MicrophoneClient({
    api: { stopMicrophone: async (...args) => calls.push(args) },
    onState() {},
    onText() {},
    onInterrupt() {},
    onError: assert.fail,
    onLevel() {},
  });
  client.state = { ...client.state, modelLoaded: true, enabled: true, status: 'listening' };
  client.run = {
    id: 'current',
    queue: [],
    stream: { getTracks: () => [{ stop: () => tracks.push('stopped') }] },
  };
  client.stop(true, { keepModelWarm: true });
  assert.equal(client.run, null);
  assert.equal(client.state.enabled, false);
  assert.equal(client.state.modelLoaded, true);
  assert.deepEqual(tracks, ['stopped']);
  assert.deepEqual(calls, [['current', true]]);
  await client.toggle();
  assert.deepEqual(calls, [['current', true], []]);
  client.settings({ status: 'off', enabled: false, modelLoaded: false });
  assert.equal(client.state.modelLoaded, false);
});

test('manual command listening can rearm without stopping capture or unloading ASR', async () => {
  const f = fixture({ wakeWord: { enabled: true, commandWindowMs: 10000 } });
  const sessionId = await enable(f),
    worker = f.worker.child;
  assert.equal(f.service.listenNow(), true);
  assert.equal(f.service.snapshot().wakeState, 'command');
  f.worker.emit('activity', { sessionId, phase: 'processing', utterance: 0 });
  assert.equal(f.service.listenNow(), true);
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  assert.equal(f.service.snapshot().enabled, true);
  assert.equal(f.service.snapshot().modelLoaded, true);
  assert.equal(f.worker.child, worker);
  assert.equal(f.worker.commands.at(-1).active, false);
  f.worker.emit('transcript', {
    sessionId,
    text: 'cancelled utterance',
    final: true,
    utterance: 0,
  });
  await settle();
  assert.deepEqual(f.submitted, []);
  assert.equal(f.service.listenNow(), true);
  assert.equal(f.service.snapshot().sessionId, sessionId);
  f.service.close();
});

test('PCM worklet frames continuous 16/44.1/48k input without losing samples at render boundaries', () => {
  for (const rate of [16000, 44100, 48000]) {
    const packets = [],
      framer = new PCMFramer(rate, 16000, 1600, (packet) => packets.push(packet));
    const input = Float32Array.from(
      { length: rate * 2 },
      (_, i) => Math.sin((i * 2 * Math.PI * 440) / rate) * 0.5,
    );
    for (let i = 0; i < input.length; i += 128) framer.accept(input.subarray(i, i + 128));
    assert.equal(packets.length, 20);
    assert.ok(packets.every((p) => p.pcm.byteLength === 6400 && p.rms > 0.34 && p.rms < 0.36));
    assert.ok(packets.every((p) => [...new Float32Array(p.pcm)].every(Number.isFinite)));
  }
});
test('PCM sanitizes invalid samples and bounds amplitudes', () => {
  const packets = [],
    framer = new PCMFramer(16000, 16000, 4, (p) => packets.push(p));
  framer.accept([Infinity, NaN, 2, -2]);
  assert.deepEqual([...new Float32Array(packets[0].pcm)], [0, 0, 1, -1]);
});

test('a short IPC stall preserves every audio frame and catches up with bounded packets', async () => {
  let release;
  const delayed = new Promise((resolve) => {
      release = resolve;
    }),
    sent = [],
    errors = [];
  const client = new MicrophoneClient({
    api: {
      microphoneAudio: async (packet) => {
        sent.push(packet);
        if (sent.length === 1) await delayed;
        return { accepted: true };
      },
    },
    onState() {},
    onText() {},
    onInterrupt() {},
    onError: (message) => errors.push(message),
    onLevel() {},
  });
  const run = (client.run = { id: 'capture', queue: [], sequence: 0, pumping: false });
  for (let i = 0; i < 30; i++)
    client.capturePacket(run, { pcm: new Float32Array(1600).fill(i / 64).buffer, rms: 0.1 });
  assert.equal(client.run, run);
  assert.deepEqual(errors, []);
  assert.equal(sent.length, 1);
  release();
  await settle();
  assert.equal(run.queue.length, 0);
  assert.equal(run.pumping, false);
  assert.ok(
    sent.every(
      (p, i) => p.sequence === i && p.sessionId === 'capture' && p.pcm.byteLength <= 12800,
    ),
  );
  const frames = sent.flatMap((p) => {
    const pcm = new Float32Array(p.pcm.buffer, p.pcm.byteOffset, p.pcm.byteLength / 4);
    return Array.from({ length: pcm.length / 1600 }, (_, i) => pcm[i * 1600]);
  });
  assert.deepEqual(
    frames,
    Array.from({ length: 30 }, (_, i) => i / 64),
  );
});

test('sustained microphone congestion still stops visibly instead of dropping audio silently', async () => {
  let release;
  const delayed = new Promise((resolve) => {
      release = resolve;
    }),
    errors = [];
  const client = new MicrophoneClient({
    api: {
      microphoneAudio: async () => {
        await delayed;
        return { accepted: true };
      },
      stopMicrophone: async () => {},
    },
    onState() {},
    onText() {},
    onInterrupt() {},
    onError: (message) => errors.push(message),
    onLevel() {},
  });
  const run = (client.run = { id: 'capture', queue: [], sequence: 0, pumping: false });
  for (let i = 0; i < 60; i++)
    client.capturePacket(run, { pcm: new Float32Array(1600).buffer, rms: 0 });
  assert.equal(client.run, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not keep up/);
  release();
  await settle();
});
test('only a final accurate transcript interrupts and submits once', async () => {
  const f = fixture(),
    sessionId = await enable(f);
  const event = { sessionId, text: 'HELLO CAPRI', utterance: 0, final: false };
  f.worker.emit('transcript', event);
  assert.equal(f.interrupted.length, 0);
  assert.equal(f.submitted.length, 0);
  assert.equal(
    f.events.some((e) => e.type === 'microphone.partial'),
    false,
  );
  f.worker.emit('transcript', { ...event, text: 'Hello Capri, how are you?', final: true });
  f.worker.emit('transcript', { ...event, final: true });
  await settle();
  assert.equal(f.interrupted.length, 1);
  assert.equal(f.submitted.length, 1);
  assert.equal(f.submitted[0].text, 'Hello Capri, how are you?');
});

test('PCM sequence and capture token prevent stale sessions and dropped audio', async () => {
  const f = fixture(),
    sessionId = await enable(f),
    pcm = new Uint8Array(new Float32Array(1600).buffer);
  assert.equal((await f.service.audio({ sessionId, sequence: 0, pcm })).accepted, true);
  assert.equal(f.worker.commands.at(-1).pcm.length, 8536);
  await assert.rejects(
    f.service.audio({ sessionId, sequence: 2, pcm }),
    /Invalid microphone packet/,
  );
  assert.equal(f.service.status, 'off');
  assert.deepEqual(await f.service.audio({ sessionId, sequence: 1, pcm }), { accepted: false });
  f.worker.emit('transcript', { sessionId, text: 'LATE INPUT', final: true, utterance: 1 });
  await settle();
  assert.equal(f.submitted.length, 0);
});

test('late audio after stopping or changing language is dropped without an error or affecting the next capture', async () => {
  const f = fixture(),
    oldSession = await enable(f);
  const pcm = new Uint8Array(new Float32Array(1600).buffer);
  f.service.stop();
  assert.deepEqual(await f.service.audio({ sessionId: oldSession, sequence: 0, pcm }), {
    accepted: false,
  });
  const sessionId = await enable(f);
  assert.notEqual(sessionId, oldSession);
  assert.deepEqual(await f.service.audio({ sessionId: oldSession, sequence: 1, pcm }), {
    accepted: false,
  });
  assert.equal(f.worker.commands.filter((command) => command.type === 'pcm').length, 0);
  assert.equal(
    f.events.some((event) => event.type === 'microphone.error'),
    false,
  );
  assert.deepEqual(await f.service.audio({ sessionId, sequence: 0, pcm }), { accepted: true });
  f.service.stop();
});

test('speech and decoding activity publish status without inventing words', async () => {
  const f = fixture(),
    sessionId = await enable(f);
  f.worker.emit('activity', { sessionId, utterance: 0, phase: 'speech' });
  assert.equal(f.service.snapshot().recognitionPhase, 'speech');
  f.worker.emit('activity', { sessionId, utterance: 0, phase: 'processing' });
  assert.equal(f.service.snapshot().recognitionPhase, 'processing');
  assert.equal(
    f.events.some((e) => e.type === 'microphone.partial'),
    false,
  );
  f.worker.emit('transcript', {
    sessionId,
    utterance: 0,
    text: 'Turn Spotify down to twenty percent.',
    final: true,
  });
  await settle();
  assert.deepEqual(
    f.submitted.map((e) => e.text),
    ['Turn Spotify down to twenty percent.'],
  );
  assert.equal(f.service.snapshot().recognitionPhase, 'idle');
});

test('pause changes configure the existing capture and carry into the next session', async () => {
  const f = fixture(),
    sessionId = await enable(f);
  await f.service.configurePause(3.2);
  assert.equal(f.service.snapshot().sessionId, sessionId);
  assert.equal(f.service.snapshot().trailingSilenceSeconds, 3.2);
  assert.deepEqual(f.worker.commands.at(-1), {
    type: 'configure',
    sessionId,
    trailingSilenceSeconds: 3.2,
  });
  await assert.rejects(f.service.configurePause(0), /Invalid/);
  f.service.stop();
  await enable(f);
  assert.equal(f.worker.commands.at(-1).trailingSilenceSeconds, 3.2);
});

test('empty accurate speech is not sent, and punctuated stop commands still work', async () => {
  const f = fixture(),
    sessionId = await enable(f);
  f.worker.emit('transcript', { sessionId, utterance: 0, text: '', final: true });
  await settle();
  assert.equal(f.submitted.length, 0);
  f.worker.emit('transcript', { sessionId, utterance: 1, text: 'Stop listening.', final: true });
  assert.equal(f.service.status, 'off');
  assert.equal(f.submitted.length, 0);
});

test('a late final or send notification cannot overwrite the current live draft', () => {
  const texts = [],
    client = new MicrophoneClient({
      api: {},
      onState() {},
      onText: (e) => texts.push(e.text),
      onInterrupt() {},
      onError() {},
      onLevel() {},
    });
  client.run = { id: 'capture' };
  client.event({
    type: 'microphone.partial',
    sessionId: 'capture',
    utterance: 1,
    text: 'Current draft',
    final: false,
  });
  client.event({
    type: 'microphone.partial',
    sessionId: 'capture',
    utterance: 0,
    text: 'Late final',
    final: true,
  });
  client.event({ type: 'microphone.sent', utterance: 0 });
  assert.deepEqual(texts, ['Current draft']);
  client.event({ type: 'microphone.sent', utterance: 1 });
  assert.deepEqual(texts, ['Current draft', '']);
});
test('turning capture off invalidates queued sends and allows a fresh session', async () => {
  const f = fixture(),
    sessionId = await enable(f);
  f.worker.emit('transcript', { sessionId, text: 'DO NOT SEND', final: true, utterance: 0 });
  f.service.stop(sessionId);
  await settle();
  assert.equal(f.submitted.length, 0);
  const next = await enable(f);
  assert.notEqual(next, sessionId);
  assert.equal(f.service.stop(sessionId), false);
  assert.equal(f.service.status, 'listening');
});
test('switching off during model startup cannot revive capture or permit media', async () => {
  const f = fixture();
  let release;
  f.worker.send = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const starting = f.service.start();
  assert.equal(f.service.status, 'starting');
  const finishStart = release;
  f.service.stop();
  finishStart();
  release();
  await assert.rejects(starting, /cancelled/);
  assert.equal(f.service.status, 'off');
  assert.equal(f.service.capture, null);
});
test('own playback is filtered, distinct user speech and stop commands can interrupt', async () => {
  const f = fixture(),
    sessionId = await enable(f);
  f.service.playback({ sessionId, speaking: true, text: 'The city can wait five minutes for us.' });
  f.worker.emit('transcript', { sessionId, text: 'THE CITY CAN WAIT', final: true, utterance: 0 });
  await settle();
  assert.equal(f.submitted.length, 0);
  assert.equal(f.interrupted.length, 0);
  f.worker.emit('transcript', {
    sessionId,
    text: 'I WANT TO ASK A DIFFERENT QUESTION',
    final: true,
    utterance: 1,
  });
  assert.equal(f.interrupted.length, 1);
  f.worker.emit('transcript', { sessionId, text: 'STOP', final: true, utterance: 2 });
  await settle();
  assert.equal(f.interrupted.length, 2);
  assert.equal(f.submitted.length, 1);
  f.worker.emit('transcript', { sessionId, text: 'STOP LISTENING', final: true, utterance: 3 });
  assert.equal(f.service.status, 'off');
});
test('echo suppression has a short tail rather than suppressing future conversation', () => {
  let now = 0;
  const guard = new EchoGuard({ now: () => now });
  guard.playback({ speaking: true, text: 'Stay a little longer' });
  guard.playback({ speaking: false });
  assert.equal(guard.matches('STAY A LITTLE'), true);
  assert.equal(guard.matches('STOP'), false);
  now = 1200;
  assert.equal(guard.matches('STAY A LITTLE'), false);
});
test('manual-send mode publishes final text without submitting a model turn', async () => {
  const f = fixture({ autoSend: false }),
    sessionId = await enable(f);
  f.worker.emit('transcript', { sessionId, text: 'DRAFT', final: true, utterance: 0 });
  await settle();
  assert.equal(f.submitted.length, 0);
  assert.equal(f.events.find((e) => e.type === 'microphone.partial').autoSend, false);
});

test('mixed audio stays local in the draft path and cannot wake, interrupt or submit commands', async () => {
  const f = fixture({ wakeWord: { enabled: true, commandWindowMs: 10000 } });
  const sessionId = await enable(f);
  assert.equal(f.service.enableSystemAudioReview('old-id'), false);
  assert.equal(f.service.enableSystemAudioReview(sessionId), true);
  assert.equal(f.service.snapshot().systemAudioReview, true);
  assert.equal(f.service.snapshot().autoSend, false);
  assert.equal(f.service.snapshot().wakeState, 'disabled');
  assert.deepEqual(f.worker.commands.at(-1), { type: 'attention', sessionId, active: true });
  const phrases = ['Hey Capri, launch the browser', 'Stop listening.', 'Stop talking'];
  for (const [utterance, text] of phrases.entries())
    f.worker.emit('transcript', { sessionId, utterance, text, final: true });
  assert.equal(f.service.listenNow(), false);
  assert.equal(f.service.continueListening(5000, sessionId), false);
  await settle();
  const drafts = f.events.filter((e) => e.type === 'microphone.partial');
  assert.deepEqual(
    drafts.map((e) => e.text),
    phrases,
  );
  assert.ok(drafts.every((e) => e.autoSend === false));
  assert.equal(f.service.status, 'listening');
  assert.deepEqual(f.submitted, []);
  assert.deepEqual(f.interrupted, []);
  f.service.stop(sessionId);
  await enable(f);
  assert.equal(f.service.snapshot().systemAudioReview, false);
  assert.equal(f.service.snapshot().autoSend, true);
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  f.service.close();
});

test('mixed wake consent sends addressed speech without microphone control or interruption', async () => {
  const f = fixture({ wakeWord: { enabled: false } });
  const sessionId = await enable(f);
  assert.equal(f.service.enableSystemAudioReview(sessionId, true), true);
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  assert.equal(f.service.snapshot().systemAudioWake, true);
  assert.equal(f.service.snapshot().autoSend, true);
  const speak = (utterance, text, extra = {}) =>
    f.worker.emit('transcript', { sessionId, utterance, text, final: true, ...extra });
  speak(0, 'This is ordinary background conversation.');
  assert.equal(f.events.filter(({ type }) => type === 'microphone.partial').length, 0);
  speak(1, 'Capri', { final: false, wakeOnly: true });
  assert.equal(f.service.snapshot().wakeState, 'command');
  assert.equal(f.events.filter(({ type }) => type === 'microphone.wake').length, 1);
  speak(1, 'Capri');
  speak(2, 'Turn off the microphone');
  const drafts = f.events.filter(({ type, text }) => type === 'microphone.partial' && text);
  assert.deepEqual(
    drafts.map(({ text, autoSend }) => [text, autoSend]),
    [['Turn off the microphone', true]],
  );
  assert.equal(f.service.status, 'listening');
  assert.equal(f.service.snapshot().wakeState, 'waiting');
  await settle();
  assert.deepEqual(
    f.submitted.map(({ text }) => text),
    ['Turn off the microphone'],
  );
  assert.deepEqual(f.interrupted, []);
  f.service.close();
});
test('media permission is only audio, only the armed companion main frame', () => {
  const owner = { getURL: () => 'capri://desktop/index.html' };
  const input = {
    armed: true,
    owner,
    contents: owner,
    permission: 'media',
    origin: 'capri://desktop',
    details: { mediaType: 'audio' },
  };
  assert.equal(audioPermission(input), true);
  assert.equal(audioPermission({ ...input, armed: false }), false);
  assert.equal(audioPermission({ ...input, contents: {} }), false);
  assert.equal(audioPermission({ ...input, origin: 'https://example.com' }), false);
  assert.equal(audioPermission({ ...input, details: { mediaType: 'video' } }), false);
  assert.equal(
    audioPermission({ ...input, details: { mediaType: 'audio', isMainFrame: false } }),
    false,
  );
  assert.equal(
    audioPermission({ ...input, request: true, details: { mediaTypes: ['audio'] } }),
    true,
  );
  assert.equal(
    audioPermission({ ...input, request: true, details: { mediaTypes: ['audio', 'video'] } }),
    false,
  );
});

test('device listing permits trusted audio metadata checks without permitting capture while off', () => {
  const owner = { getURL: () => 'capri://desktop/index.html' };
  const input = {
    armed: false,
    listingDevices: true,
    owner,
    contents: owner,
    permission: 'media',
    origin: 'capri://desktop',
    details: { mediaType: 'audio' },
  };
  assert.equal(audioPermission(input), true);
  assert.equal(audioPermission({ ...input, listingDevices: false }), false);
  assert.equal(
    audioPermission({ ...input, request: true, details: { mediaTypes: ['audio'] } }),
    false,
  );
  assert.equal(audioPermission({ ...input, details: { mediaType: 'video' } }), false);
  assert.equal(audioPermission({ ...input, contents: {} }), false);
  assert.equal(
    audioPermission({ ...input, details: { mediaType: 'audio', isMainFrame: false } }),
    false,
  );
  assert.equal(audioPermission({ ...input, origin: 'https://example.com' }), false);
});
