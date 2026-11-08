// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AvatarDetach } from '../apps/desktop/main/avatar-detach.mjs';

class Overlay extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.visible = false;
    this.lifts = 0;
    this.levels = [];
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = () => {};
  }
  setMenu() {}
  setIgnoreMouseEvents() {}
  isDestroyed() {
    return this.destroyed === true;
  }
  isVisible() {
    return this.visible;
  }
  setAlwaysOnTop(...value) {
    this.levels.push(value);
  }
  moveTop() {
    this.lifts++;
  }
  showInactive() {
    const hidden = !this.visible;
    this.visible = true;
    // A normal visible-to-visible show does not create a new visibility event.
    if (hidden) this.emit('show');
  }
  focus() {
    assert.fail('Avatar restacking must never steal keyboard focus');
  }
  show() {
    assert.fail('A detached avatar must be shown without activation');
  }
}

function fixture() {
  const avatar = new AvatarDetach({
    BrowserWindow: Overlay,
    verification: true,
    onPhase: () => {},
  });
  avatar.overlay = avatar.createOverlay({ x: -1920, y: 0, width: 1920, height: 1040 });
  avatar.phase = 'detached';
  return { avatar, overlay: avatar.overlay };
}

test('a detached avatar uses a non-activating layer above ordinary topmost app windows', () => {
  const { avatar, overlay } = fixture();
  assert.equal(overlay.options.focusable, false);
  assert.equal(overlay.options.alwaysOnTop, true);
  assert.equal(overlay.options.parent, undefined, 'Settings bounds must not clip its sprite');
  assert.deepEqual(overlay.levels, [[true, 'screen-saver']]);
  assert.equal(overlay.lifts, 0, 'Preparing a hidden overlay must not change visible window order');
  assert.equal(avatar.showParked(), true);
  assert.equal(overlay.visible, true);
  assert.ok(overlay.lifts > 0);
  const lifts = overlay.lifts;
  avatar.showParked();
  assert.equal(overlay.lifts, lifts + 1, 'Following a focused perch restores its stacking order');
});

test('every overlay show and explicit restack preserves focus and hidden/destroyed lifecycles', () => {
  const { avatar, overlay } = fixture();
  overlay.showInactive();
  assert.equal(overlay.lifts, 1);
  avatar.raiseOverlay();
  assert.equal(overlay.lifts, 2);
  overlay.visible = false;
  assert.equal(avatar.raiseOverlay(), false);
  assert.equal(overlay.lifts, 2, 'A hidden perched avatar must stay hidden with its window');
  overlay.showInactive();
  assert.equal(overlay.lifts, 3);
  overlay.destroyed = true;
  assert.equal(avatar.raiseOverlay(), false);
  assert.equal(avatar.showParked(), false);
  assert.equal(overlay.lifts, 3);
});

test('a visible overlay recovers from another topmost app without a busy loop and stops on close', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const { overlay } = fixture();
  overlay.showInactive();
  context.mock.timers.tick(749);
  assert.equal(overlay.lifts, 1);
  context.mock.timers.tick(1);
  assert.equal(overlay.lifts, 2);
  overlay.visible = false;
  context.mock.timers.tick(750);
  assert.equal(overlay.lifts, 2, 'Minimized/hidden perches do not compete for the topmost band');
  overlay.showInactive();
  assert.equal(overlay.lifts, 3);
  overlay.destroyed = true;
  overlay.emit('closed');
  context.mock.timers.tick(3000);
  assert.equal(overlay.lifts, 3, 'Closing the overlay removes its restack timer');
});
