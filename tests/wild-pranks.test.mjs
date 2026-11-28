// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { validateCompanionSettings } from '../apps/desktop/companion-settings.mjs';
import { prankGeometry, WildPranks } from '../apps/desktop/main/wild-pranks.mjs';

const display = { x: -1600, y: -200, width: 1600, height: 900 };

function fixture({ load = async () => {}, random = () => 0 } = {}) {
  const windows = [];
  class Overlay extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.executeJavaScript = async (source) => {
        this.source = source;
        return true;
      };
      windows.push(this);
    }
    loadURL(url) {
      this.url = url;
      return load();
    }
    setIgnoreMouseEvents(ignored) {
      this.ignoreMouseEvents = ignored;
    }
    showInactive() {
      this.shownWithoutFocus = true;
    }
    isDestroyed() {
      return this.destroyed === true;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  let time = 0;
  const pranks = new WildPranks({
    BrowserWindow: Overlay,
    screen: {
      getCursorScreenPoint: () => ({ x: -1, y: -199 }),
      getDisplayNearestPoint: () => ({ bounds: display }),
    },
    now: () => time,
    random,
  });
  return { pranks, windows, advance: (ms) => (time += ms) };
}

test('older profiles keep pranks off and settings admit only an explicit boolean', () => {
  assert.equal(validateCompanionSettings({}).wildDesktopPranks, false);
  assert.equal(validateCompanionSettings({ wildDesktopPranks: true }).wildDesktopPranks, true);
  assert.throws(() => validateCompanionSettings({ wildDesktopPranks: 'true' }));
  assert.equal(validateCompanionSettings({}).wildInputPranks, false);
  assert.equal(validateCompanionSettings({ wildInputPranks: true }).wildInputPranks, true);
  assert.throws(() => validateCompanionSettings({ wildInputPranks: 'true' }));
  assert.equal(validateCompanionSettings({}).wildInputPrankIntervalSeconds, 300);
  assert.equal(
    validateCompanionSettings({ wildInputPrankIntervalSeconds: 60 }).wildInputPrankIntervalSeconds,
    60,
  );
  assert.equal(
    validateCompanionSettings({ wildInputPrankIntervalSeconds: 1800 })
      .wildInputPrankIntervalSeconds,
    1800,
  );
  for (const invalid of [59, 1801, 120.5, '300', null])
    assert.throws(() => validateCompanionSettings({ wildInputPrankIntervalSeconds: invalid }));
});

test('the decoy stays on the pointer display and travels inward at opposite corners', () => {
  for (const point of [
    { x: -1600, y: -200 },
    { x: -1, y: 699 },
  ]) {
    const { bounds, anchorX, anchorY, dx, dy } = prankGeometry(point, display);
    assert.equal(bounds.x + anchorX, point.x);
    assert.equal(bounds.y + anchorY, point.y);
    assert.ok(bounds.x >= display.x && bounds.x + bounds.width <= 0);
    assert.ok(bounds.y >= display.y && bounds.y + bounds.height <= 700);
    assert.ok(anchorX + dx >= 0 && anchorX + dx < bounds.width);
    assert.ok(anchorY + dy >= 0 && anchorY + dy < bounds.height);
  }
});

test('automatic pranks wait for cooldown and eligibility, then close when disabled', async (t) => {
  const { pranks, windows, advance } = fixture();
  t.after(() => pranks.pause());
  const allowed = () => true;
  pranks.tick(false, () => assert.fail('disabled pranks should not check desktop activity'));
  pranks.tick(true, allowed);
  advance(119_999);
  pranks.tick(true, allowed);
  assert.equal(windows.length, 0);
  advance(1);
  pranks.tick(true, () => false);
  assert.equal(windows.length, 0);
  advance(10_000);
  pranks.tick(true, allowed);
  await new Promise(setImmediate);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].ignoreMouseEvents, true);
  assert.equal(windows[0].options.focusable, false);
  assert.equal(windows[0].shownWithoutFocus, true);
  assert.match(windows[0].source, /"variant":"snatch"/);
  pranks.tick(false);
  assert.equal(windows[0].isDestroyed(), true);
  pranks.tick(true, allowed);
  assert.equal(windows.length, 1);
});

test('an explicit preview works while automatic pranks are off; a stopped load stays hidden', async (t) => {
  const { promise, resolve } = Promise.withResolvers();
  const { pranks, windows } = fixture({ random: () => 0.9, load: () => promise });
  t.after(() => pranks.pause());
  const preview = pranks.play(false, () => true);
  pranks.tick(false);
  resolve();
  assert.equal(await preview, true);
  assert.match(windows[0].source, /"variant":"glitch"/);
  pranks.pause();
  const next = pranks.play(false, () => true);
  pranks.pause();
  assert.equal(await next, false);
  assert.equal(windows[1].shownWithoutFocus, undefined);
  assert.equal(windows[1].isDestroyed(), true);
});
