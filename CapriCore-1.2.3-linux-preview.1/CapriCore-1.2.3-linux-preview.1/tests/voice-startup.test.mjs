import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForVoiceReady } from '../integrations/voice_runtime/readiness.mjs';

test('cold voice startup remains pending past three minutes and accepts eventual readiness', async () => {
  let clock = 0;
  const result = await waitForVoiceReady({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    health: async () => (clock >= 220000 ? { ready: true, language: 'ru' } : null),
    isRunning: () => true,
  });
  assert.equal(result.language, 'ru');
  assert.equal(clock, 220000);
});

test('a stopped voice worker fails promptly instead of waiting ten minutes', async () => {
  let clock = 0;
  await assert.rejects(
    waitForVoiceReady({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      health: async () => {
        throw new Error('connection refused');
      },
      isRunning: () => clock < 6000,
    }),
    /process stopped/,
  );
  assert.equal(clock, 10000);
});

test('voice startup stays bounded and cancellation is preserved', async () => {
  let clock = 0;
  await assert.rejects(
    waitForVoiceReady({
      now: () => clock,
      timeout: 4000,
      sleep: async (ms) => {
        clock += ms;
      },
      health: async () => ({ ready: false }),
      isRunning: () => true,
    }),
    /loading timed out/,
  );
  const controller = new AbortController();
  controller.abort(new Error('cancel startup'));
  await assert.rejects(
    waitForVoiceReady({
      signal: controller.signal,
      health: async () => assert.fail('health checked after cancellation'),
      isRunning: () => true,
    }),
    /cancel startup/,
  );
});
