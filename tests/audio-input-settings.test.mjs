import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AudioInputSettings } from '../apps/desktop/audio-input-settings.mjs';
import { microphoneConstraints } from '../apps/desktop/renderer/microphone.mjs';

const devices = [
  { kind: 'audioinput', deviceId: 'default', label: 'Default - Desk microphone' },
  { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Desk microphone' },
  { kind: 'audioinput', deviceId: 'desk', label: 'Desk microphone' },
  { kind: 'audioinput', deviceId: 'headset', label: 'Headset microphone' },
  { kind: 'audioinput', deviceId: 'headset', label: 'Duplicate headset' },
  { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
  { kind: 'audiooutput', deviceId: 'speaker', label: 'Speakers' },
];
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'capri-audio-input-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'microphone.json');
  return { file, settings: new AudioInputSettings(file) };
}

test('microphone menu lists unique inputs and persists only the selected device', (t) => {
  const { file, settings } = fixture(t);
  settings.update(devices);
  assert.equal(settings.snapshot().deviceId, '');
  assert.equal(settings.snapshot().deviceLabel, 'System default — Desk microphone');
  const choices = [];
  let menu = settings.menu((id) => choices.push(id));
  assert.deepEqual(
    menu.map((item) => item.label),
    ['System default — Desk microphone', 'Desk microphone', 'Headset microphone'],
  );
  assert.equal(menu.filter((item) => item.checked).length, 1);
  menu[2].click();
  assert.deepEqual(choices, ['headset']);
  assert.equal(settings.select('headset'), true);
  assert.equal(settings.select('headset'), false);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    schemaVersion: 1,
    deviceId: 'headset',
    deviceLabel: 'Headset microphone',
  });
  const restored = new AudioInputSettings(file);
  restored.update(devices);
  assert.deepEqual(restored.snapshot(), { deviceId: 'headset', deviceLabel: 'Headset microphone' });
  menu = restored.menu(() => {});
  assert.equal(menu[2].checked, true);
  assert.equal(menu[0].checked, false);
  assert.equal(restored.select('default'), true);
  assert.equal(new AudioInputSettings(file).snapshot().deviceId, '');
});

test('a temporary microphone selection can be resolved without changing the saved device', (t) => {
  const { file, settings } = fixture(t);
  settings.update(devices);
  assert.deepEqual(settings.describe('headset'), {
    deviceId: 'headset',
    deviceLabel: 'Headset microphone',
  });
  assert.throws(() => settings.describe('unknown'), /unavailable/);
  assert.equal(settings.snapshot().deviceId, '');
  assert.equal(existsSync(file), false);
});

test('unplugging the saved microphone keeps an unavailable selection instead of silently falling back', (t) => {
  const { settings } = fixture(t);
  settings.update(devices);
  settings.select('headset');
  settings.update(devices.filter((device) => device.deviceId !== 'headset'));
  const menu = settings.menu(() => {}),
    selected = menu.filter((item) => item.checked);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].enabled, false);
  assert.match(selected[0].label, /Unavailable/);
  assert.equal(settings.snapshot().deviceId, 'headset');
  assert.throws(() => settings.select('unknown'), /unavailable/);
  assert.throws(() => settings.select('communications'), /unavailable/);
  assert.throws(() => settings.select({ deviceId: 'desk' }), /Invalid/);
  assert.throws(() => settings.select('bad\ninput'), /Invalid/);
  assert.equal(settings.snapshot().deviceId, 'headset');
  settings.update(devices);
  assert.equal(settings.menu(() => {}).find((item) => item.checked).label, 'Headset microphone');
});

test('bad saved settings are preserved until a valid explicit selection; labels and catalogs are bounded', (t) => {
  const { file } = fixture(t);
  writeFileSync(file, 'broken settings');
  const settings = new AudioInputSettings(file);
  assert.equal(settings.snapshot().deviceId, '');
  assert.equal(readFileSync(file, 'utf8'), 'broken settings');
  assert.throws(() => settings.update({}), /Invalid/);
  assert.throws(() => settings.update(Array(129).fill({})), /Invalid/);
  settings.update([
    { kind: 'audioinput', deviceId: 'desk', label: 'Desk\n' + 'x'.repeat(200) },
    { kind: 'audioinput', deviceId: 'bad\tinput', label: 'invalid' },
    { kind: 'audioinput', deviceId: '', label: '' },
  ]);
  assert.equal(settings.devices.length, 1);
  assert.equal(settings.devices[0].deviceLabel.length, 180);
  assert.ok(!settings.devices[0].deviceLabel.includes('\n'));
  settings.select('desk');
  assert.equal(new AudioInputSettings(file).snapshot().deviceId, 'desk');
});

test('audio constraints require the selected microphone exactly and use Windows default only when selected', () => {
  const selected = microphoneConstraints('headset');
  assert.deepEqual(selected.audio.deviceId, { exact: 'headset' });
  assert.equal(selected.video, false);
  assert.equal(selected.audio.echoCancellation, true);
  assert.equal(selected.audio.autoGainControl, false);
  assert.ok(!('deviceId' in microphoneConstraints().audio));
});
