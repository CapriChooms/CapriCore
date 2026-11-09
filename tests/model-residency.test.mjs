// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ensureLanguageModelReady } from '../packages/runtime/src/providers/model-residency.mjs';
import { MutedVoiceResidency } from '../apps/desktop/voice-residency.mjs';

test('CPU preparation never warms Qwen on the GPU or mistakes a GPU runner for a CPU runner', async () => {
  let prepared;
  await ensureLanguageModelReady(
    { url: 'http://127.0.0.1:11435', model: 'fixture', contextTokens: 32768, acceleration: 'cpu' },
    {
      requestImpl: async (url, options) => {
        if (url.endsWith('/api/ps'))
          return { models: [{ name: 'fixture', context_length: 32768, size_vram: 1000 }] };
        prepared = JSON.parse(options.body);
        return { done: true };
      },
    },
  );
  assert.equal(prepared.options.num_gpu, 0);
});

test('a cold model is primed with one token while a resident model keeps its conversation cache', async (t) => {
  const calls = [];
  let resident = false;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/ps')
      return res.end(
        JSON.stringify({
          models: resident ? [{ name: 'capri-qwen3.5:2b', context_length: 32768 }] : [],
        }),
      );
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    resident = true;
    res.end('{"done":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const model = {
    url: `http://127.0.0.1:${server.address().port}`,
    model: 'capri-qwen3.5:2b',
    contextTokens: 32768,
    keepAlive: 300,
  };
  assert.deepEqual(await ensureLanguageModelReady(model), { cold: true });
  assert.deepEqual(await ensureLanguageModelReady(model), { cold: false });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'Hello.' }]);
  assert.deepEqual(calls[0].options, { num_ctx: 32768, num_predict: 1 });
  assert.equal(calls[0].think, false);
  assert.equal(calls[0].shift, false);
  assert.equal(calls[0].truncate, false);
  assert.equal(calls[0].keep_alive, 300);
  assert.equal(calls[0].tools, undefined);
});

test('model preparation handles context mismatch, provider failures and cancellation explicitly', async () => {
  const model = { url: 'http://127.0.0.1:11435', model: 'fixture', contextTokens: 32768 };
  const calls = [];
  assert.deepEqual(
    await ensureLanguageModelReady(model, {
      requestImpl: async (url, options) => {
        calls.push(options);
        return url.endsWith('/api/ps')
          ? { models: [{ name: 'fixture', context_length: 8192 }] }
          : { done: true };
      },
    }),
    { cold: true },
  );
  assert.equal(calls.filter((options) => options.method === 'POST').length, 1);
  const cause = new Error('Not enough memory to load model');
  await assert.rejects(
    ensureLanguageModelReady(model, {
      requestImpl: async () => {
        throw cause;
      },
    }),
    (error) => error.code === 'CAPRI_MODEL_NOT_READY' && error.cause === cause,
  );
  await assert.rejects(
    ensureLanguageModelReady(model, {
      requestImpl: async (url) => (url.endsWith('/api/ps') ? {} : { done: false }),
    }),
    { code: 'CAPRI_MODEL_NOT_READY' },
  );
  const controller = new AbortController();
  controller.abort(new Error('Owner stopped this turn'));
  await assert.rejects(
    ensureLanguageModelReady(model, {
      signal: controller.signal,
      requestImpl: async () => assert.fail('Request after cancellation'),
    }),
    /Owner stopped/,
  );
});

test('a cold auto runner reports actual CPU residency without mistaking a missing GPU counter for CPU', async () => {
  let warmed = false;
  const result = await ensureLanguageModelReady(
    { url: 'http://127.0.0.1:11435', model: 'fixture', contextTokens: 32768 },
    {
      requestImpl: async (url) => {
        if (url.endsWith('/api/ps'))
          return {
            models: warmed
              ? [{ name: 'fixture', context_length: 32768, size: 2 ** 30, size_vram: 0 }]
              : [],
          };
        warmed = true;
        return { done: true };
      },
    },
  );
  assert.deepEqual(result, {
    cold: true,
    residentBytes: 2 ** 30,
    residentGpuBytes: 0,
    residentContextTokens: 32768,
  });
  let reads = 0;
  const unknown = await ensureLanguageModelReady(
    { url: 'http://127.0.0.1:11435', model: 'fixture', contextTokens: 32768 },
    {
      requestImpl: async (url) => {
        if (!url.endsWith('/api/ps')) return { done: true };
        if (++reads > 1) throw Error('Optional metadata unavailable');
        return { models: [] };
      },
    },
  );
  assert.deepEqual(unknown, { cold: true });
});

test('muted voice unloads once and concurrent starts can await the same termination', async () => {
  let finishStop,
    stops = 0,
    cancels = 0;
  const stopping = new Promise((resolve) => {
    finishStop = resolve;
  });
  const service = new MutedVoiceResidency({
    enabled: true,
    needed: () => false,
    resident: () => true,
    cancel: () => cancels++,
    starting: () => null,
    stop: async () => {
      stops++;
      await stopping;
    },
  });
  const first = service.release();
  assert.equal(first, service.release());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stops, 1);
  assert.equal(cancels, 1);
  let start = false;
  const nextStart = service.pending.then(() => {
    start = true;
  });
  assert.equal(start, false);
  finishStop();
  assert.equal(await first, true);
  await nextStart;
  assert.equal(start, true);
  assert.equal(service.diagnostics().releases, 1);
  assert.equal(service.pending, null);
});

test('preview/unmute wins a startup race, large-memory policy stays warm and unload failures remain retryable', async () => {
  let enabled = false,
    finishStart,
    stops = 0;
  const starting = new Promise((resolve) => {
    finishStart = resolve;
  });
  const service = new MutedVoiceResidency({
    enabled: true,
    needed: () => enabled,
    resident: () => true,
    cancel: () => {},
    starting: () => starting,
    stop: async () => {
      stops++;
    },
  });
  const release = service.release();
  enabled = true;
  finishStart();
  assert.equal(await release, false);
  assert.equal(stops, 0);
  assert.equal(await service.release(), false, 'active voice/preview is kept');
  service.enabled = false;
  enabled = false;
  assert.equal(await service.release(), false, 'larger PCs keep the warm service');
  service.enabled = true;
  service.stop = async () => {
    throw new Error('Stop fixture failure');
  };
  await assert.rejects(service.release(), /Stop fixture failure/);
  assert.equal(service.pending, null);
  assert.equal(service.diagnostics().lastError.message, 'Stop fixture failure');
  service.stop = async () => {};
  assert.equal(await service.release(), true);
  assert.equal(service.diagnostics().lastError, null);
});
