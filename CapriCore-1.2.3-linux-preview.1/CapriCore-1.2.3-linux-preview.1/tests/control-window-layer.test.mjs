// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlWindowLayer } from '../apps/desktop/main/control-window-layer.mjs';
import { ComputerControl } from '../apps/desktop/computer-control.mjs';

function fixture() {
  const saved = { alwaysOnTop: true },
    preview = {},
    events = [],
    settingsLayer = [],
    topmostCalls = [];
  const view = {
    top: true,
    destroyed: false,
    bottomMoves: 0,
    moveBottom() {
      this.bottomMoves++;
    },
    isDestroyed() {
      return this.destroyed;
    },
    isAlwaysOnTop() {
      return this.top;
    },
    setAlwaysOnTop(value, level) {
      topmostCalls.push(level === undefined ? [value] : [value, level]);
      this.top = value && (process.platform !== 'win32' || level === 'normal');
      settingsLayer.push(value);
      if (!layer.active) events.push(value);
    },
  };
  const layer = new ControlWindowLayer({
    getWindow: () => view,
    desired: () => preview.alwaysOnTop ?? saved.alwaysOnTop,
  });
  return { layer, view, saved, preview, events, settingsLayer, topmostCalls };
}

test('control lowers the owner and matching Settings layer without publishing or saving an unpinned preference', () => {
  const f = fixture();
  f.layer.begin();
  assert.equal(f.view.top, false);
  assert.deepEqual(f.settingsLayer, [false]);
  assert.deepEqual(f.events, []);
  assert.equal(f.saved.alwaysOnTop, true);
  assert.deepEqual(f.preview, {});
  f.layer.begin();
  assert.deepEqual(f.settingsLayer, [false]);
  assert.equal(f.view.bottomMoves, 1);
  f.layer.end();
  assert.equal(f.view.top, true);
  assert.deepEqual(f.topmostCalls, [
    [false],
    process.platform === 'win32' ? [true, 'normal'] : [true],
  ]);
  assert.deepEqual(f.events, [true]);
});

test('end restores the latest saved and preview preference, never a stale value captured at start', () => {
  const f = fixture();
  f.layer.begin();
  f.saved.alwaysOnTop = false;
  f.layer.sync();
  f.layer.end();
  assert.equal(f.view.top, false);
  f.layer.begin();
  f.preview.alwaysOnTop = true;
  f.layer.sync();
  assert.equal(f.view.top, false);
  f.layer.end();
  assert.equal(f.view.top, true);
  assert.equal(f.saved.alwaysOnTop, false);
  delete f.preview.alwaysOnTop;
  f.layer.sync();
  assert.equal(f.view.top, false);
});

test('destroyed windows are never raised and a failed native transition releases its override', () => {
  const f = fixture();
  f.view.setAlwaysOnTop = () => {
    throw Error('Fixture native transition failed');
  };
  assert.throws(() => f.layer.begin(), /native transition failed/);
  assert.equal(f.layer.active, false);
  f.view.destroyed = true;
  f.layer.begin();
  assert.doesNotThrow(() => f.layer.end());
  assert.equal(f.saved.alwaysOnTop, true);
});

test('indicator failure and cancellation both restore the owner layer through ComputerControl cleanup', async () => {
  for (const mode of ['failure', 'cancel']) {
    const f = fixture();
    let release;
    const control = new ComputerControl({
      allowed: () => true,
      canStart: () => true,
      currentTurn: () => mode,
      registerEscape: () => true,
      unregisterEscape: () => {},
      bridge: async () => ({}),
      showBorder: async () => {
        f.layer.begin();
        if (mode === 'failure') throw Error('Fixture indicator unavailable');
        await new Promise((resolve) => {
          release = resolve;
        });
      },
      hideBorder: () => f.layer.end(),
    });
    const begin = control.begin('Test the isolated owner layer');
    const rejected = assert.rejects(begin, /indicator|cancelled/i);
    await new Promise((resolve) => setImmediate(resolve));
    if (mode === 'cancel') {
      assert.equal(f.view.top, false);
      await control.stop();
      release();
    }
    await rejected;
    assert.equal(control.snapshot().active, false);
    assert.equal(f.layer.active, false);
    assert.equal(f.view.top, true);
    assert.equal(f.saved.alwaysOnTop, true);
    assert(!f.events.includes(false));
  }
});
