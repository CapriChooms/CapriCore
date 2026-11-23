// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { CallAudioDiagnostics } from '../apps/desktop/main/call-audio-diagnostics.mjs';

const speechKeys = [
  'requested',
  'explicit',
  'model',
  'toCall',
  'toOwner',
  'started',
  'audioGenerated',
  'generationCompleted',
  'playbackReported',
  'playbackEnded',
  'cancelled',
  'failed',
  'rejected',
];
const stateKeys = [
  'supported',
  'outputReady',
  'mixingMic',
  'allowModel',
  'shareReplies',
  'voiceEnabled',
];
const speech = (changes = {}) => ({
  ...Object.fromEntries(speechKeys.map((key) => [key, false])),
  ...changes,
});
const setup = (changes = {}) => ({
  phase: 'idle',
  busy: false,
  cableFound: false,
  lastFailure: null,
  ...changes,
});
function assertSnapshot(value) {
  assert.deepEqual(Object.keys(value).sort(), [...stateKeys, 'setup', 'lastSpeech'].sort());
  assert.deepEqual(
    Object.keys(value.setup).sort(),
    ['phase', 'busy', 'cableFound', 'lastFailure'].sort(),
  );
  assert.deepEqual(Object.keys(value.lastSpeech).sort(), [...speechKeys].sort());
  for (const key of stateKeys) assert.equal(typeof value[key], 'boolean', key);
  for (const key of speechKeys) assert.equal(typeof value.lastSpeech[key], 'boolean', key);
}

test('call audio diagnostics default to a fixed all-false snapshot', () => {
  const diagnostics = new CallAudioDiagnostics();
  const value = diagnostics.snapshot();
  assertSnapshot(value);
  assert.deepEqual(value, {
    ...Object.fromEntries(stateKeys.map((key) => [key, false])),
    setup: setup(),
    lastSpeech: speech(),
  });
  diagnostics.observe({ type: 'voice.audio', turnId: 'unrequested' });
  diagnostics.observe({ type: 'voice.generated', turnId: 'unrequested' });
  diagnostics.playback(true, 'unrequested');
  assert.deepEqual(diagnostics.snapshot(), value);
});

test('snapshot maps output readiness and exposes only fixed boolean state', () => {
  const diagnostics = new CallAudioDiagnostics();
  const value = diagnostics.snapshot({
    supported: true,
    callOutputReady: true,
    outputReady: false,
    mixingMic: true,
    allowModel: true,
    shareReplies: true,
    voiceEnabled: true,
    text: 'private message',
    label: 'private microphone label',
    deviceId: 'private-device-id',
    pcm: new Uint8Array([1, 2, 3]),
    unrelated: { nested: 'private details' },
  });
  assertSnapshot(value);
  assert.deepEqual(value, {
    ...Object.fromEntries(stateKeys.map((key) => [key, true])),
    setup: setup(),
    lastSpeech: speech(),
  });
  assert.equal(diagnostics.snapshot({ outputReady: true }).outputReady, false);
});

test('requests record explicit routes and reset every previous speech flag', () => {
  const diagnostics = new CallAudioDiagnostics();
  diagnostics.request('first-private-id', { explicit: true, toCall: true, toOwner: false });
  diagnostics.start('first-private-id');
  diagnostics.observe({ type: 'voice.audio', turnId: 'first-private-id' });
  diagnostics.observe({ type: 'voice.generated', turnId: 'first-private-id' });
  diagnostics.playback(true, 'first-private-id');
  diagnostics.playback(false, 'first-private-id');
  assert.equal(diagnostics.snapshot().lastSpeech.playbackEnded, true);

  diagnostics.request('second-private-id');
  assert.deepEqual(diagnostics.snapshot().lastSpeech, speech({ requested: true, toOwner: true }));
  diagnostics.start('second-private-id', { toCall: true, toOwner: false });
  assert.deepEqual(
    diagnostics.snapshot().lastSpeech,
    speech({ requested: true, started: true, toCall: true }),
  );
});

