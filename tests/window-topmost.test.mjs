// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createSecureWindow } from '../apps/desktop/main/secure-window.mjs';
import { setWindowAlwaysOnTop } from '../apps/desktop/main/window-topmost.mjs';

test('only enabled ordinary Windows pinning uses the explicit normal level', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const calls = [];
    const view = { setAlwaysOnTop: (...args) => calls.push(args) };
    setWindowAlwaysOnTop(view, true, platform);
    setWindowAlwaysOnTop(view, false, platform);
    assert.deepEqual(calls, [platform === 'win32' ? [true, 'normal'] : [true], [false]]);
  }
});

test('home construction applies the native pin preference without showing, focusing or moving it', () => {
  class View {
    constructor(options) {
      this.options = options;
      this.calls = [];
      this.top = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    setAlwaysOnTop(value, level) {
      this.calls.push(level === undefined ? [value] : [value, level]);
      this.top = value && (process.platform !== 'win32' || level === 'normal');
    }
    setMenu() {}
    setIgnoreMouseEvents() {}
  }
  for (const alwaysOnTop of [true, false]) {
    const window = createSecureWindow(View, {
      bounds: { x: 100, y: 200, width: 480, height: 660 },
      directory: '.',
      verification: false,
      alwaysOnTop,
    });
    assert.equal(window.top, alwaysOnTop);
    assert.equal(window.options.show, false);
    assert.deepEqual(window.calls, [
      alwaysOnTop && process.platform === 'win32' ? [true, 'normal'] : [alwaysOnTop],
    ]);
    assert.equal(window.options.x, 100);
    assert.equal(window.options.y, 200);
    assert.equal(window.options.webPreferences.sandbox, true);
  }
});
