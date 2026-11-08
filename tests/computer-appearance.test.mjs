// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ControlOverlay } from '../apps/desktop/main/control-overlay.mjs';
import { computerPreferences } from '../apps/desktop/computer-preferences.mjs';
test('appearance settings reject foreign fields and out-of-range effects without changing defaults', () => {
  assert.deepEqual(computerPreferences(), {
    enabled: true,
    intensity: 50,
    theme: 'capri',
    cursor: true,
    pointerDuration: 260,
  });
  for (const value of [
    { theme: 'remote' },
    { intensity: 101 },
    { intensity: 0.5 },
    { pointerDuration: -1 },
    { pointerDuration: 1001 },
    { enabled: 1 },
    { cursor: null },
    { url: 'https://example.com' },
    [],
  ])
    assert.throws(() => computerPreferences(value), /Invalid/);
  assert.equal(computerPreferences({ intensity: 0, pointerDuration: 0 }).intensity, 0);
});
test('indicators cover negative-origin full displays and a lost renderer closes all indicators exactly once', async () => {
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.executeJavaScript = async () => true;
    }
    setIgnoreMouseEvents(value) {
      this.ignores = value;
    }
    setAlwaysOnTop() {}
    async loadURL() {}
    isDestroyed() {
      return !!this.dead;
    }
    setBounds(value) {
      this.bounds = { ...value };
    }
    setFullScreen() {}
    showInactive() {
      this.visible = true;
    }
    isVisible() {
      return this.visible;
    }
    getBounds() {
      return this.bounds;
    }
    destroy() {
      this.dead = true;
      this.emit('closed');
    }
  }
  const displays = [
    { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  ];
  let lost = 0;
  const overlay = new ControlOverlay({
    BrowserWindow: Window,
    screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => ({ x: 5, y: 10 }) },
    onLost: () => lost++,
  });
  await overlay.show('Test control');
  const windows = [...overlay.windows];
  assert.deepEqual(
    windows.map((w) => w.bounds),
    displays.map((d) => d.bounds),
  );
  assert(windows.every((w) => w.ignores && w.options.focusable === false));
  windows[0].webContents.emit('render-process-gone');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lost, 1);
  assert(windows.every((w) => w.dead));
  assert.equal(overlay.windows.length, 0);
  overlay.hide();
  assert.equal(lost, 1);
});
