// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installTrayOnlyWindows } from '../apps/desktop/main/tray-only-windows.mjs';

test('every companion surface stays off the taskbar after construction and visibility changes', () => {
  const app = new EventEmitter();
  const dispose = installTrayOnlyWindows(app);
  for (const name of ['home', 'Settings', 'detached input', 'restore chip']) {
    const view = new EventEmitter();
    view.isDestroyed = () => false;
    view.calls = [];
    // Simulate native focusability initialization overriding the constructor option.
    view.skip = false;
    view.setSkipTaskbar = (skip) => {
      view.skip = skip;
      view.calls.push(skip);
    };
    app.emit('browser-window-created', {}, view);
    assert.equal(view.skip, true, name);
    for (const event of ['show', 'hide', 'minimize', 'restore']) {
      view.skip = false;
      view.emit(event);
      assert.equal(view.skip, true, `${name}: ${event}`);
    }
    assert.deepEqual(view.calls, [true, true, true, true, true]);
    view.isDestroyed = () => true;
    view.emit('hide');
    assert.equal(view.calls.length, 5);
  }
  dispose();
  assert.equal(app.listenerCount('browser-window-created'), 0);
});
