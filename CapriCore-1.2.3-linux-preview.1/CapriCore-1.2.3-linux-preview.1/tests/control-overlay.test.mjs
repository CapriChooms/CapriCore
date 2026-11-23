// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ControlOverlay } from '../apps/desktop/main/control-overlay.mjs';

const displays = [
  {
    id: 1,
    bounds: { x: -1280, y: 0, width: 1280, height: 720 },
    workArea: { x: -1232, y: 0, width: 1232, height: 720 },
  },
  {
    id: 2,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  },
];
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture({
  blocked,
  destroyFailure = false,
  clampOnShow = false,
  monitors = displays,
  applyBounds = (bounds) => ({ ...bounds }),
  cursor = { x: 5, y: 5 },
} = {}) {
  const entered = deferred(),
    pending = deferred(),
    pointer = deferred(),
    views = [],
    losses = [];
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => monitors,
    getCursorScreenPoint: () => cursor,
  });
  const wait = (stage, value) => {
    if (stage !== blocked) return Promise.resolve(value);
    entered.resolve();
    return pending.promise;
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.index = views.length;
      views.push(this);
      const { x, y, width, height } = options;
      this.bounds = { x, y, width, height };
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.executeJavaScript = (source) => {
        if (this.index === 1 && source.startsWith('globalThis.capriControl?.pointer('))
          pointer.resolve(JSON.parse(source.slice(source.indexOf('(') + 1, -1)));
        const stage = source.startsWith('Boolean')
          ? 'initialized'
          : source.startsWith('document.')
            ? 'caption'
            : source.includes('requestAnimationFrame')
              ? 'frame'
              : 'configure';
        return wait(stage, true);
      };
      this.shows = 0;
      this.resizes = 0;
    }
    setIgnoreMouseEvents() {}
    setAlwaysOnTop() {}
    loadURL() {
      return wait('load');
    }
    setBounds(bounds) {
      this.bounds = applyBounds(bounds);
      this.resizes++;
    }
    getBounds() {
      return this.bounds;
    }
    showInactive() {
      if (clampOnShow) this.bounds = { ...monitors[this.index].workArea };
      this.visible = true;
      this.shows++;
    }
    isVisible() {
      return this.visible === true;
    }
    isDestroyed() {
      return this.destroyed === true;
    }
    hide() {
      this.visible = false;
    }
    close() {
      this.closeAttempted = true;
    }
    destroy() {
      this.destroyAttempted = true;
      if (destroyFailure && this.index === 0) throw Error('Native close failed');
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
    }
  }
  const overlay = new ControlOverlay({
    BrowserWindow: Window,
    screen,
    onLost: (reason) => losses.push(reason),
  });
  return { overlay, screen, views, losses, entered, pending, pointer };
}

test('stopping during any pending initialization cancels immediately and cannot resurrect a border', async (t) => {
  for (const blocked of ['load', 'initialized', 'caption', 'configure', 'frame']) {
    await t.test(blocked, { timeout: 1000 }, async () => {
      const f = fixture({ blocked });
      const showing = f.overlay.show('Fixture');
      await f.entered.promise;
      f.overlay.hide();
      await assert.rejects(showing, /indicator closed/);
      assert.equal(f.overlay.tracker, null);
      assert.deepEqual(f.overlay.windows, []);
      assert.equal(f.views.length, 1, 'No second monitor may be created after stop.');
      assert.equal(f.views[0].isVisible(), false);
      assert.equal(f.views[0].isDestroyed(), true);
      const shows = f.views[0].shows;
      f.pending.resolve(true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.views[0].shows, shows);
      assert.equal(f.views.length, 1);
    });
  }
});

test('concurrent shows share one initialization and one monitor set', async () => {
  const f = fixture({ blocked: 'load' });
  const first = f.overlay.show('Fixture');
  const second = f.overlay.show('Duplicate');
  assert.equal(first, second);
  f.pending.resolve();
  await Promise.all([first, second]);
  assert.equal(f.views.length, displays.length);
  assert.ok(f.views.every((view) => view.shows === 1));
  f.overlay.hide();
  await assert.rejects(f.overlay.show('Late'), /indicator closed/);
});

