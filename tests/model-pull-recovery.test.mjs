// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pullModel,
  transientModelPull,
  modelPullMessage,
} from '../packages/runtime/src/providers/pull-model.mjs';
const rt = { ollamaUrl: 'http://127.0.0.1:11434' };

test('Windows CDN failures retry without exposing signed download credentials', async () => {
  const messages = [];
  const failure =
    'max retries exceeded: Get "https://user:secret@cdn.example/model?X-Amz-Signature=canary": dial tcp 192.0.2.1:443: connectex: A connection attempt failed because the connected party did not properly respond after a period of time';
  let calls = 0;
  await pullModel(rt, 'fixture', {
    emit: (line) => messages.push(line),
    sleep: async () => {},
    fetchImpl: async () =>
      new Response(++calls === 1 ? JSON.stringify({ error: failure }) : '{"status":"success"}'),
  });
  assert.equal(calls, 2);
  assert.match(messages.join(' '), /Retrying 2\/4/);
  assert.doesNotMatch(messages.join(' '), /canary|secret|user@/);
  assert.match(modelPullMessage(failure), /cdn.example\/model\?\[redacted\]/);
  assert.equal(
    transientModelPull(
      new Error('read tcp 127.0.0.1:9: wsarecv: An existing connection was forcibly closed'),
    ),
    true,
  );
  assert.equal(transientModelPull(new Error('dial tcp 192.0.2.1:443: i/o timeout')), true);
  assert.equal(transientModelPull(new Error('permission denied')), false);
  assert.equal(transientModelPull(Object.assign(new Error(failure), { retryable: false })), false);
});
test('Ollama retries a registry DNS timeout through its own verified resumable pull', async () => {
  let calls = 0;
  const waits = [],
    messages = [];
  await pullModel(rt, 'fixture', {
    emit: (line) => messages.push(line),
    sleep: async (ms) => waits.push(ms),
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { model: 'fixture', stream: true });
      return new Response(
        ++calls < 3
          ? JSON.stringify({ error: 'pull model manifest: lookup registry.ollama.ai: i/o timeout' })
          : '{"status":"success"}',
      );
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 4000]);
  assert.ok(messages.some((line) => line.includes('partial downloads')));
});
test('model pull retry is bounded; missing models and cancellation do not retry', async () => {
  let calls = 0;
  await assert.rejects(
    pullModel(rt, 'fixture', {
      emit: () => {},
      sleep: async () => {},
      fetchImpl: async () => {
        calls++;
        return new Response('{"error":"lookup registry.ollama.ai: i/o timeout"}');
      },
    }),
    /i\/o timeout/,
  );
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(
    pullModel(rt, 'fixture', {
      fetchImpl: async () => {
        calls++;
        return new Response('', { status: 404 });
      },
    }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(
    pullModel(rt, 'fixture', {
      signal: controller.signal,
      emit: () => {},
      sleep: async () => controller.abort(new Error('cancelled by user')),
      fetchImpl: async () => {
        calls++;
        return new Response('', { status: 503 });
      },
    }),
    /cancelled by user/,
  );
  assert.equal(calls, 1);
});
