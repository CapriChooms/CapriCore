// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceSkills } from '../apps/desktop/main/voice-skills.mjs';
import { validateSpeechSettings } from '../apps/desktop/renderer/speech-settings.mjs';
import { CapriCore } from '../packages/core/src/index.mjs';

test('voice skills preserve the existing output and speech settings entry points', async () => {
  const core = new CapriCore();
  const received = [];
  const turns = [];
  const voiceState = { enabled: true, ready: true, language: 'en', error: null, source: 'api' };
  const voice = createVoiceSkills(core, {
    setVoiceEnabled(enabled) {
      received.push(enabled);
      return enabled ? voiceState : { ...voiceState, enabled: false };
    },
    onVoiceTurn(event) {
      turns.push(event);
    },
    readCallAudio: () => ({ callOutputReady: false }),
    canConfigureCallAudio: () => false,
    configureCallAudio: () => assert.fail('Unexpected call audio configuration'),
    async configureSpeech(value) {
      received.push(value);
      return validateSpeechSettings(value);
    },
  });

  assert.equal(voice.output.setEnabled(true, 'companion'), voiceState);
  assert.equal(voice.output.setEnabled(true, 'settings'), voiceState);
  assert.equal(voice.output.setEnabled(false, 'host').enabled, false);
  const pause = { trailingSilenceSeconds: 1.2 };
  assert.deepEqual(await voice.speech.configure(pause, 'settings'), {
    ...pause,
    microphoneGain: 100,
  });
  await assert.rejects(voice.speech.configure({ trailingSilenceSeconds: 8 }, 'settings'), {
    message: 'Invalid speech pause',
  });
  assert.throws(() => voice.speech.configure({ ...pause, pcm: [] }, 'settings'), {
    code: 'invalid_skill_input',
  });
  assert.throws(() => voice.output.setEnabled(true, 'tool'), { code: 'skill_access_denied' });
  assert.throws(() => voice.speech.configure(pause, 'tool'), { code: 'skill_access_denied' });
  assert.deepEqual(received, [true, true, false, pause, { trailingSilenceSeconds: 8 }]);
  const turnId = 'voice-fixture';
  const text = 'Sample voice line.';
  const start = { type: 'turn.started', turnId };
  assert.equal(voice.output.turn({ ...start, user: { text: 'Owner text' } }), undefined);
  assert.deepEqual(turns, [start]);
  voice.output.turn({ type: 'turn.avatar', turnId });
  voice.output.turn({ type: 'turn.preface', turnId, text });
  voice.output.turn({ type: 'turn.delta', turnId, text });
  voice.output.turn({ type: 'turn.completed', turnId, assistant: { text } });
  voice.output.turn({ type: 'turn.cancelled', turnId });
  voice.output.turn({ type: 'turn.failed', turnId });
  assert.deepEqual(turns, [
    start,
    { type: 'turn.preface', turnId, text },
    { type: 'turn.delta', turnId, text },
    { type: 'turn.completed', turnId },
    { type: 'turn.cancelled', turnId },
    { type: 'turn.failed', turnId },
  ]);
  const request = { skillId: 'capri.voice-output', command: 'turn', input: start };
  for (const source of ['companion', 'settings', 'tool', 'chat'])
    assert.throws(() => core.call(request, { source }), { code: 'skill_access_denied' });
  assert.throws(
    () =>
      core.call({ ...request, input: { ...start, pcm: new Uint8Array(4) } }, { source: 'host' }),
    { code: 'invalid_skill_input' },
  );
  await core.close();
});

test('call commands retain window and sender checks without granting device or audio access', async () => {
  const core = new CapriCore();
  const received = [];
  let windowOpen = false;
  const state = { callOutputReady: false, allowModel: false, callVoiceVolume: 50 };
  const voice = createVoiceSkills(core, {
    setVoiceEnabled: (enabled) => ({ enabled }),
    onVoiceTurn: () => assert.fail('Unexpected voice event'),
    readCallAudio: () => state,
    canConfigureCallAudio: () => windowOpen,
    async configureCallAudio(command) {
      received.push(command);
      return { ...state, callOutputReady: true, deviceId: command.deviceId };
    },
    configureSpeech: validateSpeechSettings,
  });

  assert.equal(voice.calls.command({ action: 'state' }, 'settings'), state);
  assert.throws(() => voice.calls.command({ action: 'state' }, 'companion'), {
    message: 'Open Voice calls in Settings.',
  });
  const outputOn = { action: 'output-on', deviceId: 'fixture-cable', mixMic: true };
  assert.throws(() => voice.calls.command(outputOn, 'settings'), {
    message: 'Call audio requires an open Capri window.',
  });
  windowOpen = true;
  for (const malformed of [
    { action: 'output-on', deviceId: 'default' },
    { action: 'voice-volume', volume: 101 },
    { action: 'state', pcm: new Uint8Array(4) },
  ]) {
    assert.throws(() => voice.calls.command(malformed, 'settings'), {
      message: 'Invalid call audio action.',
    });
  }
  assert.deepEqual(received, []);
  assert.equal((await voice.calls.command(outputOn, 'settings')).deviceId, 'fixture-cable');
  assert.deepEqual(received, [outputOn]);
  assert.throws(
    () =>
      core.call(
        { skillId: 'capri.voice-calls', command: 'command', input: { action: 'state' } },
        { source: 'chat' },
      ),
    { code: 'skill_access_denied' },
  );
  assert.throws(
    () => core.call({ skillId: 'capri.voice-calls', command: 'pcm' }, { source: 'settings' }),
    { code: 'unknown_skill_command' },
  );
  await core.close();
});
