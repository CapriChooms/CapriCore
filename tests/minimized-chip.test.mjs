// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { MinimizedChip, chipUrl } from '../apps/desktop/main/minimized-chip.mjs';

function fixture(options = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      assert(!handlers.has(channel), 'IPC channel must have only one owner');
      handlers.set(channel, handler);
    },
  };
  const screen = new EventEmitter();
  screen.primary = { workArea: { x: 0, y: 0, width: 1000, height: 700 } };
  screen.secondary = { workArea: { x: -800, y: -100, width: 800, height: 600 } };
  screen.pointer = { x: 0, y: 0 };
  screen.getPrimaryDisplay = () => screen.primary;
  screen.getDisplayNearestPoint = ({ x }) =>
    x < 0 && screen.secondary ? screen.secondary : screen.primary;
  screen.getCursorScreenPoint = () => ({ ...screen.pointer });
  class View extends EventEmitter {
    constructor(value) {
      super();
      this.topmostCalls = [];
      this.bounds = { x: 0, y: 0, width: value.width, height: value.height };
      this.moves = [];
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    setMenu() {}
    setAlwaysOnTop(value, level) {
      this.topmostCalls.push(level === undefined ? [value] : [value, level]);
      this.top = value && (process.platform !== 'win32' || level === 'normal');
    }
    loadURL(url) {
      this.url = url;
      return Promise.resolve();
    }
    getBounds() {
      return { ...this.bounds };
    }
    setBounds(value, animate) {
      this.bounds = { ...value };
      this.moves.push({ bounds: { ...value }, animate });
    }
    isVisible() {
      return this.visible === true;
    }
    isDestroyed() {
      return this.destroyed === true;
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
      this.emit('hide');
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  let restores = 0;
  const configuration = {
    BrowserWindow: View,
    screen,
    ipcMain,
    restore: () => restores++,
    ...options,
  };
  const chip = new MinimizedChip(configuration);
  const owner = () => ({
    sender: chip.window.webContents,
    senderFrame: chip.window.webContents.mainFrame,
  });
  const drag = (action, event = owner()) => handlers.get('capri:chip-drag')(event, action);
  const grab = () => {
    const bounds = chip.window.getBounds();
    screen.pointer = { x: bounds.x + 20, y: bounds.y + 20 };
    return { bounds, cursor: { ...screen.pointer } };
  };
  return { chip, handlers, screen, configuration, owner, drag, grab, restores: () => restores };
}

test('the restore chip is natively pinned before first presentation and remains pinned when reused', async () => {
  const { chip } = fixture();
  await chip.show();
  const view = chip.window;
  assert.equal(view.top, true);
  assert.deepEqual(view.topmostCalls, [process.platform === 'win32' ? [true, 'normal'] : [true]]);
  chip.hide();
  await chip.show();
  assert.equal(chip.window, view);
  assert.equal(view.top, true);
  chip.destroy();
});

test('chip drag IPC accepts only the owned main frame and fixed action vocabulary', async () => {
  const f = fixture();
  await f.chip.show();
  f.grab();
  assert.throws(() => f.drag('start', { sender: {}, senderFrame: {} }), /Invalid chip owner/);
  assert.throws(() => f.drag('start', { ...f.owner(), senderFrame: {} }), /Invalid chip owner/);
  assert.throws(() => f.drag({ action: 'move', x: 2000 }), /Invalid chip drag action/);
  f.chip.window.url = 'capri://desktop/settings.html';
  assert.throws(() => f.drag('start'), /Invalid chip owner/);
  f.chip.window.url = chipUrl;
  assert.deepEqual(f.drag('start'), { active: true, moved: false, cancelled: false });
  f.chip.hide();
  assert.deepEqual(f.drag('end'), { active: false, moved: false, cancelled: true });
});

test('native DIP dragging preserves size, has a threshold and clamps on the pointer monitor', async () => {
  const f = fixture();
  await f.chip.show();
  const { bounds, cursor } = f.grab();
  const initialMoves = f.chip.window.moves.length;
  f.drag('start');
  f.screen.pointer.x += 3;
  assert.deepEqual(f.drag('move'), { active: true, moved: false, cancelled: false });
  assert.equal(f.chip.window.moves.length, initialMoves);
  f.screen.pointer = { x: -50, y: -95 };
  assert.deepEqual(f.drag('move'), { active: true, moved: true, cancelled: false });
  assert.deepEqual(f.chip.window.getBounds(), {
    x: -70,
    y: -100,
    width: bounds.width,
    height: bounds.height,
  });
  assert.equal(f.chip.window.moves.at(-1).animate, false);
  f.screen.pointer = { x: cursor.x, y: cursor.y };
  assert.deepEqual(f.drag('end'), { active: false, moved: true, cancelled: false });
  assert.deepEqual(f.chip.window.getBounds(), bounds);
  assert.deepEqual(f.drag('end'), { active: false, moved: false, cancelled: true });
  assert.equal(f.restores(), 0, 'Dragging never restores the companion implicitly');
});

test('release applies the latest cursor even without an intervening move; click still restores', async () => {
  const f = fixture();
  await f.chip.show();
  f.grab();
  f.drag('start');
  f.screen.pointer = { x: 400, y: 300 };
  assert.deepEqual(f.drag('end'), { active: false, moved: true, cancelled: false });
  assert.deepEqual(f.chip.window.getBounds(), { x: 380, y: 280, width: 52, height: 52 });
  f.grab();
  f.drag('start');
  assert.deepEqual(f.drag('end'), { active: false, moved: false, cancelled: false });
  assert.equal(f.handlers.get('capri:chip-restore')(f.owner()), true);
  assert.equal(f.restores(), 1);
  assert.equal(f.chip.window.isVisible(), false);
});

test('chip remembers its moved position and display changes cancel and reclamp gestures', async () => {
  const f = fixture();
  await f.chip.show();
  f.grab();
  f.drag('start');
  f.screen.pointer = { x: 400, y: 300 };
  f.drag('end');
  const moved = f.chip.window.getBounds();
  f.chip.hide();
  await f.chip.show();
  assert.deepEqual(f.chip.window.getBounds(), moved);
  f.grab();
  f.drag('start');
  f.screen.primary.workArea = { x: 0, y: 0, width: 300, height: 200 };
  f.screen.emit('display-metrics-changed');
  assert.deepEqual(f.drag('end'), { active: false, moved: false, cancelled: true });
  assert.deepEqual(f.chip.window.getBounds(), { x: 248, y: 148, width: 52, height: 52 });
});

test('the shared recording indicator keeps its independent IPC and fixed placement', async () => {
  const f = fixture();
  const recording = new MinimizedChip({
    ...f.configuration,
    url: 'capri://desktop/recording-indicator.html',
    channel: 'capri:recording-stop',
    width: 260,
    height: 40,
    top: true,
  });
  await recording.show();
  assert.deepEqual(
    [...f.handlers.keys()],
    ['capri:chip-restore', 'capri:chip-drag', 'capri:recording-stop'],
  );
  assert.deepEqual(recording.window.getBounds(), { x: 724, y: 12, width: 260, height: 40 });
  assert.deepEqual(recording.dragAction('start'), { active: false, moved: false, cancelled: true });
});
