// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaSkills } from '../apps/desktop/main/media-skills.mjs';
import { CapriCore } from '../packages/core/src/index.mjs';

test('media skills keep lifecycle and settings output while excluding live capture data', async () => {
  const core = new CapriCore();
  const capture = { enabled: true, sessionId: 'fixture-id', sampleRate: 16000 };
  const musicStatus = { enabled: false, phase: 'off', hearingMusic: false };
  const screenStatus = { active: true, analysing: false };
  const device = { deviceId: '', deviceLabel: 'System default' };
  const devices = { selection: device, devices: [] };
  const screenPreferences = { intervalMs: 30000, durationMs: 600000 };
  const prepared = { screenObservation: { active: true, current: false, observation: null } };
  const start = Promise.resolve(capture);
  const microphoneStops = [];
  const musicStops = [];
  let screenStops = 0;
  const media = createMediaSkills(core, {
    microphone: {
      start: () => start,
      confirm: (id) => (assert.equal(id, capture.sessionId), capture),
      stop: (input) => (microphoneStops.push(input), true),
      listen: () => false,
      snapshot: () => capture,
      devices: async () => devices,
      selectDevice: (id) => (assert.equal(id, ''), device),
    },
    music: {
      start: () => capture,
      ready: (id) => id === capture.sessionId,
      stop: (id) => (musicStops.push(id), musicStatus),
      snapshot: () => musicStatus,
      configure: (value) => ({ ...musicStatus, settings: value }),
    },
    screen: {
      context: () => null,
      async prepare(input, { signal }) {
        assert.deepEqual(input, { text: 'What is on screen?' });
        signal.throwIfAborted();
        return prepared;
      },
      snapshot: () => screenStatus,
      stop: () => {
        screenStops++;
      },
      configure: (value) => ({ ...screenPreferences, ...value }),
      preferences: () => screenPreferences,
    },
  });
  const pending = media.microphone.start();
  assert(pending instanceof Promise);
  assert.equal(await pending, capture);
  assert.equal(media.microphone.confirm(capture.sessionId), capture);
  assert.equal(media.microphone.listen(), false);
  const stopOptions = { id: capture.sessionId, keepModelWarm: true };
  assert.equal(media.microphone.stop(stopOptions), true);
  assert.deepEqual(microphoneStops, [stopOptions]);
  assert.equal(media.microphone.snapshot(), capture);
  assert.equal(await media.microphone.devices('settings'), devices);
  assert.equal(media.microphone.selectDevice('', 'companion'), device);
  assert.equal(media.music.start(), capture);
  assert.equal(media.music.ready('different-session'), false);
  assert.equal(media.music.stop(undefined, 'settings'), musicStatus);
  assert.deepEqual(musicStops, [undefined]);
  assert.equal(media.music.snapshot(), musicStatus);
  const musicSettings = { enabled: false, notes: false, motion: true, autoBpm: false };
  assert.deepEqual(media.music.configure(musicSettings, { role: 'settings' }), {
    ...musicStatus,
    settings: musicSettings,
  });
  assert.equal(media.screen.context(), null);
  const controller = new AbortController();
  assert.equal(
    await media.screen.prepare(
      { text: 'What is on screen?', attachments: [new Uint8Array(8)] },
      { signal: controller.signal },
    ),
    prepared,
  );
  controller.abort();
  assert.throws(
    () => media.screen.prepare({ text: 'What is on screen?' }, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(media.screen.preferences(), screenPreferences);
  assert.deepEqual(media.screen.configure({ intervalMs: 50000 }, 'settings'), {
    ...screenPreferences,
    intervalMs: 50000,
  });
  assert.equal(media.screen.snapshot(), screenStatus);
  assert.equal(media.screen.stop(), undefined);
  assert.equal(screenStops, 1);

  assert.throws(() => media.microphone.stop({ id: capture.sessionId, pcm: new Uint8Array(8) }), {
    code: 'invalid_skill_input',
  });
  for (const [skillId, command, source, code] of [
    ['capri.microphone', 'start', 'tool', 'skill_access_denied'],
    ['capri.microphone', 'selectDevice', 'chat', 'skill_access_denied'],
    ['capri.music', 'start', 'settings', 'skill_access_denied'],
    ['capri.music', 'configure', 'companion', 'skill_access_denied'],
    ['capri.screen', 'context', 'tool', 'skill_access_denied'],
    ['capri.music', 'packet', 'companion', 'unknown_skill_command'],
    ['capri.screen', 'prepare', 'host', 'skill_access_denied'],
    ['capri.screen', 'beginWatch', 'chat', 'unknown_skill_command'],
  ]) {
    assert.throws(() => core.call({ skillId, command }, { source }), { code });
  }
  await core.close();
});
