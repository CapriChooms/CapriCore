import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avatarTapsSleeping,
  isSleepCommand,
  SleepService,
  sleepCaption,
} from '../apps/desktop/sleep-service.mjs';

test('tap effects stay suppressed throughout sleep, disconnected resting visuals and the complete wake', () => {
  for (const [power, backend] of [
    ['sleeping', 'ready'],
    ['asleep', 'asleep'],
    ['awake', 'offline'],
    ['awake', 'stopping'],
    ['waking', 'starting'],
    ['waking', 'ready'],
  ])
    assert.equal(avatarTapsSleeping(power, backend), true, `${power}/${backend}`);
  assert.equal(avatarTapsSleeping('awake', 'ready'), false);
});

test('sleep commands accept direct English and Russian requests, never quoted or negated instructions', () => {
  for (const text of [
    'Капри, иди спать!',
    'Capri, you can sleep.',
    "Capri, it's time to sleep",
    'Hey Capri, go to sleep, please.',
    'Пора спать',
    'Капри, можешь отдохнуть',
    'пожалуйста, ложись спать',
  ])
    assert.equal(isSleepCommand(text), true, text);
  for (const text of [
    'Do not go to sleep',
    'Капри, не иди спать',
    'What does go to sleep mean?',
    'Print "Capri, go to sleep"',
    'Tell me a sleep story',
    'Play Sleep in Spotify',
    'When you can sleep, tell me',
    null,
  ])
    assert.equal(isSleepCommand(text), false, String(text));
});

test('sleep finishes unloading before concurrent wake requests reload models exactly once', async () => {
  let unloaded,
    loaded,
    unloads = 0,
    reloads = 0;
  const events = [];
  const service = new SleepService({
    unload: () => {
      unloads++;
      return new Promise((resolve) => {
        unloaded = resolve;
      });
    },
    reload: () => {
      reloads++;
      return new Promise((resolve) => {
        loaded = resolve;
      });
    },
    onChange: ({ phase }) => events.push(phase),
  });
  const sleeping = service.sleep(),
    duplicateSleep = service.sleep();
  const firstWake = service.wake(),
    secondWake = service.wake();
  assert.equal(service.phase, 'sleeping');
  assert.equal(reloads, 0);
  unloaded();
  await sleeping;
  await duplicateSleep;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.phase, 'waking');
  assert.equal(reloads, 1);
  loaded();
  await Promise.all([firstWake, secondWake]);
  assert.equal(service.phase, 'awake');
  assert.equal(unloads, 1);
  assert.deepEqual(events, ['sleeping', 'asleep', 'waking', 'awake']);
});

test('failed wake remains retryable and closing prevents model resurrection', async () => {
  let attempt = 0;
  const service = new SleepService({
    unload: async () => {},
    reload: async () => {
      if (++attempt === 1) throw new Error('fixture failure');
    },
  });
  await service.sleep();
  await assert.rejects(service.wake(), /fixture failure/);
  assert.equal(service.phase, 'asleep');
  await service.wake();
  assert.equal(service.phase, 'awake');
  service.close();
  await assert.rejects(service.wake(), /shutting down/);
});

test('sleep caption changes twice per second with low-bit-first capitals and one to three dots', () => {
  assert.deepEqual(
    Array.from({ length: 24 }, (_, i) => sleepCaption(i * 500)),
    [
      'zzz.',
      'zzz..',
      'zzz...',
      'Zzz.',
      'Zzz..',
      'Zzz...',
      'zZz.',
      'zZz..',
      'zZz...',
      'ZZz.',
      'ZZz..',
      'ZZz...',
      'zzZ.',
      'zzZ..',
      'zzZ...',
      'ZzZ.',
      'ZzZ..',
      'ZzZ...',
      'zZZ.',
      'zZZ..',
      'zZZ...',
      'ZZZ.',
      'ZZZ..',
      'ZZZ...',
    ],
  );
  assert.equal(sleepCaption(12000), 'zzz.');
  assert.equal(sleepCaption(499), 'zzz.');
});
