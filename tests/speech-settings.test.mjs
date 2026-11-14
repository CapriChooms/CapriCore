import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Preferences } from '../apps/desktop/preferences.mjs';
import {
  SPEECH_DEFAULTS,
  validateSpeechSettings,
} from '../apps/desktop/renderer/speech-settings.mjs';

test('speech pause is bounded and persists independently of microphone selection', (t) => {
  for (const pause of [0.5, 1.8, 3.2, 5])
    assert.equal(
      validateSpeechSettings({ trailingSilenceSeconds: pause }).trailingSilenceSeconds,
      pause,
    );
  for (const pause of [0, 0.4, 5.1, NaN, Infinity, true, '1.8', 1.85])
    assert.throws(() => validateSpeechSettings({ trailingSilenceSeconds: pause }));
  const folder = mkdtempSync(path.join(tmpdir(), 'capri-speech-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'speech.json');
  const prefs = new Preferences(file, SPEECH_DEFAULTS, validateSpeechSettings);
  assert.equal(prefs.value.trailingSilenceSeconds, 1);
  assert.equal(prefs.set({ trailingSilenceSeconds: 2.7 }).microphoneGain, 100);
  for (const gain of [0, 100, 165, 200]) {
    const settings = { trailingSilenceSeconds: 2.7, microphoneGain: gain };
    prefs.set(settings);
    assert.deepEqual(
      new Preferences(file, SPEECH_DEFAULTS, validateSpeechSettings).value,
      settings,
    );
  }
  for (const gain of [-1, 201, 1.5, Infinity, '100', null])
    assert.throws(() =>
      validateSpeechSettings({ trailingSilenceSeconds: 1, microphoneGain: gain }),
    );
});
