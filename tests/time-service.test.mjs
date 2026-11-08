// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { TimeService, reminderInstant } from '../packages/runtime/src/time/service.mjs';
const parent = path.resolve('.runtime/time-unit');
mkdirSync(parent, { recursive: true });
function fixture(options = {}) {
  let wall = Date.parse('2026-10-31T12:00:00Z'),
    tick = 0;
  const file = path.join(mkdtempSync(path.join(parent, 'case-')), 'time.sqlite');
  const delivered = [];
  const opts = {
    file,
    now: () => wall,
    monotonic: () => tick,
    timeZone: 'Europe/Berlin',
    deliver: async (o) => delivered.push(o),
    ...options,
  };
  return {
    file,
    opts,
    get service() {
      return new TimeService(opts);
    },
    delivered,
    advance(ms, wallDelta = ms) {
      tick += ms;
      wall += wallDelta;
    },
  };
}
test('relative timers use monotonic time, persist and deliver once with an idempotent receipt', async () => {
  const f = fixture(),
    s = f.service;
  const created = await s.execute('create', { action: 'timer', seconds: 10 });
  const replay = await s.execute('create', { seconds: 10, action: 'timer' });
  assert.equal(created.id, replay.id);
  assert.equal(s.snapshot().length, 1);
  await assert.rejects(s.execute('create', { action: 'timer', seconds: 20 }), /cannot change/);
  f.advance(4000, 3600000);
  assert.equal(s.select(created.id).remainingMs, 6000);
  s.close();
  const restored = f.service;
  assert.equal(restored.select(created.id).remainingMs, 6000);
  f.advance(6100);
  await restored.tick();
  await restored.tick();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.delivered[0].id, created.id);
  restored.close();
});
test('stopwatch pause/resume and cancelled reminders never reset or re-fire unexpectedly', async () => {
  const f = fixture(),
    s = f.service;
  const stopwatch = await s.execute('sw', { action: 'stopwatch' });
  await assert.rejects(s.execute('dup', { action: 'stopwatch' }), /already running/);
  f.advance(2100);
  await s.execute('pause', { action: 'pause', id: stopwatch.id });
  f.advance(5000);
  assert.equal(s.select(stopwatch.id).elapsedMs, 2100);
  await s.execute('resume', { action: 'resume', id: stopwatch.id });
  f.advance(2000);
  assert.equal(s.select(stopwatch.id).elapsedMs, 4100);
  const reminder = await s.execute('r', { action: 'remind', title: 'Tea', seconds: 1 });
  await s.execute('cancel', { action: 'cancel', id: reminder.id });
  f.advance(2000);
  await s.tick();
  assert.equal(f.delivered.length, 0);
  s.close();
});
test('missed reminders survive process restart, rejected delivery and shutdown during delivery', async () => {
  let attempts = 0;
  const f = fixture({
      deliver: async () => {
        if (++attempts === 1) throw new Error('unavailable');
      },
    }),
    s = f.service;
  await s.execute('r', { action: 'remind', title: 'Tea', seconds: 1 });
  s.close();
  f.advance(3000);
  const restarted = f.service;
  await assert.rejects(restarted.tick(), /unavailable/);
  await restarted.tick();
  await restarted.tick();
  assert.equal(attempts, 2);
  await restarted.execute('snooze', { action: 'snooze', seconds: 1 });
  restarted.deliver = async () => restarted.close();
  f.advance(2000);
  await restarted.tick();
});
test('absolute reminders reject nonexistent and ambiguous local times without guessing DST', () => {
  assert.throws(() => reminderInstant('2026-03-29T02:30', 'Europe/Berlin'), /ambiguous/);
  assert.throws(() => reminderInstant('2026-10-25T02:30', 'Europe/Berlin'), /ambiguous/);
  assert.equal(
    reminderInstant('2026-10-25T02:30+02:00', 'Europe/Berlin'),
    Date.parse('2026-10-25T00:30Z'),
  );
});
