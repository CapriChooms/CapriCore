// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopAvatarCommand,
  isSettingsWindowTitle,
  randomAvatarDestination,
} from '../apps/desktop/desktop-avatar-commands.mjs';

test('spoken return and window seat commands are recognized without matching questions or quotes', () => {
  for (const text of [
    'Капри, вернись в своё окно!',
    'Вернись в свою рамку, пожалуйста.',
    'Please return to your frame.',
    'Capri, go back into your window.',
  ])
    assert.deepEqual(desktopAvatarCommand(text), { action: 'return' });
  assert.deepEqual(desktopAvatarCommand('Присядь на окно «Хрома».'), {
    action: 'perch',
    title: 'chrome',
  });
  assert.deepEqual(desktopAvatarCommand('Посиди на текущем окне.'), { action: 'perch', title: '' });
  assert.deepEqual(desktopAvatarCommand('Perch on top of the Notepad window'), {
    action: 'perch',
    title: 'Notepad',
  });
  for (const text of ['What does return to your frame do?', 'Скажи «вернись домой»', 'Open Chrome'])
    assert.equal(desktopAvatarCommand(text), null);
});

test('Settings window names resolve across conversation and interface languages without matching other settings windows', () => {
  for (const request of [
    'Sit on the Settings window',
    'Sit on your Settings window',
    "Sit on Capri's Settings window",
    'Сядь на окно настроек',
    'Капри, присядь на окно «Настройки Capri».',
  ]) {
    const command = desktopAvatarCommand(request);
    assert.equal(command?.action, 'perch', request);
    assert.equal(isSettingsWindowTitle(command.title), true, request);
  }
  assert.equal(isSettingsWindowTitle('Paramètres Capri', ['Paramètres Capri']), true);
  for (const name of ['', undefined, 'Chrome settings', 'Settings notes', 'Capri Settings help'])
    assert.equal(isSettingsWindowTitle(name), false, name);
});

test('automatic landing stays on the selected monitor and avoids the companion and last position', () => {
  const area = { x: -1400, y: 40, width: 1400, height: 960 };
  const owner = { x: -480, y: 400, width: 460, height: 550 };
  const values = [0.9, 0.6, 0.1, 0.55, 0.36, 0.55];
  const previous = { x: -1114, y: 657 };
  const point = randomAvatarDestination(area, owner, previous, () => values.shift() ?? 0);
  assert.deepEqual(point, { x: -845, y: 657 });
  assert.equal(
    randomAvatarDestination(area, area, null, () => 0.5),
    null,
  );
});
