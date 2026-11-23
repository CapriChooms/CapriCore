// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureEmbeddingModel } from '../packages/runtime/src/providers/embedding-model.mjs';

const rt = { ollamaUrl: 'http://127.0.0.1:11435' };
const inventory = (...names) => ({ models: names.map((name) => ({ name })) });

test('an existing memory alias is a no-op with no model or memory changes', async () => {
  const current = inventory('capri-embed:latest');
  const before = structuredClone(current);
  assert.equal(
    await ensureEmbeddingModel(rt, {
      inventory: current,
      requestImpl: async () => assert.fail('No repair request is needed'),
    }),
    current,
  );
  assert.deepEqual(current, before);
});

test('a missing managed alias is recreated on CPU only from its already cached base and verified', async () => {
  const calls = [],
    current = inventory('bge-m3:latest'),
    repaired = inventory('bge-m3:latest', 'capri-embed:latest');
  const signal = new AbortController().signal;
  const result = await ensureEmbeddingModel(rt, {
    inventory: current,
    signal,
    requestImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? { status: 'success' } : repaired;
    },
  });
  assert.equal(result, repaired);
  assert.deepEqual(
    calls.map((call) => call.url),
    [rt.ollamaUrl + '/api/create', rt.ollamaUrl + '/api/tags'],
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: 'capri-embed:latest',
    from: 'bge-m3:latest',
    parameters: { num_gpu: 0 },
    stream: false,
  });
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[1].options.signal, signal);
  assert.deepEqual(current, inventory('bge-m3:latest'));
});

test('missing base weights and missing custom models request Setup repair without downloading or replacing them', async () => {
  for (const options of [
    { inventory: inventory() },
    { model: 'custom-memory:latest', inventory: inventory('bge-m3:latest') },
  ]) {
    await assert.rejects(
      ensureEmbeddingModel(rt, {
        ...options,
        requestImpl: async () => assert.fail('No weights may be downloaded or substituted'),
      }),
      { code: 'CAPRI_MEMORY_MODEL_MISSING', message: /Run Capri Setup again to repair/ },
    );
  }
  const current = inventory('custom-memory:latest');
  assert.equal(
    await ensureEmbeddingModel(rt, {
      model: 'custom-memory:latest',
      inventory: current,
      requestImpl: async () => assert.fail('Existing custom model must stay untouched'),
    }),
    current,
  );
});

test('a failed or unverified alias creation stays a startup failure with an actionable repair message', async () => {
  for (const response of [{ error: 'Synthetic local failure' }, {}]) {
    await assert.rejects(
      ensureEmbeddingModel(rt, {
        inventory: inventory('bge-m3:latest'),
        requestImpl: async (url) =>
          url.endsWith('/api/create') ? response : inventory('bge-m3:latest'),
      }),
      { code: 'CAPRI_MEMORY_MODEL_MISSING', message: /Run Capri Setup again to repair/ },
    );
  }
});

test('cancellation prevents or interrupts repair without advancing to inventory verification', async () => {
  const before = new AbortController();
  before.abort(new Error('Synthetic cancelled before repair'));
  await assert.rejects(
    ensureEmbeddingModel(rt, {
      inventory: inventory('bge-m3:latest'),
      signal: before.signal,
      requestImpl: async () => assert.fail('An aborted startup must not start repair'),
    }),
    /Synthetic cancelled before repair/,
  );
  const during = new AbortController();
  let calls = 0;
  await assert.rejects(
    ensureEmbeddingModel(rt, {
      inventory: inventory('bge-m3:latest'),
      signal: during.signal,
      requestImpl: async () => {
        calls++;
        during.abort(new Error('Synthetic cancelled during repair'));
        return {};
      },
    }),
    /Synthetic cancelled during repair/,
  );
  assert.equal(calls, 1);
});

test('core awaits verified embeddings before starting the gateway', () => {
  const source = readFileSync(
    new URL('../packages/runtime/src/providers/core.mjs', import.meta.url),
    'utf8',
  );
  const start = source.slice(
    source.indexOf('export async function startCore('),
    source.indexOf('export async function prewarmAgentRuntime('),
  );
  assert.ok(start.indexOf('await ensureEmbeddingModel(') >= 0);
  assert.ok(start.indexOf('await ensureEmbeddingModel(') < start.indexOf('await startGateway('));
  assert.match(start, /model: settings\.embeddingModel/);
});
