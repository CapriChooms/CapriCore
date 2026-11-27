// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendKeepWarmLog,
  keepWarmOnce,
  loopbackUrl,
  modelPing,
  startKeepWarm,
  timedPing,
  voicePing,
} from '../apps/desktop/idle-keep-warm.mjs';

const okFetch = (seen) => async (url, options) => {
  seen.push({ url, body: JSON.parse(options.body), method: options.method });
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
};

test('only addresses on this computer count as local', () => {
  for (const url of ['http://127.0.0.1:8091/v1', 'http://localhost:8092/v1', 'http://[::1]:1/'])
    assert.equal(loopbackUrl(url), true, url);
  for (const url of [
    'https://127.0.0.1:8091/v1',
    'http://192.0.2.10:8091/v1',
    'http://example.com/v1',
    'http://127.0.0.1.example.com/',
    'not a url',
    undefined,
  ])
    assert.equal(loopbackUrl(url), false, String(url));
});

test('the model ping asks for one token from the configured local server', async () => {
  const seen = [];
  await modelPing(
    { enabled: true, baseUrl: 'http://127.0.0.1:8091/v1/', model: 'gemma-4-e2b' },
    { fetchImpl: okFetch(seen) },
  );
  assert.equal(seen[0].url, 'http://127.0.0.1:8091/v1/chat/completions');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body.max_tokens, 1);
  assert.equal(seen[0].body.model, 'gemma-4-e2b');
});

test('the voice ping asks for one short word in the configured voice', async () => {
  const seen = [];
  await voicePing(
    { enabled: true, baseUrl: 'http://127.0.0.1:8092/v1', model: 'kokoro', voice: 'coral' },
    { fetchImpl: okFetch(seen) },
  );
  assert.equal(seen[0].url, 'http://127.0.0.1:8092/v1/audio/speech');
  assert.deepEqual(seen[0].body, {
    model: 'kokoro',
    voice: 'coral',
    input: 'ok',
    response_format: 'wav',
  });
});

test('pings refuse remote servers, missing settings and error replies', async () => {
  const seen = [];
  const fetchImpl = okFetch(seen);
  await assert.rejects(
    modelPing({ enabled: true, baseUrl: 'http://192.0.2.10:8091/v1', model: 'm' }, { fetchImpl }),
    /not a local address/,
  );
  await assert.rejects(
    voicePing(
      { enabled: true, baseUrl: 'https://api.example.com/v1', model: 'm', voice: 'v' },
      { fetchImpl },
    ),
    /not a local address/,
  );
  await assert.rejects(modelPing(null, { fetchImpl }), /not configured/);
  await assert.rejects(
    modelPing({ enabled: false, baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, { fetchImpl }),
    /not configured/,
  );
  await assert.rejects(
    voicePing({ enabled: true, baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, { fetchImpl }),
    /not configured/,
  );
  assert.deepEqual(seen, []);
  await assert.rejects(
    modelPing(
      { enabled: true, baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
      { fetchImpl: async () => ({ ok: false, status: 503 }) },
    ),
    /status 503/,
  );
});

test('a ping is timed, and a failing or hanging one is reported, never thrown', async () => {
  let time = 0;
  const now = () => time;
  assert.deepEqual(
    await timedPing(
      async () => {
        time += 42.4;
      },
      { now },
    ),
    { ms: 42 },
  );
  assert.deepEqual(
    await timedPing(async () => {
      throw new Error('connection refused');
    }),
    { failed: 'connection refused' },
  );
  let aborted = false;
  const hung = await timedPing(
    (signal) =>
      new Promise(() => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
      }),
    { timeoutMs: 20 },
  );
  assert.deepEqual(hung, { failed: 'timed out' });
  assert.equal(aborted, true);
});

test('a round pings every service and records one line', async () => {
  const recorded = [];
  const entry = await keepWarmOnce({
    idle: () => true,
    pings: {
      gateway: async () => {},
      model: async () => {
        throw new Error('status 503');
      },
    },
    record: (value) => recorded.push(value),
    clock: () => new Date('2026-11-24T12:00:00Z'),
  });
  assert.equal(entry.time, '2026-11-24T12:00:00.000Z');
  assert.equal(typeof entry.gateway, 'number');
  assert.equal(entry.model, 'status 503');
  assert.deepEqual(recorded, [entry]);
});

test('a round is skipped while Capri is busy and survives a failing log', async () => {
  let pinged = 0;
  const pings = {
    gateway: async () => {
      pinged++;
    },
  };
  assert.equal(await keepWarmOnce({ idle: () => false, pings }), null);
  assert.equal(pinged, 0);
  const entry = await keepWarmOnce({
    idle: () => true,
    pings,
    record: () => {
      throw new Error('disk full');
    },
  });
  assert.equal(pinged, 1);
  assert.equal(typeof entry.gateway, 'number');
  await assert.rejects(keepWarmOnce({ idle: null, pings }), TypeError);
  await assert.rejects(keepWarmOnce({ idle: () => true }), TypeError);
});

test('the log grows by one line and starts afresh when it gets large', () => {
  const files = new Map();
  const fs = {
    statSync: (file) => {
      if (!files.has(file)) throw new Error('ENOENT');
      return { size: files.get(file).length };
    },
    appendFileSync: (file, text) => files.set(file, (files.get(file) ?? '') + text),
    writeFileSync: (file, text) => files.set(file, text),
  };
  appendKeepWarmLog('log', { a: 1 }, { fs, maxBytes: 30 });
  appendKeepWarmLog('log', { a: 2 }, { fs, maxBytes: 30 });
  assert.equal(files.get('log'), '{"a":1}\n{"a":2}\n');
  appendKeepWarmLog('log', { a: 3 }, { fs, maxBytes: 30 });
  appendKeepWarmLog('log', { a: 4 }, { fs, maxBytes: 30 });
  assert.equal(files.get('log'), '{"a":4}\n');
});

test('the timer runs rounds without overlapping and can be stopped', async () => {
  let tick;
  let cleared = null;
  let release;
  let pinged = 0;
  const stop = startKeepWarm({
    intervalMs: 5,
    setIntervalImpl: (callback, ms) => {
      tick = callback;
      assert.equal(ms, 5);
      return { id: 7, unref() {} };
    },
    clearIntervalImpl: (timer) => {
      cleared = timer.id;
    },
    idle: () => true,
    pings: {
      slow: () =>
        new Promise((resolve) => {
          pinged++;
          release = resolve;
        }),
    },
  });
  const first = tick();
  await tick(); // still running: skipped
  assert.equal(pinged, 1);
  release();
  await first;
  const second = tick();
  assert.equal(pinged, 2);
  release();
  await second;
  stop();
  assert.equal(cleared, 7);
});

test('a misconfigured round is contained by the timer, and a timer without unref still stops', async () => {
  let tick;
  let cleared = null;
  const stop = startKeepWarm({
    setIntervalImpl: (callback) => {
      tick = callback;
      return 9;
    },
    clearIntervalImpl: (timer) => {
      cleared = timer;
    },
    pings: {},
  });
  await assert.doesNotReject(tick());
  stop();
  assert.equal(cleared, 9);
});

test('a ping that fails with a bare string reports the string', async () => {
  assert.deepEqual(
    await timedPing(async () => {
      throw 'plain failure';
    }),
    { failed: 'plain failure' },
  );
});

test('a ping that fails with no error value still reports a readable reason', async () => {
  assert.deepEqual(
    await timedPing(async () => {
      throw null;
    }),
    { failed: 'null' },
  );
});