test('generated audio, completed generation and reported playback remain distinct', () => {
  const diagnostics = new CallAudioDiagnostics();
  const id = 'private-playback-id';
  diagnostics.request(id, { explicit: true, toCall: true, toOwner: false });
  diagnostics.start(id);
  diagnostics.playback(true, id);
  diagnostics.playback(false, id);
  assert.equal(diagnostics.snapshot().lastSpeech.playbackReported, false);
  assert.equal(diagnostics.snapshot().lastSpeech.playbackEnded, false);

  diagnostics.observe({ type: 'voice.audio', turnId: id, text: 'private text', pcm: [1, 2, 3] });
  assert.deepEqual(
    diagnostics.snapshot().lastSpeech,
    speech({ requested: true, explicit: true, toCall: true, started: true, audioGenerated: true }),
  );
  diagnostics.observe({ type: 'voice.generated', turnId: id });
  assert.equal(diagnostics.snapshot().lastSpeech.generationCompleted, true);
  assert.equal(diagnostics.snapshot().lastSpeech.playbackReported, false);
  diagnostics.playback(true, id);
  assert.equal(diagnostics.snapshot().lastSpeech.playbackReported, true);
  assert.equal(diagnostics.snapshot().lastSpeech.playbackEnded, false);
  diagnostics.playback(false, id);
  const ended = diagnostics.snapshot();
  assert.equal(ended.lastSpeech.playbackEnded, true);
  diagnostics.observe({ type: 'voice.cancelled', turnId: id });
  diagnostics.observe({ type: 'voice.audio', turnId: id });
  diagnostics.playback(true, id);
  assert.deepEqual(diagnostics.snapshot(), ended);
});

test('generation without an audio event cannot count as playback', () => {
  const diagnostics = new CallAudioDiagnostics();
  diagnostics.request('no-audio');
  diagnostics.start('no-audio');
  diagnostics.observe({ type: 'voice.generated', turnId: 'no-audio' });
  diagnostics.playback(true, 'no-audio');
  diagnostics.playback(false, 'no-audio');
  assert.deepEqual(
    diagnostics.snapshot().lastSpeech,
    speech({ requested: true, toOwner: true, started: true, generationCompleted: true }),
  );
});

test('stale request identifiers cannot start, terminate or report playback for the latest request', () => {
  const diagnostics = new CallAudioDiagnostics();
  diagnostics.request('old-id', { explicit: true, toCall: true });
  diagnostics.start('old-id');
  diagnostics.observe({ type: 'voice.audio', turnId: 'old-id' });
  diagnostics.request('latest-id', { model: true });
  diagnostics.start('wrong-id', { toCall: true, toOwner: false });
  const pending = diagnostics.snapshot();
  assert.deepEqual(pending.lastSpeech, speech({ requested: true, model: true, toOwner: true }));
  for (const id of ['old-id', 'wrong-id', undefined]) {
    diagnostics.start(id);
    diagnostics.reject(id);
    diagnostics.cancel(id);
    diagnostics.fail(id);
    for (const type of ['voice.audio', 'voice.generated', 'voice.cancelled'])
      diagnostics.observe({ type, turnId: id });
    diagnostics.playback(true, id);
    diagnostics.playback(false, id);
  }
  assert.deepEqual(diagnostics.snapshot(), pending);
  diagnostics.start('latest-id');
  diagnostics.observe({ type: 'voice.audio', turnId: 'latest-id' });
  diagnostics.playback(true, 'old-id');
  assert.equal(diagnostics.snapshot().lastSpeech.playbackReported, false);
  diagnostics.playback(true, 'latest-id');
  assert.equal(diagnostics.snapshot().lastSpeech.playbackReported, true);
});

test('rejected, cancelled and failed requests deactivate further voice and playback events', () => {
  for (const terminal of ['reject', 'cancel', 'fail']) {
    const diagnostics = new CallAudioDiagnostics();
    const id = 'private-' + terminal;
    diagnostics.request(id, { explicit: true, toCall: true });
    diagnostics.start(id);
    diagnostics[terminal](id);
    const ended = diagnostics.snapshot();
    const flag = { reject: 'rejected', cancel: 'cancelled', fail: 'failed' }[terminal];
    assert.equal(ended.lastSpeech[flag], true);
    diagnostics.observe({ type: 'voice.audio', turnId: id });
    diagnostics.observe({ type: 'voice.generated', turnId: id });
    diagnostics.observe({ type: 'voice.cancelled', turnId: id });
    diagnostics.playback(true, id);
    diagnostics.playback(false, id);
    assert.deepEqual(diagnostics.snapshot(), ended, terminal);
  }
});

