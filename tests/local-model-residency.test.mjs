// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  LocalModelResidencySampler,
  selectedModelResidency,
} from '../apps/desktop/local-model-residency.mjs';

const model = 'capri-selected:latest';
const row = (size_vram, extra = {}) => ({ name: model, size: 100, size_vram, ...extra });
const unknown = { status: 'unknown', totalBytes: null, gpuBytes: null, contextTokens: null };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const sampler = (options) =>
  new LocalModelResidencySampler({ url: 'http://127.0.0.1:11434', ...options });

test('selected model uses measured allocation counters, never GPU capacity or embedding residency', () => {
  for (const [gpu, status] of [
    [0, 'cpu'],
    [100, 'gpu'],
    [68, 'partial'],
  ]) {
    const result = selectedModelResidency(
      { models: [{ name: 'cpu-embedding', size: 900, size_vram: 0 }, row(gpu)] },
      model,
    );
    assert.equal(result.status, status);
    assert.equal(result.totalBytes, 100);
    assert.equal(result.gpuBytes, gpu);
  }
  assert.equal(selectedModelResidency({ models: [] }, model).status, 'unloaded');
  assert.equal(
    selectedModelResidency({ models: [{ name: 'embedding', size: 100, size_vram: 0 }] }, model)
      .status,
    'unloaded',
  );
  assert.deepEqual(selectedModelResidency(null, model), unknown);
  assert.deepEqual(selectedModelResidency({ models: [{}] }, model), unknown);
});

test('unknown, invalid or ambiguous counters never become CPU or GPU claims', () => {
  for (const entry of [
    row(undefined),
    row(0, { size: 0 }),
    row(-1),
    row(101),
    row(Infinity),
    row(0, { size: Number.MAX_SAFE_INTEGER + 1 }),
  ])
    assert.equal(selectedModelResidency({ models: [entry] }, model).status, 'unknown');
  assert.deepEqual(selectedModelResidency({ models: [row(0), row(100)] }, model), unknown);
});

test('implicit latest tags match the selected alias without confusing a different tag', () => {
  assert.equal(selectedModelResidency({ models: [row(100)] }, 'capri-selected').status, 'gpu');
  assert.equal(
    selectedModelResidency({ models: [row(100)] }, 'capri-selected:other').status,
    'unloaded',
  );
  assert.equal(
    selectedModelResidency(
      { models: [{ model: 'host:5000/custom:latest', size: 10, size_vram: 0 }] },
      'host:5000/custom',
    ).status,
    'cpu',
  );
});

test('bounded inventories retain a selected ninth model but do not infer absence from truncation', () => {
  const others = Array.from({ length: 8 }, (_, i) => ({
    name: `embedding-${i}`,
    size: 100,
    size_vram: 0,
  }));
  assert.equal(selectedModelResidency({ models: [...others, row(50)] }, model).status, 'partial');
  assert.equal(
    selectedModelResidency({ models: [...others, { name: 'other' }] }, model).status,
    'unknown',
  );
  assert.deepEqual(
    selectedModelResidency({ models: Array.from({ length: 33 }, () => row(100)) }, model),
    unknown,
  );
});

test('API mode, unavailable runtime and invalid endpoints never issue a request', async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return { models: [row(0)] };
  };
  const value = sampler({ read });
  assert.deepEqual(await value.sample({ model, remote: true }), unknown);
  assert.deepEqual(await value.sample({ model, available: false }), unknown);
  assert.deepEqual(await value.sample(), unknown);
  for (const url of [
    'https://127.0.0.1:11434',
    'http://provider.example:11434',
    'http://192.168.1.2:11434',
    'http://user:secret@127.0.0.1:11434',
    'http://127.0.0.1:11434/private',
    'http://127.0.0.1:11434/?token=private',
    'not a URL',
  ])
    assert.deepEqual(await sampler({ url, read }).sample({ model }), unknown);
  assert.equal(reads, 0);
});

test('concurrent consumers coalesce and repeated status reads use a bounded cache', async () => {
  const pending = deferred();
  let now = 0,
    reads = 0;
  const value = sampler({
    now: () => now,
    read: async (url, options) => {
      reads++;
      assert.equal(url, 'http://127.0.0.1:11434/api/ps');
      assert.equal(options.method, 'GET');
      assert.equal(options.maxBytes, 64 * 1024);
      assert.equal(options.timeout, 700);
      assert.equal(options.headers, undefined);
      assert.equal(options.body, undefined);
      return pending.promise;
    },
  });
  const first = value.sample({ model });
  const second = value.sample({ model });
  pending.resolve({ models: [row(100)] });
  assert.equal((await first).status, 'gpu');
  assert.equal((await second).status, 'gpu');
  assert.equal(reads, 1);
  const cached = await value.sample({ model });
  cached.status = 'cpu';
  assert.equal((await value.sample({ model })).status, 'gpu');
  assert.equal(reads, 1);
  now = 2000;
  await value.sample({ model });
  assert.equal(reads, 2);
});

