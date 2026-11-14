// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { responseTimingRecord } from '../packages/runtime/src/response-timing-schema.mjs';
import {
  ResponseTimingLog,
  configureResponseTimings,
  withResponseTiming,
  acknowledgeResponsePaint,
} from '../packages/runtime/src/response-timing.mjs';
import {
  ProviderTimingTap,
  timingFetch,
  installGatewayTimingProbe,
  providerTimingSpan,
  providerRequestCounts,
} from '../packages/runtime/src/response-probe.mjs';
import { privateLogRecord } from '../packages/runtime/src/privacy-log.mjs';
const id = randomUUID();
const record = (extra = {}) => ({
  event: 'response-timing',
  source: 'desktop',
  stage: 'received',
  traceId: id,
  time: new Date().toISOString(),
  ...extra,
});

test('timing records retain only bounded numeric metadata and validated technical vocabulary', () => {
  const value = responseTimingRecord(
    record({
      promptTokens: 25,
      prompt: 'private prompt',
      text: 'private reply',
      headers: { authorization: 'private key' },
      path: 'private path',
      history: ['memory'],
      durationMs: -5,
      contextCharacters: Infinity,
    }),
  );
  assert.equal(value.promptTokens, 25);
  assert(!JSON.stringify(value).includes('private'));
  assert(!Object.hasOwn(value, 'durationMs'));
  assert(!Object.hasOwn(value, 'contextCharacters'));
  assert.equal(responseTimingRecord(record({ stage: 'my private sentence' })), undefined);
  assert.equal(responseTimingRecord(record({ traceId: 'my private sentence' })), undefined);
  assert.deepEqual(privateLogRecord(JSON.stringify(value)), value);
});

test('computer outcome logs retain bounded counts and known reasons without screen or task contents', () => {
  const event = record({
    stage: 'computer_outcome',
    reason: 'checkpoint_pending',
    steps: 1,
    completedCheckpoints: 1,
    remainingCheckpoints: 2,
    goal: 'private goal',
    scene: 'private screen',
  });
  const { goal, scene, ...expected } = event;
  assert.deepEqual(privateLogRecord(JSON.stringify(event)), { schemaVersion: 1, ...expected });
  const invalid = responseTimingRecord({ ...event, reason: 'private detail', steps: 101 });
  assert.equal(invalid.reason, undefined);
  assert.equal(invalid.steps, undefined);
});

test('timing logs rotate within a fixed bound without retaining ignored content', async () => {
  const parent = path.resolve('.runtime/response-timing-unit');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'case-')),
    file = path.join(folder, 'response.jsonl');
  const log = new ResponseTimingLog(file, { maximumBytes: 4096 });
  for (let batch = 0; batch < 4; batch++) {
    for (let n = 0; n < 8; n++)
      log.write(record({ durationMs: n, prompt: 'PRIVATE-CONVERSATION-CANARY' }));
    await log.flush();
  }
  assert(statSync(file).size <= 4096);
  assert(statSync(file + '.1').size <= 4096);
  assert(!readFileSync(file, 'utf8').includes('CANARY'));
});

test('the provider tap handles split UTF-8 and reports server timing without exposing response text', () => {
  const events = [];
  const tap = new ProviderTimingTap((stage, metrics) => events.push({ stage, ...metrics }));
  const bytes = Buffer.from(
    JSON.stringify({ message: { content: 'Приватный ответ' } }) +
      '\n' +
      JSON.stringify({
        done: true,
        prompt_eval_count: 55,
        eval_count: 2,
        load_duration: 1e6,
        prompt_eval_duration: 3e6,
        eval_duration: 2e6,
        total_duration: 6e6,
      }) +
      '\n',
  );
  for (let offset = 0; offset < bytes.length; offset += 3)
    tap.push(bytes.subarray(offset, offset + 3));
  tap.push(undefined, true);
  assert.deepEqual(
    events.map((x) => x.stage),
    ['provider_first_token', 'provider_first_content', 'provider_finished'],
  );
  assert.equal(events[2].promptEvalMs, 3);
  assert.equal(events[2].promptTokens, 55);
  assert(!JSON.stringify(events).includes('Приватный'));
  assert.equal(tap.pending, '');
});

test('timing the first visible frame is bounded, once per known turn and rejects arbitrary IDs', async () => {
  const events = [];
  configureResponseTimings({ write: (value) => events.push(value) });
  await withResponseTiming(id, async () => {});
  assert.equal(acknowledgeResponsePaint('unknown', 1), false);
  assert.equal(acknowledgeResponsePaint(id, -1), false);
  assert.equal(acknowledgeResponsePaint(id, 20), true);
  assert.equal(acknowledgeResponsePaint(id, 25), false);
  assert.equal(events.at(-1).stage, 'first_paint');
  configureResponseTimings(null);
});

