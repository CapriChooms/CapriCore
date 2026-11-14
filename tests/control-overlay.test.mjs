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
function fixture({ blocked, destroyFailure = false } = {}) {
  const entered = deferred(),
    pending = deferred(),
    views = [],
    losses = [];
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getCursorScreenPoint: () => ({ x: 5, y: 5 }),
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
    }
    setIgnoreMouseEvents() {}
    setAlwaysOnTop() {}
    loadURL() {
      return wait('load');
    }
    setBounds(bounds) {
      this.bounds = { ...bounds };
    }
    getBounds() {
      return this.bounds;
    }
    showInactive() {
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
  return { overlay, screen, views, losses, entered, pending };
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

test('borders use each work area and follow changes to the taskbar', async () => {
  const f = fixture();
  await f.overlay.show('Fixture');
  assert.deepEqual(
    f.views.map((view) => view.getBounds()),
    displays.map((d) => d.workArea),
  );
  assert.ok(f.views.every((view) => view.options.fullscreenable === false));
  const movedTaskbar = { ...displays[1], workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
  f.screen.emit('display-metrics-changed', {}, movedTaskbar, ['workArea']);
  assert.deepEqual(f.views[0].getBounds(), displays[0].workArea);
  assert.deepEqual(f.views[1].getBounds(), movedTaskbar.workArea);
  assert.ok(f.views.every((view) => view.shows === 1));
  f.overlay.hide();
  assert.equal(f.screen.listenerCount('display-metrics-changed'), 0);
});

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
