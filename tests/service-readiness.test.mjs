// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForOwnedService } from '../packages/runtime/src/host/readiness.mjs';
const owner = { pid: 1234, startedAt: 'fixture-creation-time' };
function clock(overrides = {}) {
  let elapsed = 0;
  return {
    name: 'capri',
    label: 'OpenClaw',
    getProcess: () => owner,
    now: () => elapsed,
    pause: async (ms) => {
      elapsed += ms;
    },
    elapsed: () => elapsed,
    ...overrides,
  };
}
test('a fresh Gateway can become ready after the old 120-second cutoff without relaunching', async () => {
  const options = clock();
  let probes = 0;
  const ready = await waitForOwnedService(async () => {
    probes++;
    if (options.elapsed() < 186000) throw new Error('fetch failed');
    return { ready: true };
  }, options);
  assert.equal(ready.ready, true);
  assert.equal(options.elapsed(), 186000);
  assert.ok(probes > 120);
});
test('startup fails promptly if the owned process exits or its PID is reused', async () => {
  for (const replacement of [null, { ...owner, startedAt: 'another-process' }]) {
    const options = clock();
    options.getProcess = () => (options.elapsed() >= 5000 ? replacement : owner);
    await assert.rejects(
      waitForOwnedService(async () => false, options),
      { code: 'CAPRI_SERVICE_EXITED' },
    );
    assert.equal(options.elapsed(), 5000);
  }
});
test('a hung live process still has a bounded startup deadline and cancellation', async () => {
  const options = clock({ timeout: 9000 });
  await assert.rejects(
    waitForOwnedService(async () => false, options),
    { code: 'CAPRI_SERVICE_STARTUP_TIMEOUT' },
  );
  assert.equal(options.elapsed(), 9000);
  const controller = new AbortController();
  const cancelled = clock({ signal: controller.signal });
  await assert.rejects(
    waitForOwnedService(async () => {
      controller.abort(new Error('stop startup'));
      throw new Error('fetch failed');
    }, cancelled),
    /stop startup/,
  );
  assert.equal(cancelled.elapsed(), 0);
});