test('hidden reasoning and visible text are timed separately and only lengths survive', () => {
  const events = [];
  const tap = new ProviderTimingTap((stage, metrics) => events.push({ stage, ...metrics }));
  for (const message of [{ thinking: 'PRIVATE' }, { thinking: 'THOUGHTS' }, { content: 'Ready.' }])
    tap.push(JSON.stringify({ message }) + '\n');
  assert.deepEqual(
    events.map((x) => x.stage),
    ['provider_first_token', 'provider_first_content'],
  );
  assert.equal(events[1].reasoningCharactersBeforeText, 15);
  assert(!JSON.stringify(events).includes('PRIVATE'));
  assert.deepEqual(
    providerRequestCounts(
      JSON.stringify({
        model: 'fixture',
        shift: false,
        truncate: false,
        think: false,
        options: { num_ctx: 32768 },
        tools: [{ function: { name: 'PRIVATE-TOOL' } }],
      }),
    ).toolCount,
    1,
  );
  assert(
    !JSON.stringify(providerRequestCounts('{"messages":[{"content":"PRIVATE"}]}')).includes(
      'PRIVATE',
    ),
  );
});

test('the real native gateway adapter emits correlated timings without replacing guarded fetch', async () => {
  const { applyOpenClawCompatibility } = await import('../scripts/openclaw-compat.mjs');
  applyOpenClawCompatibility(path.resolve('.'));
  const { createOllamaStreamFn } = await import(
    '../node_modules/openclaw/dist/stream.runtime-DVVOeOOt.mjs'
  );
  const events = [],
    hook = Symbol.for('capri.providerTiming'),
    old = globalThis[hook];
  configureResponseTimings({ write: (value) => events.push(value) });
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* Drain the real guarded request. */
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(
      JSON.stringify({
        message: { role: 'assistant', content: 'Ready.' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 12,
        load_duration: 3000000,
      }) + '\n',
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port,
    traceId = randomUUID();
  globalThis[hook] = (url, body) => providerTimingSpan(url, body, { ollamaPort: port });
  try {
    await withResponseTiming(
      traceId,
      async () => {
        const stream = createOllamaStreamFn(`http://127.0.0.1:${port}`);
        for await (const _event of stream(
          {
            id: 'fixture',
            name: 'fixture',
            provider: 'ollama',
            api: 'ollama',
            input: ['text'],
            reasoning: false,
            contextWindow: 32768,
            maxTokens: 2048,
            params: { num_ctx: 32768 },
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
          { messages: [{ role: 'user', content: [{ type: 'text', text: 'PRIVATE-REQUEST' }] }] },
        )) {
        }
      },
      'gateway',
    );
    assert(events.some((x) => x.stage === 'provider_finished' && x.loadMs === 3));
    assert(events.every((x) => x.traceId === traceId));
    assert.equal(events.find((x) => x.stage === 'provider_request').linked, 1);
    assert(!JSON.stringify(events).includes('PRIVATE-REQUEST'));
  } finally {
    globalThis[hook] = old;
    configureResponseTimings(null);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real loopback gateway/provider streaming preserves bytes and associates stage timings', async () => {
  const events = [];
  configureResponseTimings({ write: (value) => events.push(value) });
  const provider = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'x-test': 'preserved' });
    res.write('{"message":{"content":"Ready."}}\n');
    await new Promise((resolve) => setTimeout(resolve, 15));
    res.end('{"done":true,"prompt_eval_count":3,"prompt_eval_duration":2000000}\n');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const original = globalThis.fetch,
    undo = installGatewayTimingProbe();
  globalThis.fetch = timingFetch(original, { ollamaPort: provider.address().port });
  const gateway = createServer(async (req, res) => {
    const result = await fetch(`http://127.0.0.1:${provider.address().port}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'PRIVATE-INPUT-CANARY' }],
      }),
    });
    assert.equal(result.headers.get('x-test'), 'preserved');
    let bytes = '';
    for await (const chunk of result.body) bytes += Buffer.from(chunk).toString();
    assert.equal(
      bytes,
      '{"message":{"content":"Ready."}}\n{"done":true,"prompt_eval_count":3,"prompt_eval_duration":2000000}\n',
    );
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Ready."}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  try {
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const traceId = randomUUID();
    const response = await original(
      `http://127.0.0.1:${gateway.address().port}/v1/chat/completions`,
      { method: 'POST', headers: { 'x-capri-trace-id': traceId } },
    );
    assert.match(await response.text(), /Ready/);
    await new Promise((resolve) => setImmediate(resolve));
    for (const stage of [
      'gateway_received',
      'provider_request',
      'provider_headers',
      'provider_first_token',
      'provider_finished',
      'gateway_first_delta',
      'gateway_finished',
    ])
      assert(
        events.some((x) => x.stage === stage && x.traceId === traceId),
        stage,
      );
    assert(!JSON.stringify(events).includes('CANARY'));
  } finally {
    globalThis.fetch = original;
    undo();
    configureResponseTimings(null);
    gateway.closeAllConnections();
    provider.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => gateway.close(resolve)),
      new Promise((resolve) => provider.close(resolve)),
    ]);
  }
});

test('remote providers and requests outside a traced turn are passed through unchanged', async () => {
  const response = new Response('untouched');
  let calls = 0;
  const original = async () => {
    calls++;
    return response;
  };
  const fetchImpl = timingFetch(original, { ollamaPort: 11435 });
  await withResponseTiming(randomUUID(), async () =>
    assert.equal(await fetchImpl('https://example.com/api/chat', { body: 'PRIVATE' }), response),
  );
  assert.equal(await fetchImpl('http://127.0.0.1:11435/api/chat', { body: 'PRIVATE' }), response);
  assert.equal(calls, 2);
});
