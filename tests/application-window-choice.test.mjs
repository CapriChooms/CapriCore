// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseApplicationWindow } from '../apps/desktop/application-window-choice.mjs';

const first = { windowId: '11866360', untrustedTitle: 'Chrome window one' };
const second = { windowId: '12325388', untrustedTitle: 'Chrome window two' };
const selection = (windows = [first, second]) => ({
  ok: true,
  needsWindow: true,
  inputPerformed: false,
  windows,
});

test('launch activates the foremost verified application window when another app is observed', () => {
  assert.equal(
    chooseApplicationWindow(selection(), { action: 'launch', observedWindowId: '999' }),
    first,
  );
  assert.equal(chooseApplicationWindow(selection(), { action: 'launch' }), first);
  assert.equal(
    chooseApplicationWindow(selection(), { action: 'launch', requireUnique: true }),
    null,
  );
});

test('the observed native candidate has priority over front-to-back order', () => {
  for (const action of ['launch', 'browser_input', 'browser_search', 'open_url'])
    assert.equal(
      chooseApplicationWindow(selection(), { action, observedWindowId: second.windowId }),
      second,
    );
});

test('navigation and text entry remain ambiguous without an observed candidate', () => {
  for (const action of ['browser_input', 'browser_search', 'open_url', 'inspect', undefined]) {
    assert.equal(chooseApplicationWindow(selection(), { action, observedWindowId: '999' }), null);
    assert.equal(chooseApplicationWindow(selection([first]), { action }), first);
  }
});

test('an explicit owner window title prevents automatic selection even for launch', () => {
  for (const windows of [[first], [first, second]])
    assert.equal(
      chooseApplicationWindow(selection(windows), {
        action: 'launch',
        observedWindowId: first.windowId,
        ownerWindowTitle: 'Owner requested window',
      }),
      null,
    );
});

test('uncertain actions and unsuccessful results never authorize a retry', () => {
  for (const result of [
    null,
    { ...selection(), ok: false },
    { ...selection(), ok: undefined },
    { ...selection(), needsWindow: false },
    { ...selection(), inputPerformed: true },
    { ...selection(), inputPerformed: undefined },
    { ...selection(), windows: {} },
  ])
    assert.equal(chooseApplicationWindow(result, { action: 'launch' }), null);
});

test('only actual bounded decimal IDs from returned native candidates can be selected', () => {
  const invalid = [
    null,
    {},
    { windowId: 123 },
    { windowId: '0' },
    { windowId: '-1' },
    { windowId: ' 123' },
    { windowId: '1'.repeat(21) },
    { windowId: 'invented' },
  ];
  assert.equal(chooseApplicationWindow(selection(invalid), { action: 'launch' }), null);
  assert.equal(
    chooseApplicationWindow(selection([...invalid, second, first]), { action: 'launch' }),
    second,
  );
  assert.equal(chooseApplicationWindow(selection([]), { action: 'launch' }), null);
});
