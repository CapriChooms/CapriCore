// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSecureWindow } from '../apps/desktop/main/secure-window.mjs';
import {
  ROUNDING_TOLERANCE,
  logicalSize,
  stabilizeWindowBounds,
} from '../apps/desktop/main/stable-bounds.mjs';

/** Imitates Windows at a fractional scale: every applied size comes back one DIP larger. */
function inflatingWindow(start = { x: 0, y: 0, width: 100, height: 50 }) {
  let native = { ...start, width: start.width + 1, height: start.height + 1 };
  const calls = [];
  return {
    calls,
    get native() {
      return native;
    },
    forceNative(bounds) {
      native = { ...bounds };
    },
    getBounds: () => ({ ...native }),
    setBounds(bounds, animate) {
      calls.push({ bounds: { ...bounds }, animate });
      native = { ...bounds, width: bounds.width + 1, height: bounds.height + 1 };
    },
  };
}

test('an unwrapped window grows on every read-then-write move', () => {
  const window = inflatingWindow();
  for (let i = 0; i < 30; i++) window.setBounds({ ...window.getBounds(), x: i });
  assert.equal(window.native.width, 131);
  assert.equal(window.native.height, 81);
});

test('a wrapped window keeps its size across read-then-write moves', () => {
  const window = stabilizeWindowBounds(inflatingWindow(), { width: 100, height: 50 });
  for (let i = 0; i < 300; i++) window.setBounds({ ...window.getBounds(), x: i }, false);
  assert.deepEqual(window.getBounds(), { x: 299, y: 0, width: 100, height: 50 });
  assert.equal(window.native.width, 101);
  assert.equal(window.calls.at(-1).animate, false);
});

test('position always comes from the native window', () => {
  const window = stabilizeWindowBounds(inflatingWindow(), { width: 100, height: 50 });
  window.forceNative({ x: -40, y: 77, width: 101, height: 51 });
  assert.deepEqual(window.getBounds(), { x: -40, y: 77, width: 100, height: 50 });
});

test('a deliberate resize is remembered as the new size', () => {
  const window = stabilizeWindowBounds(inflatingWindow(), { width: 100, height: 50 });
  window.setBounds({ x: 5, y: 6, width: 381, height: 574 });
  for (let i = 0; i < 20; i++) window.setBounds({ ...window.getBounds(), y: i });
  assert.deepEqual(window.getBounds(), { x: 5, y: 19, width: 381, height: 574 });
});

test('a native resize larger than rounding is reported as it is', () => {
  const window = stabilizeWindowBounds(inflatingWindow(), { width: 100, height: 50 });
  window.forceNative({ x: 0, y: 0, width: 100 + ROUNDING_TOLERANCE + 1, height: 50 });
  assert.equal(window.getBounds().width, 100 + ROUNDING_TOLERANCE + 1);
  window.forceNative({ x: 0, y: 0, width: 100 + ROUNDING_TOLERANCE, height: 50 });
  assert.equal(window.getBounds().width, 100);
});

test('without a known size the native bounds pass through until the first setBounds', () => {
  const window = stabilizeWindowBounds(inflatingWindow());
  assert.deepEqual(window.getBounds(), { x: 0, y: 0, width: 101, height: 51 });
  window.setBounds({ x: 1, y: 1, width: 101, height: 51 });
  window.setBounds({ ...window.getBounds(), x: 2 });
  assert.deepEqual(window.getBounds(), { x: 2, y: 1, width: 101, height: 51 });
});

test('bounds without a usable size are forwarded untouched', () => {
  const window = stabilizeWindowBounds(inflatingWindow(), { width: 100, height: 50 });
  window.setBounds({ x: 9, y: 9, width: Number.NaN, height: 50 });
  assert.ok(Number.isNaN(window.calls.at(-1).bounds.width));
  window.forceNative({ x: 9, y: 9, width: 101, height: 51 });
  assert.equal(window.getBounds().width, 100);
});

test('fractional requested sizes are rounded before they are applied', () => {
  const window = stabilizeWindowBounds(inflatingWindow());
  window.setBounds({ x: 0, y: 0, width: 120.6, height: 44.2 });
  assert.deepEqual(window.calls.at(-1).bounds, { x: 0, y: 0, width: 121, height: 44 });
});