test('screen capture waits for the pointer to clear on each monitor and restores it on failure', async () => {
  const f = fixture();
  await f.overlay.show('Fixture');
  const clear = deferred();
  const calls = [];
  for (const view of f.views) {
    const execute = view.webContents.executeJavaScript;
    view.webContents.executeJavaScript = (source) => {
      if (source.includes('suspendPointer')) {
        calls.push('suspend ' + view.index);
        return view.index === 1 ? clear.promise : Promise.resolve();
      }
      if (source.includes('resumePointer')) calls.push('resume ' + view.index);
      return execute(source);
    };
  }
  try {
    const capture = f.overlay.captureWithoutPointer(() => {
      assert(f.views.every((view) => view.isVisible()));
      calls.push('capture');
      throw Error('Fixture capture failed');
    });
    assert.deepEqual(calls, ['suspend 0', 'suspend 1']);
    clear.resolve();
    await assert.rejects(capture, /Fixture capture failed/);
    assert.deepEqual(calls, ['suspend 0', 'suspend 1', 'capture', 'resume 0', 'resume 1']);
  } finally {
    f.overlay.hide();
  }
});

test('one native destruction error cannot strand a visible monitor or a cursor tracker', async () => {
  const f = fixture({ destroyFailure: true });
  await f.overlay.show('Fixture');
  f.overlay.hide();
  assert.equal(f.overlay.tracker, null);
  assert.deepEqual(f.overlay.windows, []);
  assert.ok(f.views.every((view) => !view.isVisible() && view.destroyAttempted));
  assert.equal(f.views[0].closeAttempted, true);
  assert.equal(f.views[1].isDestroyed(), true);
  assert.doesNotThrow(() => f.overlay.hide());
});

test(
  'borders cover each entire display and ignore taskbar-only geometry changes',
  { timeout: 1000 },
  async (t) => {
    const f = fixture({ clampOnShow: true, cursor: { x: 22, y: 1050 } });
    t.after(() => f.overlay.hide());
    await f.overlay.show('Fixture');
    assert.deepEqual(
      f.views.map((view) => view.getBounds()),
      displays.map((d) => d.bounds),
    );
    assert.ok(f.views.every((view) => view.options.fullscreenable === false));
    const movedTaskbar = { ...displays[1], workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
    f.overlay.tracker.ref();
    assert.deepEqual(await f.pointer.promise, { x: 22, y: 1050 });
    f.screen.emit('display-metrics-changed', {}, movedTaskbar, ['workArea']);
    assert.deepEqual(f.views[0].getBounds(), displays[0].bounds);
    assert.deepEqual(f.views[1].getBounds(), movedTaskbar.bounds);
    assert.equal(f.views[1].resizes, 1, 'Only the startup clamp should require correcting.');
    const movedAndScaled = {
      ...displays[0],
      bounds: { x: -960, y: -108, width: 960, height: 540 },
      scaleFactor: 1.25,
    };
    f.screen.emit('display-metrics-changed', {}, movedAndScaled, ['bounds', 'scaleFactor']);
    assert.deepEqual(f.views[0].getBounds(), movedAndScaled.bounds);
    assert.ok(f.views.every((view) => view.shows === 1));
    f.overlay.hide();
    assert.equal(f.screen.listenerCount('display-metrics-changed'), 0);
  },
);

test('renderer loss cancels a pending show and reports the loss only once', async () => {
  const f = fixture({ blocked: 'configure' });
  const showing = f.overlay.show('Fixture');
  await f.entered.promise;
  f.views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await assert.rejects(showing, /indicator closed/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.losses, ['renderer_crashed']);
  assert.equal(f.views[0].isVisible(), false);
  assert.deepEqual(f.overlay.windows, []);
});

test('150% DPI rounding is accepted on every edge during startup and a display change', async (t) => {
  const display = { ...displays[0], scaleFactor: 1.5 };
  const round = (bounds) => ({ ...bounds, x: bounds.x - 1, width: bounds.width + 2 });
  const f = fixture({ monitors: [display], clampOnShow: true, applyBounds: round });
  t.after(() => f.overlay.hide());
  await f.overlay.show('Fixture');
  const view = f.views[0];
  assert.equal(view.isVisible(), true);
  assert.deepEqual(view.getBounds(), round(display.bounds));

  const moved = { ...display, bounds: { ...display.bounds, y: -18 } };
  f.screen.emit('display-metrics-changed', {}, moved, ['bounds', 'scaleFactor']);
  assert.deepEqual(view.getBounds(), round(moved.bounds));
  assert.deepEqual(f.losses, []);
});

test('a real coverage gap still fails closed with the display geometry', async () => {
  const display = { ...displays[1], scaleFactor: 1.5 };
  const shifted = (bounds) => ({ ...bounds, x: bounds.x + 1, width: bounds.width + 1 });
  const f = fixture({ monitors: [display], clampOnShow: true, applyBounds: shifted });
  await assert.rejects(f.overlay.show('Fixture'), {
    code: 'COMPUTER_INDICATOR_BOUNDS_FAILED',
    geometry: { expected: display.bounds, actual: shifted(display.bounds), scaleFactor: 1.5 },
  });
  assert.equal(f.views[0].isVisible(), false);
  assert.equal(f.views[0].isDestroyed(), true);
});
