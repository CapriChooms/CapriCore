import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  FORWARD_MOUSE,
  ignoreMouseOptions,
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