test('logicalSize handles missing and invalid inputs', () => {
  assert.equal(logicalSize(null, null), null);
  assert.deepEqual(logicalSize({ width: 10, height: 10 }, null), { width: 10, height: 10 });
  assert.deepEqual(logicalSize(null, { width: 7, height: 8 }), { width: 7, height: 8 });
  assert.deepEqual(logicalSize({ width: 0, height: 5 }, { width: 7, height: 8 }), {
    width: 7,
    height: 8,
  });
  assert.deepEqual(logicalSize({ width: 12, height: 9 }, { width: 10, height: 10 }, 1), {
    width: 12,
    height: 9,
  });
});

test('a window without bounds methods is rejected', () => {
  assert.throws(() => stabilizeWindowBounds(null), TypeError);
  assert.throws(() => stabilizeWindowBounds({}), TypeError);
  assert.throws(() => stabilizeWindowBounds({ getBounds() {} }), TypeError);
  assert.throws(() => stabilizeWindowBounds({ setBounds() {} }), TypeError);
});

test('every non-finite or non-positive size field counts as no size', () => {
  const requested = { width: 10, height: 10 };
  const invalid = [
    { width: Number.NaN, height: 10 },
    { width: 10, height: Number.POSITIVE_INFINITY },
    { width: -10, height: 10 },
    { width: 10, height: '10' },
    { width: 10 },
  ];
  for (const native of invalid) {
    assert.deepEqual(logicalSize(native, requested), requested);
    assert.deepEqual(logicalSize({ width: 20, height: 30 }, native), { width: 20, height: 30 });
  }
});

test('getBounds passes through a native rectangle with no usable size', () => {
  const window = stabilizeWindowBounds({
    getBounds: () => ({ x: 3, y: 4, width: 0, height: Number.NaN }),
    setBounds() {},
  });
  assert.deepEqual(window.getBounds(), { x: 3, y: 4, width: 0, height: Number.NaN });
});

test('createSecureWindow stabilizes the Windows host without changing its content bounds', { skip: process.platform !== 'win32' }, () => {
  class InflatingView extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
      this.contentView = { addChildView() {} };
      const { width, height, x, y } = options;
      this.native = { x, y, width: width + 1, height: height + 1 };
    }
    setAlwaysOnTop() {}
    setMenu() {}
    setIgnoreMouseEvents() {}
    getBounds() {
      return { ...this.native };
    }
    getContentBounds() {
      return { ...this.native };
    }
    setBounds(bounds) {
      this.native = { ...bounds, width: bounds.width + 1, height: bounds.height + 1 };
    }
    setContentBounds(bounds) {
      this.setBounds(bounds);
    }
  }
  class ContentView {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
    setBackgroundColor() {}
    setBounds() {}
  }
  const { window } = createSecureWindow({ BaseWindow: InflatingView, WebContentsView: ContentView }, {
    bounds: { x: 0, y: 0, width: 480, height: 660 },
    directory: '.',
    verification: false,
    alwaysOnTop: false,
  });
  for (let i = 0; i < 50; i++) window.setBounds({ ...window.getBounds(), x: i });
  assert.deepEqual(window.getBounds(), { x: 49, y: 0, width: 480, height: 660 });
  assert.equal(window.getContentBounds().width, 481);
  window.setContentBounds({ x: 49, y: 0, width: 484, height: 660 });
  assert.equal(window.getBounds().width, 484);
  assert.equal(window.getContentBounds().width, 485);
});

test('createSecureWindow leaves non-Windows windows without bounds methods alone', { skip: process.platform === 'win32' }, () => {
  class PlainView {
    constructor(options) {
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
    }
    setAlwaysOnTop() {}
    setMenu() {}
    setIgnoreMouseEvents() {}
  }
  const { window } = createSecureWindow({ BrowserWindow: PlainView }, {
    bounds: { x: 1, y: 2, width: 3, height: 4 },
    directory: '.',
    verification: false,
    alwaysOnTop: false,
  });
  assert.equal(window.getBounds, undefined);
  assert.equal(window.setBounds, undefined);
});
