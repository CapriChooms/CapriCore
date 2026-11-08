// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  settingsAvatarWindowId,
  watchAvatarSettingsWindow,
} from '../apps/desktop/main/avatar-settings-window.mjs';

const url = 'capri://desktop/settings.html';
const record = { windowId: '123456', processId: '4321' };
function fixture() {
  const view = new EventEmitter();
  view.visible = true;
  view.bounds = { x: -600, y: 200, width: 680, height: 500 };
  view.isDestroyed = () => view.destroyed === true;
  view.isVisible = () => view.visible;
  view.isMinimized = () => view.minimized === true;
  view.getBounds = () => ({ ...view.bounds });
  view.webContents = { getURL: () => url };
  view.getNativeWindowHandle = () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(BigInt(record.windowId));
    return handle;
  };
  return view;
}

test('Settings perching follows DIP bounds and visibility without the desktop menu hook and cleans up all listeners', () => {
  const view = fixture();
  const changes = [];
  const stop = watchAvatarSettingsWindow(view, record, {
    processId: 4321,
    url,
    onChange: (value) => changes.push(value),
  });
  assert.equal(typeof stop, 'function');
  assert.deepEqual(changes.at(-1), { state: 'visible', dipBounds: view.bounds });
  view.bounds.x -= 120;
  view.bounds.width += 30;
  view.emit('move');
  view.emit('resize');
  assert.deepEqual(changes.at(-1), { state: 'visible', dipBounds: view.bounds });
  view.visible = false;
  view.emit('hide');
  assert.deepEqual(changes.at(-1), { state: 'hidden' });
  view.visible = true;
  view.emit('show');
  assert.deepEqual(changes.at(-1), { state: 'visible', dipBounds: view.bounds });
  const previous = changes.length;
  view.emit('focus');
  assert.equal(changes.length, previous + 1, 'Focusing Settings restores the avatar above it');
  assert.deepEqual(changes.at(-1), { state: 'visible', dipBounds: view.bounds });
  view.destroyed = true;
  view.emit('closed');
  assert.deepEqual(changes.at(-1), { state: 'closed' });
  stop();
  const count = changes.length;
  view.emit('move');
  assert.equal(changes.length, count);
  assert.deepEqual(view.eventNames(), []);
});

test('a minimized Settings window hides its perched avatar even while Electron reports it visible, then restores tracking', () => {
  const view = fixture();
  const changes = [];
  const stop = watchAvatarSettingsWindow(view, record, {
    processId: 4321,
    url,
    onChange: (value) => changes.push(value),
  });
  view.minimized = true;
  view.emit('minimize');
  assert.equal(view.isVisible(), true);
  assert.deepEqual(changes.at(-1), { state: 'hidden' });
  view.bounds = { ...view.bounds, x: -32000, y: -32000 };
  view.emit('move');
  assert.deepEqual(
    changes.at(-1),
    { state: 'hidden' },
    'Minimized window coordinates must not move Capri off screen',
  );
  view.bounds = { x: -450, y: 150, width: 680, height: 500 };
  view.minimized = false;
  view.emit('restore');
  assert.deepEqual(changes.at(-1), { state: 'visible', dipBounds: view.bounds });
  view.bounds.x += 80;
  view.emit('move');
  assert.deepEqual(changes.at(-1), { state: 'visible', dipBounds: view.bounds });
  stop();
  const count = changes.length;
  view.emit('minimize');
  view.emit('restore');
  assert.equal(changes.length, count);
  assert.deepEqual(view.eventNames(), []);
});

test('only the trusted Settings surface and exact native window identity can install a local tracker', () => {
  const view = fixture();
  assert.equal(settingsAvatarWindowId(view, url), record.windowId);
  assert.equal(settingsAvatarWindowId(view, 'capri://desktop/index.html'), '');
  for (const [candidate, requested] of [
    [undefined, record],
    [view, { ...record, processId: '9999' }],
    [view, { ...record, windowId: '1111' }],
    [view, { ...record, windowId: '' }],
  ])
    assert.equal(
      watchAvatarSettingsWindow(candidate, requested, {
        processId: 4321,
        url,
        onChange: () => assert.fail('An unrelated surface must never be followed'),
      }),
      null,
    );
  view.destroyed = true;
  assert.equal(settingsAvatarWindowId(view, url), '');
});
