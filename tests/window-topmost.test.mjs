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

test('home construction applies pinning and graphics preferences without showing or moving it', () => {
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.calls = [];
      this.top = false;
      this.contentView = { addChildView: (view) => (this.view = view) };
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    setAlwaysOnTop(value, level) {
      this.calls.push(level === undefined ? [value] : [value, level]);
      this.top = value && (process.platform !== 'win32' || level === 'normal');
    }
    setMenu() {}
    setIgnoreMouseEvents() {}
    getContentBounds() {
      return this.options;
    }
  }
  class View {
    constructor({ webPreferences }) {
      this.preferences = webPreferences;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    setBackgroundColor(color) {
      this.backgroundColor = color;
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
  }
  for (const { alwaysOnTop, softwareRendering } of [
    { alwaysOnTop: true, softwareRendering: false },
    { alwaysOnTop: false, softwareRendering: true },
  ]) {
    const { window, resizeSurface } = createSecureWindow(
      { BrowserWindow: Window, BaseWindow: Window, WebContentsView: View },
      {
        bounds: { x: 100, y: 200, width: 480, height: 660 },
        directory: '.',
        verification: false,
        alwaysOnTop,
        softwareRendering,
      },
    );
    assert.equal(window.top, alwaysOnTop);
    assert.equal(window.options.show, false);
    assert.deepEqual(window.calls, [
      alwaysOnTop && process.platform === 'win32' ? [true, 'normal'] : [alwaysOnTop],
    ]);
    assert.equal(window.options.x, 100);
    assert.equal(window.options.y, 200);
    const preferences = window.view?.preferences ?? window.options.webPreferences;
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.webgl, !softwareRendering);
    if (process.platform === 'win32') {
      assert.ok(resizeSurface);
      assert.equal(window.webContents, window.view.webContents);
      assert.equal(window.view.backgroundColor, '#00000000');
      assert.deepEqual(window.view.bounds, { x: 0, y: 0, width: 480, height: 660 });
    }
  }
});
