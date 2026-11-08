// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SettingsWindow } from '../apps/desktop/main/settings-window.mjs';

function fixture() {
  class View extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.visible = false;
      this.opacity = options.opacity ?? 1;
      this.top = true;
      this.topmostCalls = [];
      this.moves = 0;
      this.bounds = { x: 800, y: 20, width: 480, height: 660 };
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      this.webContents.capturePage = async () => ({ isEmpty: () => false });
      this.webContents.invalidate = () => {
        this.repaints = (this.repaints ?? 0) + 1;
      };
      this.webContents.setBackgroundThrottling = (value) => {
        this.throttled = value;
      };
    }
    getBounds() {
      return this.bounds;
    }
    setBounds(value) {
      this.bounds = value;
      this.moves++;
    }
    setMenu() {}
    focus() {}
    setOpacity(value) {
      this.opacity = value;
    }
    setIgnoreMouseEvents(value) {
      this.ignoreMouse = value;
    }
    isAlwaysOnTop() {
      return this.top;
    }
    setAlwaysOnTop(value, level) {
      this.topmostCalls.push(level === undefined ? [value] : [value, level]);
      this.top = value && (process.platform !== 'win32' || level === 'normal');
    }
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    show() {
      this.visible = true;
      this.emit('show');
    }
    showInactive() {
      this.show();
    }
    hide() {
      this.visible = false;
      this.emit('hide');
    }
    destroy() {
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
    }
    loadURL() {
      return new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
    }
  }
  const owner = new View(),
    screen = new EventEmitter(),
    errors = [];
  screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
  let quitting = false;
  const host = new SettingsWindow({
    BrowserWindow: View,
    screen,
    owner,
    directory: '.',
    url: 'fixture',
    quitting: () => quitting,
    onBusy() {},
    onError: (error) => errors.push(error),
  });
  return {
    host,
    owner,
    errors,
    quit() {
      quitting = true;
      host.destroy();
    },
  };
}

test('settings inherits the owner pin preference at construction and follows demotion, restore and rollback', async () => {
  const { host, owner } = fixture();
  owner.top = false;
  const opening = host.open();
  const view = host.window;
  assert.equal(view.top, false);
  assert.deepEqual(view.topmostCalls, [[false]]);
  owner.top = true;
  owner.emit('always-on-top-changed');
  assert.equal(view.top, true);
  assert.deepEqual(
    view.topmostCalls.at(-1),
    process.platform === 'win32' ? [true, 'normal'] : [true],
  );
  owner.top = false;
  owner.emit('always-on-top-changed');
  assert.equal(view.top, false);
  assert.deepEqual(view.topmostCalls.at(-1), [false]);
  owner.top = true;
  owner.emit('always-on-top-changed');
  assert.equal(view.top, true);
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  await host.surfacePending;
  host.hide();
  await host.open();
  await host.surfacePending;
  assert.equal(host.window, view);
  assert.equal(view.top, true);
  host.destroy();
});

test('first settings display waits for initialized forms, native paint and populated content in either order', async () => {
  for (const order of [
    ['forms', 'paint', 'content'],
    ['paint', 'forms', 'content'],
    ['forms', 'content', 'paint'],
  ]) {
    const { host } = fixture();
    const opening = host.open();
    const view = host.window;
    assert.equal(view.options.parent, undefined);
    assert.equal(view.options.skipTaskbar, true);
    for (const [index, step] of order.entries()) {
      if (step === 'forms') host.loaded();
      else if (step === 'paint') view.emit('ready-to-show');
      else host.rendered();
      assert.equal(host.snapshot().visible, false);
    }
    await host.surfacePending;
    assert.equal(view.visible, true);
    assert.equal(view.opacity, 1);
    assert.equal(view.ignoreMouse, false);
    assert.equal(view.throttled, false);
    assert(view.repaints > 0);
    view.resolve();
    await opening;
    host.destroy();
  }
});

test('tray and minimize retain drafts without automatically restoring the settings surface', async () => {
  const { host, owner } = fixture();
  const opening = host.open();
  const view = host.window;
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  for (const event of ['hide', 'minimize']) {
    owner.emit(event);
    assert.equal(view.visible, false);
    assert.equal(host.requested, false);
    const moves = view.moves;
    owner.emit('move');
    owner.emit('resize');
    owner.emit('show');
    owner.emit('restore');
    assert.equal(view.visible, false);
    assert.equal(view.moves, moves);
    assert.equal(host.window, view);
    await host.open('voice');
    await host.surfacePending;
    assert.equal(view.visible, true);
    assert.equal(host.window, view);
  }
  owner.top = false;
  owner.emit('always-on-top-changed');
  assert.equal(view.top, false);
  owner.destroy();
  assert.equal(view.isDestroyed(), true);
  assert.equal(host.window, null);
});

test('hiding during initialization cannot reveal a late painted settings window', async () => {
  const { host, owner } = fixture();
  const opening = host.open();
  const view = host.window;
  owner.hide();
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  assert.equal(view.visible, false);
  assert.equal(host.requested, false);
  await host.open();
  await host.surfacePending;
  assert.equal(view.visible, true);
});

