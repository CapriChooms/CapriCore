// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { GlitchSchedule } from '../apps/desktop/renderer/glitch-settings.mjs';
import {
  COMPANION_DEFAULTS,
  validateCompanionSettings,
} from '../apps/desktop/companion-settings.mjs';

test('existing companion preferences gain bounded visual settings without losing wake options', () => {
  const value = validateCompanionSettings({ wakeSound: 'off', buttonFeedback: false });
  assert.equal(value.glitchIntervalSeconds, 35);
  assert.equal(value.glitchStrength, 65);
  assert.equal(value.wakeSound, 'off');
  assert.equal(value.buttonFeedback, false);
  for (const extra of [
    { glitchEnabled: null },
    { glitchStrength: -1 },
    { glitchStrength: 101 },
    { glitchIntervalSeconds: 0 },
    { glitchIntervalSeconds: 121 },
    { glitchEvents: 'yes' },
  ])
    assert.throws(() => validateCompanionSettings(extra));
});

test('adjacent speech and pose events are coalesced, never queued for a delayed burst', () => {
  const schedule = new GlitchSchedule();
  assert.ok(schedule.frame(1000, 1000).strength > 0.5);
  assert.equal(schedule.frame(2000, 2000).strength, 0);
  assert.equal(schedule.frame(3000, 3000).strength, 0);
  assert.equal(schedule.frame(7100, 3000).strength, 0);
  assert.ok(schedule.frame(7200, 7200).strength > 0.5);
  // Disabling effects also consumes requests; enabling does not replay old clicks/events.
  schedule.configure({ ...COMPANION_DEFAULTS, glitchEnabled: false });
  assert.equal(schedule.frame(14000, 14000).strength, 0);
  schedule.configure(COMPANION_DEFAULTS);
  assert.equal(schedule.frame(15000, 14000).strength, 0);
});

test('intensity, event switch and reduced motion affect the procedural output', () => {
  const low = new GlitchSchedule({ glitchStrength: 20 });
  const high = new GlitchSchedule({ glitchStrength: 100 });
  assert.ok(high.frame(100, 100).strength > low.frame(100, 100).strength * 4);
  const ambient = new GlitchSchedule({ glitchEvents: false, glitchIntervalSeconds: 120 });
  assert.equal(ambient.frame(100, 100).strength, 0);
  assert.ok(
    Array.from({ length: 3750 }, (_, i) => ambient.frame(i * 32, 100)).some(
      (frame) => frame.ambient && frame.strength > 0,
    ),
  );
  assert.equal(high.frame(10000, 10000, true).strength, 0);
});
