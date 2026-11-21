// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { AvatarRoaming, chooseRoamingDisplay } from '../apps/desktop/avatar-roaming.mjs';
import {
  COMPANION_DEFAULTS,
  validateCompanionSettings,
} from '../apps/desktop/companion-settings.mjs';
import { Preferences } from '../apps/desktop/preferences.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const on = { avatarRoaming: true, avatarRoamIntervalSeconds: 30 };
test('old settings upgrade to opt-in roaming; frequency is bounded and persists', (t) => {
  const defaults = validateCompanionSettings({ wakeSound: 'off' });
  assert.equal(defaults.avatarRoaming, false);
  assert.equal(defaults.avatarRoamMonitors, 'current');
  assert.equal(defaults.avatarRoamIntervalSeconds, 120);
  for (const value of [
    { avatarRoaming: 'yes' },
    { avatarRoamMonitors: 'primary' },
    { avatarRoamIntervalSeconds: 29 },
    { avatarRoamIntervalSeconds: 1801 },
    { avatarRoamIntervalSeconds: NaN },
    { avatarRoamIntervalSeconds: 45.5 },
  ])
    assert.throws(() => validateCompanionSettings(value));
  const folder = mkdtempSync(path.join(tmpdir(), 'capri-roaming-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'settings.json');
  const saved = new Preferences(file, COMPANION_DEFAULTS, validateCompanionSettings);
  saved.set({ ...defaults, ...on, avatarRoamMonitors: 'pointer' });
  assert.deepEqual(
    new Preferences(file, COMPANION_DEFAULTS, validateCompanionSettings).snapshot(),
    saved.snapshot(),
  );
});

test('roaming chooses another monitor or follows the pointer without an observation grant', () => {
  const displays = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const choose = (mode, options) =>
    chooseRoamingDisplay({
      mode,
      displays,
      currentId: 1,
      pointerId: 3,
      random: () => 0,
      ...options,
    });
  assert.equal(choose('current'), displays[0]);
  assert.equal(choose('any'), displays[1]);
  assert.equal(choose('any', { random: () => 0.99 }), displays[2]);
  assert.equal(choose('pointer'), displays[2]);
  assert.equal(choose('pointer', { displays: displays.slice(0, 2) }), displays[0]);
  assert.equal(choose('any', { displays: displays.slice(0, 1) }), displays[0]);
  assert.equal(choose('any', { displays: [] }), undefined);
});

test('current or observed mode preserves the existing observation targets', () => {
  const displays = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const observed = new Set([2, 4]);
  const options = { displays, currentId: 1, observed, pointerId: 3, random: () => 0.99 };
  assert.equal(chooseRoamingDisplay({ mode: 'current', ...options }), displays[1]);
  assert.equal(
    chooseRoamingDisplay({ mode: 'current', ...options, observed: new Set([4]) }),
    undefined,
  );
  // Screen observation permissions do not constrain geometry-only roaming.
  assert.equal(chooseRoamingDisplay({ mode: 'any', ...options }), displays[2]);
  assert.equal(chooseRoamingDisplay({ mode: 'pointer', ...options }), displays[2]);
});

test('changing the monitor preference invalidates a pending move and restarts the interval', () => {
  let now = 0;
  const scheduler = new AvatarRoaming({ now: () => now, random: () => 0 });
  scheduler.postpone(on);
  const ticket = scheduler.revision;
  const follow = { ...on, avatarRoamMonitors: 'pointer' };
  now = 29_000;
  assert.equal(scheduler.current(follow, ticket), false);
  now = 30_000;
  assert.equal(scheduler.due(follow), false);
  now = 59_000;
  assert.equal(scheduler.due(follow), true);
});
test('enable/disable and interval changes restart the pause instead of teleporting immediately', () => {
  let now = 0;
  const scheduler = new AvatarRoaming({ now: () => now, random: () => 0 });
  assert.equal(scheduler.due({}), false);
  now = 999999;
  assert.equal(scheduler.due({}), false);
  assert.equal(scheduler.due(on), false);
  now += 30000;
  assert.equal(scheduler.due(on), true);
  assert.equal(scheduler.due({ ...on, avatarRoaming: false }), false);
  assert.equal(scheduler.due(on), false);
  now += 30000;
  assert.equal(scheduler.due({ ...on, avatarRoamIntervalSeconds: 1800 }), false);
  now += 1799999;
  assert.equal(scheduler.due({ ...on, avatarRoamIntervalSeconds: 1800 }), false);
  now++;
  assert.equal(scheduler.due({ ...on, avatarRoamIntervalSeconds: 1800 }), true);
});
test('busy interaction, sleep, hidden windows and resume cannot queue a burst of moves', () => {
  let now = 0;
  const scheduler = new AvatarRoaming({ now: () => now, random: () => 0 });
  scheduler.due(on);
  now = 3600000;
  assert.equal(scheduler.due(on, { blocked: true }), false);
  assert.equal(scheduler.due(on), false);
  now += 4999;
  assert.equal(scheduler.due(on), false);
  now++;
  assert.equal(scheduler.due(on), true);
  scheduler.postpone(on);
  assert.equal(scheduler.due(on), false);
  now += 29999;
  assert.equal(scheduler.due(on), false);
  now++;
  assert.equal(scheduler.due(on), true);
});
test('random intervals never exceed the requested movement frequency; manual actions get a cooldown', () => {
  let now = 0;
  const scheduler = new AvatarRoaming({ now: () => now, random: () => 1 });
  scheduler.due(on);
  now = 35999;
  assert.equal(scheduler.due(on), false);
  now++;
  assert.equal(scheduler.due(on), true);
  scheduler.postpone(on, 90000);
  now += 89999;
  assert.equal(scheduler.due(on), false);
  now++;
  assert.equal(scheduler.due(on), true);
});

test('manual placement, disabling or a frequency change invalidate a pending automatic destination', () => {
  const scheduler = new AvatarRoaming({ now: () => 0, random: () => 0 });
  scheduler.postpone(on);
  const ticket = scheduler.revision;
  assert.equal(scheduler.current(on, ticket), true);
  scheduler.postpone(on, 60000);
  assert.equal(scheduler.current(on, ticket), false);
  const next = scheduler.revision;
  assert.equal(scheduler.current({ ...on, avatarRoaming: false }, next), false);
  scheduler.postpone(on);
  assert.equal(
    scheduler.current({ ...on, avatarRoamIntervalSeconds: 120 }, scheduler.revision),
    false,
  );
});