test('a failed refresh clears stale GPU counters and backs off without exposing errors', async () => {
  let now = 0,
    reads = 0;
  const value = sampler({
    now: () => now,
    read: async () => {
      if (++reads === 1) return { models: [row(100)] };
      throw Error('private key and private path must not escape');
    },
  });
  assert.equal((await value.sample({ model })).status, 'gpu');
  now = 2000;
  assert.deepEqual(await value.sample({ model }), unknown);
  now = 11999;
  assert.deepEqual(await value.sample({ model }), unknown);
  assert.equal(reads, 2);
  now = 12000;
  assert.doesNotMatch(JSON.stringify(await value.sample({ model })), /private|key|path/);
  assert.equal(reads, 3);
});

test('unresponsive probes are bounded even when their reader ignores cancellation', async () => {
  let reads = 0,
    signal;
  const value = sampler({
    timeoutMs: 15,
    read: async (_url, options) => {
      reads++;
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  assert.deepEqual(await value.sample({ model }), unknown);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await value.sample({ model }), unknown);
  assert.equal(reads, 1);
});

test('selection changes invalidate pending readings and cannot resurrect the previous model', async () => {
  const old = deferred();
  let reads = 0,
    previousSignal;
  const value = sampler({
    read: async (_url, options) => {
      if (++reads === 1) {
        previousSignal = options.signal;
        return old.promise;
      }
      return { models: [{ name: 'new-model', size: 100, size_vram: 0 }] };
    },
  });
  const previous = value.sample({ model });
  await Promise.resolve();
  assert.equal((await value.sample({ model: 'new-model' })).status, 'cpu');
  assert.equal(previousSignal.aborted, true);
  old.resolve({ models: [row(100)] });
  assert.deepEqual(await previous, unknown);
  assert.equal((await value.sample({ model: 'new-model' })).status, 'cpu');
  assert.equal(reads, 2);
});

test('switching to API mode aborts pending local reads and drops cached residency', async () => {
  const pending = deferred();
  let reads = 0;
  const value = sampler({
    read: async () => {
      reads++;
      return pending.promise;
    },
  });
  const local = value.sample({ model });
  await Promise.resolve();
  assert.deepEqual(await value.sample({ model, remote: true }), unknown);
  pending.resolve({ models: [row(100)] });
  assert.deepEqual(await local, unknown);
  assert.deepEqual(value.value, unknown);
  assert.equal(reads, 1);
});

test('manual invalidation forces a fresh read, without retaining server names or private extras', async () => {
  let reads = 0;
  const value = sampler({
    read: async () => {
      reads++;
      return {
        models: [
          row(50, {
            prompt: 'private-content',
            digest: 'private-digest',
            token: 'private-key',
            context_length: 32768,
          }),
        ],
      };
    },
  });
  const result = await value.sample({ model });
  assert.deepEqual(result, {
    status: 'partial',
    totalBytes: 100,
    gpuBytes: 50,
    contextTokens: 32768,
  });
  assert.doesNotMatch(JSON.stringify(result), /private|capri-selected|digest|prompt|token/);
  value.invalidate();
  await value.sample({ model });
  assert.equal(reads, 2);
});

test('direct HTTP reader rejects redirects, encodings and oversized payloads without credentials or proxy dispatch', async () => {
  const requests = [];
  let mode = 'okay';
  const previousFetch = globalThis.fetch;
  const previousProxy = process.env.HTTP_PROXY;
  globalThis.fetch = () => {
    throw Error('Global fetch must not handle local residency.');
  };
  process.env.HTTP_PROXY = 'http://provider.example:3128';
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
    });
    if (mode === 'redirect') {
      res.writeHead(302, { location: 'http://provider.example/private' });
      res.end();
    } else if (mode === 'large') res.end(JSON.stringify({ models: [], extra: 'x'.repeat(70000) }));
    else if (mode === 'encoded') {
      res.setHeader('content-encoding', 'gzip');
      res.end(JSON.stringify({ models: [row(100)] }));
    } else res.end(JSON.stringify({ models: [row(68)] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const value = sampler({ url: `http://127.0.0.1:${server.address().port}` });
    assert.equal((await value.sample({ model })).status, 'partial');
    mode = 'redirect';
    value.invalidate();
    assert.deepEqual(await value.sample({ model }), unknown);
    mode = 'large';
    value.invalidate();
    assert.deepEqual(await value.sample({ model }), unknown);
    mode = 'encoded';
    value.invalidate();
    assert.deepEqual(await value.sample({ model }), unknown);
    assert.deepEqual(
      requests,
      Array.from({ length: 4 }, () => ({
        method: 'GET',
        path: '/api/ps',
        authorization: undefined,
        cookie: undefined,
      })),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = previousProxy;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
