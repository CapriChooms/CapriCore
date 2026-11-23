// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Preferences } from '../apps/desktop/preferences.mjs';
import {
  callAudioCommand,
  callAudioState,
  callAudioPreferences,
  callOutputDevices,
  speakerSelectionAllowed,
} from '../apps/desktop/main/call-audio.mjs';

test('a muted call voice survives preference reload without enabling model-selected call replies', (t) => {
  const parent = path.resolve(tmpdir());
  const folder = mkdtempSync(path.join(parent, 'capri-call-volume-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(folder)), parent);
    rmSync(folder, { recursive: true, force: true });
  });
  const file = path.join(folder, 'call-audio.json');
  const defaults = callAudioPreferences({ allowModel: false });
  const original = new Preferences(file, defaults, callAudioPreferences);
  original.set({ ...original.snapshot(), callVoiceVolume: 0 });
  const restarted = new Preferences(file, defaults, callAudioPreferences);
  assert.deepEqual(restarted.snapshot(), { allowModel: false, callVoiceVolume: 0 });
  restarted.set({ ...restarted.snapshot(), allowModel: true });
  assert.equal(restarted.snapshot().callVoiceVolume, 0);
});

test('call voice volume is bounded, independent of authorization and compatible with saved preferences', () => {
  assert.deepEqual(callAudioPreferences({ allowModel: false }), {
    allowModel: false,
    callVoiceVolume: 50,
  });
  for (const volume of [0, 25, 50, 100]) {
    assert.deepEqual(callAudioCommand({ action: 'voice-volume', volume }), {
      action: 'voice-volume',
      volume,
    });
    assert.deepEqual(callAudioPreferences({ allowModel: true, callVoiceVolume: volume }), {
      allowModel: true,
      callVoiceVolume: volume,
    });
    assert.throws(
      () => callAudioCommand({ action: 'output-on', deviceId: 'cable', volume }),
      /Invalid/,
    );
    assert.throws(
      () => callAudioCommand({ action: 'voice-volume', volume, enabled: true }),
      /Invalid/,
    );
  }
  for (const volume of [-1, 101, 1.5, NaN, Infinity, '50', null]) {
    assert.throws(() => callAudioCommand({ action: 'voice-volume', volume }), /Invalid/);
    assert.throws(
      () => callAudioPreferences({ allowModel: true, callVoiceVolume: volume }),
      /Invalid/,
    );
  }
  assert.throws(() => callAudioCommand({ action: 'voice-volume' }), /Invalid/);
});

test('call output requires a specific device and only exposes bounded playback metadata', () => {
  const device = (deviceId, label, kind = 'audiooutput') => ({ deviceId, label, kind });
  assert.deepEqual(
    callOutputDevices([
      null,
      device('default', 'Default'),
      device('communications', 'Communications'),
      device('mic', 'Microphone', 'audioinput'),
      device('hidden', ''),
      device('steam-mic', 'Microphone (Steam Streaming Microphone)'),
      device('steam-speakers', 'Steam Streaming Speakers'),
      { ...device('cable', 'Virtual\nCable'), groupId: 'private-group' },
    ]),
    [{ deviceId: 'cable', label: 'Virtual Cable' }],
  );
  assert.deepEqual(
    callOutputDevices([{ ...device('cable', 'Virtual Cable'), groupId: 'private-group' }], true),
    [{ deviceId: 'cable', label: 'Virtual Cable', groupId: 'private-group' }],
  );
  assert.throws(() => callAudioCommand({ action: 'output-on', deviceId: 'default' }), /Invalid/);
  assert.throws(() => callAudioCommand({ action: 'output-off', deviceId: 'cable' }), /Invalid/);
  assert.throws(
    () => callAudioCommand({ action: 'output-on', deviceId: 'cable', text: 'extra' }),
    /Invalid/,
  );
  assert.equal(callAudioCommand({ action: 'output-on', deviceId: 'cable' }).deviceId, 'cable');
  assert.deepEqual(callAudioCommand({ action: 'share-replies', enabled: true }), {
    action: 'share-replies',
    enabled: true,
  });
  assert.throws(() => callAudioCommand({ action: 'share-replies' }), /Invalid/);
  assert.throws(() => callAudioCommand({ action: 'share-replies', enabled: 'yes' }), /Invalid/);
  assert.throws(
    () => callAudioCommand({ action: 'share-replies', enabled: true, deviceId: 'cable' }),
    /Invalid/,
  );
  assert.equal(callAudioState({ shareReplies: true }).shareReplies, false);
  assert.equal(
    callAudioState({ callOutputReady: true, deviceId: 'cable', shareReplies: true }).shareReplies,
    true,
  );
  assert.equal(
    callAudioState({ callOutputReady: true, deviceId: 'default' }).callOutputReady,
    false,
  );
  assert.equal(callAudioState({ callOutputReady: true, deviceId: 'cable' }).callOutputReady, true);
});

test('speaker permission is scoped to the companion and an in-progress operation', () => {
  const url = 'capri://desktop/index.html';
  const owner = { getURL: () => url };
  const context = {
    active: true,
    owner,
    contents: owner,
    permission: 'speaker-selection',
    origin: 'capri://desktop',
    details: { isMainFrame: true, requestingUrl: url },
    url,
  };
  assert.equal(speakerSelectionAllowed(context), true);
  for (const patch of [
    { active: false },
    { contents: { getURL: () => url } },
    { permission: 'media' },
    { origin: 'https://example.com' },
    { details: { isMainFrame: false, requestingUrl: url } },
    { details: { isMainFrame: true, requestingUrl: 'capri://desktop/settings.html' } },
  ])
    assert.equal(speakerSelectionAllowed({ ...context, ...patch }), false);
});
