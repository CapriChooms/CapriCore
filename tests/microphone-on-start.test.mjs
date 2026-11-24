import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OncePerLaunch } from '../apps/desktop/microphone-on-start.mjs';
import {
  COMPANION_DEFAULTS,
  validateCompanionSettings,
} from '../apps/desktop/companion-settings.mjs';

const source = (file) => readFileSync(new URL('../apps/desktop/' + file, import.meta.url), 'utf8');

test('the setting is off by default and must be a boolean', () => {
  assert.equal(COMPANION_DEFAULTS.microphoneOnStart, false);
  assert.equal(validateCompanionSettings({}).microphoneOnStart, false);
  assert.equal(validateCompanionSettings({ microphoneOnStart: true }).microphoneOnStart, true);
  assert.throws(() => validateCompanionSettings({ microphoneOnStart: 'on' }), /Invalid/);
});

test('listening is offered once per launch and only when wanted', () => {
  const launch = new OncePerLaunch();
  assert.equal(launch.take(false), false);
  assert.equal(launch.take(undefined), false);
  assert.equal(launch.take('true'), false);
  assert.equal(launch.take(true), true);
  // A window reload asks again: the owner may have switched the microphone off.
  assert.equal(launch.take(true), false);
  assert.equal(launch.take(true), false);
});

test('a setting that is off never uses up the launch', () => {
  const launch = new OncePerLaunch();
  for (let i = 0; i < 5; i += 1) assert.equal(launch.take(false), false);
  assert.equal(launch.take(true), true);
});

test('startup and the settings panel are wired to the setting', () => {
  const main = source('main.mjs');
  assert.match(
    main,
    /\(consumeMicrophoneRestart\(state\) \|\|\s+microphoneLaunch\.take\(companionPreferences\.value\.microphoneOnStart === true\)\)/,
  );
  const panel = source('renderer/companion-panel.mjs');
  assert.match(panel, /<input type="checkbox" id="companion-microphone-on-start">/);
  assert.match(panel, /microphoneOnStart: this\.get\('companion-microphone-on-start'\)\.checked/);
  assert.match(
    panel,
    /get\('companion-microphone-on-start'\)\.checked = value\.microphoneOnStart === true/,
  );
});
