// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { responsiveness } from '../packages/runtime/src/hardware/responsiveness.mjs';
import { consumeFirstLaunchPreload, startModelServices } from '../apps/desktop/model-startup.mjs';

test('first-launch warmup defaults on and an explicit opt-out is consumed once', (t) => {
  const state = mkdtempSync(path.join(tmpdir(), 'capri-first-launch-'));
  const file = path.join(state, 'first-start.json');
  t.after(() => {
    rmSync(file, { force: true });
    rmdirSync(state);
  });
  assert.equal(consumeFirstLaunchPreload(state), true);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, preloadModels: false }));
  assert.equal(consumeFirstLaunchPreload(state), false);
  assert.equal(existsSync(file), false);
  assert.equal(consumeFirstLaunchPreload(state), true);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, preloadModels: 'false' }));
  assert.equal(consumeFirstLaunchPreload(state), true);
});

test('8/16 GiB PCs get bounded cold-start budgets while larger automatic setups keep fast deadlines', () => {
  for (const ram of [8, 15.88, 16, 17]) {
    const plan = responsiveness({ ramBytes: ram * 1024 ** 3, resourceProfile: 'balanced' });
    assert.equal(plan.sequentialModels, true);
    assert.equal(plan.firstTextTimeoutMs, 120000);
    assert.equal(plan.agentWarmupTimeoutMs, 180000);
    assert.equal(plan.timeoutMs, 300000);
  }
  for (const ram of [24, 32, 48, 64]) {
    const plan = responsiveness({ ramBytes: ram * 1024 ** 3 });
    assert.equal(plan.sequentialModels, false);
    assert.equal(plan.firstTextTimeoutMs, 30000);
    assert.equal(plan.timeoutMs, 180000);
  }
  assert.equal(
    responsiveness({ ramBytes: 48 * 1024 ** 3, acceleration: 'cpu' }).firstTextTimeoutMs,
    120000,
  );
  assert.equal(
    responsiveness({ ramBytes: 48 * 1024 ** 3, resourceProfile: 'minimal' }).firstTextTimeoutMs,
    120000,
  );
});

test('low-memory startup finishes core and recognition before importing the voice model', async () => {
  const events = [];
  let finishCore;
  const coreReady = new Promise((resolve) => {
    finishCore = resolve;
  });
  const work = startModelServices({
    sequential: true,
    core: async () => {
      events.push('core-start');
      await coreReady;
      events.push('core-ready');
    },
    recognition: async () => {
      events.push('recognition');
    },
    voice: async () => {
      events.push('voice');
    },
  });
  await Promise.resolve();
  assert.deepEqual(events, ['core-start']);
  finishCore();
  const result = await work;
  assert.deepEqual(events, ['core-start', 'core-ready', 'recognition', 'voice']);
  assert.ok(result.every((item) => item.status === 'fulfilled'));
});

test('parallel startup still starts independent services together on larger machines', async () => {
  const events = [];
  let finishCore;
  const work = startModelServices({
    core: () =>
      new Promise((resolve) => {
        events.push('core');
        finishCore = resolve;
      }),
    voice: async () => {
      events.push('voice');
    },
    recognition: async () => {
      events.push('recognition');
    },
  });
  await Promise.resolve();
  assert.deepEqual(events, ['core', 'recognition', 'voice']);
  finishCore();
  assert.equal((await work).length, 3);
});

test('failed core or shutdown cannot leave queued speech startup running in the background', async () => {
  for (const fail of [true, false]) {
    let continueStartup = true;
    const events = [];
    const result = await startModelServices({
      sequential: true,
      shouldContinue: () => continueStartup,
      core: async () => {
        events.push('core');
        continueStartup = false;
        if (fail) throw new Error('core unavailable');
      },
      recognition: () => assert.fail('recognition started after failed/cancelled core'),
      voice: () => assert.fail('voice started after failed/cancelled core'),
    });
    assert.deepEqual(events, ['core']);
    assert.equal(result[0].status, fail ? 'rejected' : 'fulfilled');
  }
});

test('an optional recognition failure does not stop text core or voice preparation', async () => {
  const events = [];
  const result = await startModelServices({
    sequential: true,
    core: () => events.push('core'),
    recognition: () => {
      throw new Error('recognizer missing');
    },
    voice: () => events.push('voice'),
  });
  assert.deepEqual(events, ['core', 'voice']);
  assert.deepEqual(
    result.map((item) => item.status),
    ['fulfilled', 'rejected', 'fulfilled'],
  );
});
