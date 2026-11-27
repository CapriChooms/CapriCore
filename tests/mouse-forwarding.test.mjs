import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  FORWARD_MOUSE,
  ignoreMouseOptions,
  pointerPollingReliable,
  setClickThrough,
} from '../apps/desktop/main/mouse-forwarding.mjs';
import { PointerController } from '../apps/desktop/main/pointer-controller.mjs';

test('mouse forwarding (the system-wide mouse hook) is off by default', () => {
  assert.equal(FORWARD_MOUSE, false);
  assert.deepEqual(ignoreMouseOptions(), { forward: false });
  assert.deepEqual(ignoreMouseOptions(true), { forward: true });
  // Only a real `true` turns the hook on.
  for (const value of [1, 'true', {}, null])
    assert.deepEqual(ignoreMouseOptions(value), { forward: false });
});

test('click-through is set without asking for forwarding', () => {
  const calls = [];
  const window = { setIgnoreMouseEvents: (...args) => calls.push(args) };
  setClickThrough(window, true);
  setClickThrough(window, false);
  setClickThrough(window, 'yes'); // not a real true: stays clickable
  assert.deepEqual(calls, [
    [true, { forward: false }],
    [false, { forward: false }],
    [false, { forward: false }],
  ]);
  assert.throws(() => setClickThrough(null, true), TypeError);
  assert.throws(() => setClickThrough({}, true), TypeError);
});

test('the pointer controller switches click-through without the hook', () => {
  const calls = [];
  const controller = new PointerController({
    window: {
      setIgnoreMouseEvents: (...args) => calls.push(args),
      isDestroyed: () => false,
      isVisible: () => true,
    },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    getRegions: () => null,
  });
  controller.ignored = true;
  controller.setInteractive(true);
  controller.setInteractive(true); // no change: no second call
  controller.setInteractive(false);
  assert.deepEqual(calls, [
    [false, { forward: false }],
    [true, { forward: false }],
  ]);
});

test('no Capri window code asks Electron to forward mouse movement', () => {
  const folder = new URL('../apps/desktop/main/', import.meta.url);
  const files = readdirSync(folder)
    .filter((name) => name.endsWith('.mjs') && name !== 'mouse-forwarding.mjs')
    .map((name) => new URL(name, folder));
  files.push(new URL('../apps/desktop/main.mjs', import.meta.url));
  assert.ok(files.length > 10);
  for (const file of files)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /forward\s*:\s*true/u, file.pathname);
});

test('cursor polling is trusted everywhere except a Linux Wayland session', () => {
  assert.equal(pointerPollingReliable('win32', {}), true);
  assert.equal(pointerPollingReliable('darwin', { WAYLAND_DISPLAY: 'wayland-0' }), true);
  assert.equal(pointerPollingReliable('linux', { XDG_SESSION_TYPE: 'x11' }), true);
  assert.equal(pointerPollingReliable('linux', {}), true);
  // KDE Plasma on Wayland: Capri runs under XWayland and the pointer goes stale.
  assert.equal(pointerPollingReliable('linux', { XDG_SESSION_TYPE: 'wayland' }), false);
  assert.equal(pointerPollingReliable('linux', { WAYLAND_DISPLAY: 'wayland-0' }), false);
});

test('a Wayland session keeps the window clickable instead of polling the cursor', () => {
  const calls = [];
  let reads = 0;
  const controller = new PointerController({
    window: {
      setIgnoreMouseEvents: (...args) => calls.push(args),
      isDestroyed: () => false,
      isVisible: () => true,
      getContentBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    },
    screen: {
      getCursorScreenPoint: () => {
        reads += 1;
        return { x: -1000, y: -1000 };
      },
    },
    getRegions: () => ({ controls: [], sprite: { x: 100, y: 100, width: 10, height: 10 } }),
    getMask: () => ({ alpha: new Uint8Array(1), imageSize: { width: 1, height: 1 } }),
    pollingReliable: false,
  });
  controller.tick();
  controller.tick();
  assert.equal(reads, 0, 'a stale cursor position must not be read');
  assert.deepEqual(calls, [[false, { forward: false }]]);
  assert.equal(controller.ignored, false);
});

test('a reliable pointer still goes click-through away from the controls', () => {
  const calls = [];
  const controller = new PointerController({
    window: {
      setIgnoreMouseEvents: (...args) => calls.push(args),
      isDestroyed: () => false,
      isVisible: () => true,
      getContentBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    },
    screen: { getCursorScreenPoint: () => ({ x: -1000, y: -1000 }) },
    getRegions: () => ({ controls: [], sprite: { x: 100, y: 100, width: 10, height: 10 } }),
    getMask: () => ({ alpha: new Uint8Array(1), imageSize: { width: 1, height: 1 } }),
  });
  controller.tick();
  assert.deepEqual(calls, []);
  assert.equal(controller.ignored, true);
});
