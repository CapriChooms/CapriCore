// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPullService } from '../packages/runtime/src/providers/pull-service-recovery.mjs';
import { pullModel } from '../packages/runtime/src/providers/pull-model.mjs';
const rt = { ollamaUrl: 'http://127.0.0.1:11434' };
const refused = () =>
  new TypeError('fetch failed', {
    cause: new AggregateError([
      Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
    ]),
  });
test('an exited pull service can restart without losing the same model or leaving the retry bound', async () => {
  let calls = 0,
    recoveries = 0;
  await pullModel(rt, 'qwen3.5:0.8b', {
    emit: () => {},
    sleep: async () => {},
    recoverConnection: async () => recoveries++,
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, 'qwen3.5:0.8b');
      if (++calls === 1) throw refused();
      return new Response('{"status":"success"}');
    },
  });
  assert.equal(calls, 2);
  assert.equal(recoveries, 1);
  calls = 0;
  await assert.rejects(
    pullModel(rt, 'fixture', {
      emit: () => {},
      sleep: async () => {},
      fetchImpl: async () => {
        calls++;
        throw refused();
      },
    }),
    (error) =>
      error.code === 'CAPRI_MODEL_PULL_CONNECTION_FAILED' && /ECONNREFUSED/.test(error.message),
  );
  assert.equal(calls, 4);
});
test('service recovery starts only a dead service and never kills a living or foreign process', async () => {
  const starts = [];
  const start = async (...args) => starts.push(args);
  const missing = async () => {
    throw refused();
  };
  assert.equal(
    await recoverPullService(rt, { requestImpl: missing, owned: () => false, start }),
    true,
  );
  assert.equal(starts.length, 1);
  starts.length = 0;
  assert.equal(
    await recoverPullService(rt, {
      requestImpl: async () => ({ version: 'fixture' }),
      owned: () => false,
      start,
    }),
    false,
  );
  assert.equal(
    await recoverPullService(rt, { requestImpl: missing, owned: () => true, start }),
    false,
  );
  assert.equal(starts.length, 0);
  const controller = new AbortController();
  controller.abort(new Error('cancel'));
  await assert.rejects(
    recoverPullService(rt, { signal: controller.signal, requestImpl: missing, start }),
    /cancel/,
  );
  assert.equal(starts.length, 0);
});