test('tagged voice cancellation deactivates playback and can subsequently be marked failed', () => {
  const diagnostics = new CallAudioDiagnostics();
  diagnostics.request('synthesis-failure', { toCall: true });
  diagnostics.start('synthesis-failure');
  diagnostics.observe({ type: 'voice.cancelled', turnId: 'synthesis-failure' });
  diagnostics.observe({ type: 'voice.audio', turnId: 'synthesis-failure' });
  diagnostics.playback(true, 'synthesis-failure');
  diagnostics.fail('synthesis-failure');
  assert.deepEqual(
    diagnostics.snapshot().lastSpeech,
    speech({
      requested: true,
      toCall: true,
      toOwner: true,
      started: true,
      cancelled: true,
      failed: true,
    }),
  );
});

test('sharing and model permission remain independent from an explicitly requested route', () => {
  const diagnostics = new CallAudioDiagnostics();
  diagnostics.request('explicit-call', { explicit: true, toCall: true, toOwner: false });
  const explicit = diagnostics.snapshot({ shareReplies: false, allowModel: false });
  assert.equal(explicit.shareReplies, false);
  assert.equal(explicit.allowModel, false);
  assert.equal(explicit.lastSpeech.explicit, true);
  assert.equal(explicit.lastSpeech.toCall, true);
  assert.equal(explicit.lastSpeech.toOwner, false);
  diagnostics.request('model-call', { model: true, toCall: true });
  const model = diagnostics.snapshot({ shareReplies: true, allowModel: false });
  assert.equal(model.shareReplies, true);
  assert.equal(model.allowModel, false);
  assert.equal(model.lastSpeech.model, true);
  assert.equal(model.lastSpeech.explicit, false);
});

test('snapshots retain one bounded boolean record without identifiers or private payloads', () => {
  const diagnostics = new CallAudioDiagnostics();
  for (let i = 0; i < 200; i++) {
    const id = 'private-turn-' + i;
    diagnostics.request(id, { explicit: true, text: 'private text', deviceId: 'private device' });
    diagnostics.start(id);
    diagnostics.observe({ type: 'voice.audio', turnId: id, pcm: new Uint8Array(8192) });
    diagnostics.observe({ type: 'voice.generated', turnId: id, text: 'private text' });
  }
  const value = diagnostics.snapshot({ label: 'private label', deviceId: 'private device' });
  assertSnapshot(value);
  assert.deepEqual(
    value.lastSpeech,
    speech({
      requested: true,
      explicit: true,
      toOwner: true,
      started: true,
      audioGenerated: true,
      generationCompleted: true,
    }),
  );
  const serialized = JSON.stringify(value);
  assert.ok(serialized.length < 700);
  assert.doesNotMatch(serialized, /private|turnId|deviceId|label|pcm|text|history/i);
  value.lastSpeech.failed = true;
  assert.equal(diagnostics.snapshot().lastSpeech.failed, false);
});

test('setup diagnostics retain only bounded technical vocabulary and copy their receipt', () => {
  const diagnostics = new CallAudioDiagnostics();
  const value = diagnostics.snapshot({
    setup: {
      phase: 'error',
      busy: false,
      cableFound: true,
      lastFailure: 'feedback-loop',
      cable: { deviceId: 'private-endpoint', label: 'private endpoint label' },
      error: 'private raw error',
    },
  });
  assert.deepEqual(
    value.setup,
    setup({ phase: 'error', cableFound: true, lastFailure: 'feedback-loop' }),
  );
  assert.doesNotMatch(JSON.stringify(value), /private|endpoint|label|deviceId|raw error/i);
  value.setup.phase = 'private mutation';
  assert.equal(diagnostics.snapshot().setup.phase, 'idle');
  assert.deepEqual(
    diagnostics.snapshot({
      setup: {
        phase: 'private stage',
        busy: 'private value',
        cableFound: 'true',
        lastFailure: 'private error',
      },
    }).setup,
    setup({ phase: 'unknown', lastFailure: 'unknown' }),
  );
});
