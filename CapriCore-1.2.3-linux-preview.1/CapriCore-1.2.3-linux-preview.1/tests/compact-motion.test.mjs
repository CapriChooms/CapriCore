// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceModel, interfaceFloat } from '../apps/desktop/renderer/presence-model.mjs';
import { floatLimits, validateMotionSettings } from '../apps/desktop/renderer/motion-settings.mjs';
import { validateCompanionSettings } from '../apps/desktop/companion-settings.mjs';

test('compact replies preserve real speaking state, allow manual expansion and default to revealing', () => {
  for (const expand of [false, true]) {
    const p = new PresenceModel();
    p.phase = 'ready';
    p.expandOnReply = expand;
    p.wakeUp({ reveal: p.expandOnReply });
    assert.equal(p.snapshot().expanded, expand);
    p.begin('a');
    p.text('a');
    assert.equal(p.snapshot().expanded, expand);
    p.finish('a');
    p.playback({ busy: true, speaking: true });
    assert.equal(p.snapshot().state, 'speaking');
    assert.equal(p.snapshot().expanded, expand);
    if (!expand) {
      p.toggle();
      assert.equal(p.snapshot().expanded, true);
    }
  }
  assert.equal(new PresenceModel().expandOnReply, true);
  assert.equal(validateCompanionSettings({}).expandOnReply, true);
  assert.throws(() => validateCompanionSettings({ expandOnReply: 'false' }));
});

test('changing auto-expand does not collapse an open portrait and stale text cannot expand it', () => {
  const p = new PresenceModel();
  p.reveal();
  p.expandOnReply = false;
  p.text('obsolete');
  assert.equal(p.expanded, true);
  p.expanded = false;
  p.begin('new');
  p.expandOnReply = true;
  p.text('old');
  assert.equal(p.expanded, false);
  p.text('new');
  assert.equal(p.expanded, true);
});

test('restoring from the tray on voice wake is enabled for existing settings and independent of portrait expansion', () => {
  assert.equal(validateCompanionSettings({ expandOnReply: false }).restoreFromTrayOnWake, true);
  assert.equal(validateCompanionSettings({ restoreFromTrayOnWake: false }).expandOnReply, true);
  assert.throws(() => validateCompanionSettings({ restoreFromTrayOnWake: 'false' }));
});

test('floating motion stays finite, within its amplitude, and scales with the chosen cycle', () => {
  assert.equal(validateCompanionSettings({}).floatEnabled, false);
  assert.equal(validateCompanionSettings({ floatEnabled: true }).floatEnabled, true);
  for (const amplitude of [0, 6, 24])
    for (const periodSeconds of [4, 10, 30])
      for (let now = 0; now < 120000; now += 80) {
        const position = interfaceFloat(now, { amplitude, periodSeconds });
        assert.ok(Number.isFinite(position) && Math.abs(position) <= amplitude);
      }
  assert.equal(
    interfaceFloat(2000, { amplitude: 10, periodSeconds: 8 }),
    interfaceFloat(1000, { amplitude: 10, periodSeconds: 4 }),
  );
  assert.deepEqual(floatLimits([{ top: 14, bottom: 650 }], 660), { min: -10, max: 6 });
  assert.deepEqual(floatLimits([{ top: 500, bottom: 650 }], 660), { min: -496, max: 6 });
  assert.deepEqual(floatLimits([], 660), { min: 0, max: 0 });
  for (const value of [
    { floatAmplitude: -1 },
    { floatAmplitude: 25 },
    { floatPeriodSeconds: 0 },
    { floatEnabled: 'yes' },
  ])
    assert.throws(() => validateMotionSettings(value));
});