test('first native frame is shared, cancelled by hide, and never exposes an empty surface', async () => {
  const { host, errors } = fixture();
  const opening = host.open();
  const view = host.window;
  let finish,
    captures = 0;
  view.webContents.capturePage = (_rect, options) => {
    assert.equal(options.stayHidden, true);
    captures++;
    assert.equal(view.isVisible(), true, 'Native window must be shown before frame capture');
    assert.equal(view.opacity, 1 / 255);
    assert.equal(view.ignoreMouse, true);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  host.present();
  assert.equal(captures, 1);
  assert.equal(host.snapshot().visible, false);
  host.hide();
  finish({ isEmpty: () => false });
  await host.surfacePending;
  assert.equal(view.visible, false);
  assert.equal(view.throttled, true);
  assert.equal(view.opacity, 1 / 255);
  assert.equal(captures, 1);
  host.destroy();

  const retry = host.open();
  const replacement = host.window;
  let attempt = 0;
  replacement.webContents.capturePage = async () => ({ isEmpty: () => ++attempt === 1 });
  host.loaded();
  host.rendered();
  replacement.emit('ready-to-show');
  replacement.resolve();
  await retry;
  await host.surfacePending;
  assert.equal(attempt, 2);
  assert.equal(replacement.visible, true);
  assert.equal(replacement.opacity, 1);
  assert.deepEqual(errors, []);
  host.destroy();
});

test('a closed or failed settings window cannot mutate its replacement', async () => {
  const { host } = fixture();
  const oldOpening = host.open();
  const old = host.window;
  old.destroy();
  assert.equal(host.window, null);
  const newOpening = host.open('voice');
  const current = host.window;
  host.loaded();
  host.rendered();
  current.resolve();
  await newOpening;
  old.emit('ready-to-show');
  old.emit('closed');
  old.reject(Error('ERR_ABORTED'));
  await oldOpening;
  assert.equal(host.window, current);
  assert.equal(current.visible, false);
  current.emit('ready-to-show');
  await host.surfacePending;
  assert.equal(current.visible, true);
});

test('settings crash and shutdown release the native window and reject delayed presentation', async () => {
  const { host, errors, quit } = fixture();
  const opening = host.open();
  const view = host.window;
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  view.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(view.isDestroyed(), true);
  assert.equal(errors.length, 1);
  const retry = host.open();
  const replacement = host.window;
  quit();
  replacement.emit('ready-to-show');
  host.loaded();
  host.rendered();
  replacement.resolve();
  await retry;
  await host.open();
  assert.equal(host.window, null);
  assert.equal(replacement.isDestroyed(), true);
});

test('generic settings opening resumes the renderer on first load and after hiding', async () => {
  const { host } = fixture();
  const opening = host.open();
  const view = host.window,
    events = [];
  view.webContents.send = (_channel, event) => events.push(event);
  host.loaded();
  view.resolve();
  await opening;
  assert.deepEqual(events, [{ type: 'settings.resume' }]);
  host.hide();
  await host.open();
  assert.deepEqual(
    events.filter((event) => event.type !== 'settings.visibility'),
    [{ type: 'settings.resume' }, { type: 'settings.resume' }],
  );
  assert.equal(host.window, view);
  host.destroy();
});

test('latest settings intent is sent once when opening before the renderer loads', async () => {
  const { host } = fixture();
  const opening = host.open('models', 'context');
  const view = host.window,
    events = [];
  view.webContents.send = (_channel, event) => events.push(event);
  await host.open();
  host.loaded();
  view.resolve();
  await opening;
  assert.deepEqual(events, [{ type: 'settings.resume' }]);
  host.destroy();
});

test('context shortcut reaches newly loaded and reused settings without leaking focus to other sections', async () => {
  const { host } = fixture();
  const opening = host.open('models', 'context');
  const view = host.window,
    events = [];
  view.webContents.send = (_channel, event) => events.push(event);
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  assert.equal(
    events.filter((event) => event.type === 'settings.navigate').length,
    1,
    'Initial navigation is sent once',
  );
  assert(
    events.some(
      (event) =>
        event.type === 'settings.navigate' &&
        event.section === 'models' &&
        event.focus === 'context',
    ),
  );
  host.hide();
  await host.open('appearance');
  assert.equal(events.filter((event) => event.type !== 'settings.visibility').at(-1).focus, null);
  await host.open('models', 'context');
  assert.equal(
    events.filter((event) => event.type !== 'settings.visibility').at(-1).focus,
    'context',
  );
  host.hide();
  await host.open();
  assert.deepEqual(events.filter((event) => event.type !== 'settings.visibility').at(-1), {
    type: 'settings.resume',
  });
  await host.open('general');
  assert.deepEqual(events.filter((event) => event.type !== 'settings.visibility').at(-1), {
    type: 'settings.navigate',
    section: 'general',
    focus: null,
  });
  assert.equal(host.window, view);
  host.destroy();
});

test('native visibility explicitly suspends and resumes renderer effects without a DOM visibility event', async () => {
  const { host, owner } = fixture();
  const opening = host.open('credits');
  const view = host.window,
    events = [];
  view.webContents.send = (_channel, event) => events.push(event);
  host.loaded();
  host.rendered();
  view.emit('ready-to-show');
  view.resolve();
  await opening;
  await host.surfacePending;
  const visibility = () => events.filter((event) => event.type === 'settings.visibility');
  assert.equal(visibility().at(-1).visible, true);
  host.hide();
  assert.equal(view.isVisible(), false);
  assert.equal(visibility().at(-1).visible, false);
  const hidden = events.length;
  view.showInactive(); // Stale native presentation cannot resume a dismissed surface.
  assert.equal(view.isVisible(), false);
  assert(
    !events.slice(hidden).some((event) => event.type === 'settings.visibility' && event.visible),
  );
  await host.open('credits');
  await host.surfacePending;
  assert.equal(visibility().at(-1).visible, true);
  owner.emit('minimize');
  assert.equal(visibility().at(-1).visible, false);
  host.destroy();
});
