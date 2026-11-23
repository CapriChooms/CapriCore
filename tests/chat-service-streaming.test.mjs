// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatService, validateInput } from '../apps/desktop/chat-service.mjs';
import { sseData } from '../apps/desktop/sse.mjs';

const gatewayUrl = 'http://127.0.0.1:18789';
const agentId = 'capri';
const sessionKey = 'agent:capri:main';
const token = () => 'test-token';

// ---------- Helpers ----------

function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = encoder.encode(text);
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (key) => (key === 'content-type' ? 'text/event-stream' : null) },
    body: {
      [Symbol.asyncIterator]: async function* () {
        let offset = 0;
        while (offset < bytes.length) {
          const end = Math.min(index + 50, bytes.length);
          yield bytes.slice(index, end);
          index = end;
        }
      },
      getReader: () => ({
        read: async () => {
          if (index >= bytes.length) return { done: true, value: null };
          const end = Math.min(index + 50, bytes.length);
          const chunk = bytes.slice(index, end);
          index = end;
          return { done: false, value: chunk };
        },
        releaseLock: () => {},
      }),
    },
  };
}

function makeJsonResponse(json) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(JSON.stringify(json));
  let yielded = false;
  return {
    ok: true,
    status: 200,
    headers: { get: (key) => (key === 'content-type' ? 'application/json' : null) },
    body: {
      [Symbol.asyncIterator]: async function* () {
        if (!yielded) { yielded = true; yield bytes; }
      },
      getReader: () => ({
        read: async () => {
          if (yielded) return { done: true, value: null };
          yielded = true;
          return { done: false, value: bytes };
        },
        releaseLock: () => {},
      }),
    },
  };
}

function makeErrorResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    body: null,
  };
}

function createChatService({ enableStreaming = true, fetchImpl, ...overrides } = {}) {
  return new ChatService({
    gatewayUrl,
    agentId,
    sessionKey,
    token,
    persona: () => 'Test persona',
    store: {
      snapshot: () => [],
      put: () => {},
    },
    skills: new Map(),
    codingTask: async () => ({}),
    externalInference: false,
    fetchImpl: fetchImpl || fetch,
    enableStreaming,
    interfaceState: () => ({}),
    cpuThreads: 0,
    skipLocalModels: true,
    ...overrides,
  });
}

function collectDeltaText(events) {
  return events
    .filter((e) => e.type === 'turn.delta')
    .map((e) => e.text)
    .join('');
}

// ---------- SSE Data Parser Tests ----------

test('sseData parses tokens across packet boundaries', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
    encoder.encode('data: {"choices":[{"delta":{"content":" World"}}]}\n\n'),
    encoder.encode('data: [DONE]\n\n'),
  ];
  const results = [];
  for await (const data of sseData({
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  })) {
    results.push(data);
  }
  assert.strictEqual(results.length, 3);
  assert.ok(results[0].includes('"content":"Hello"'));
  assert.ok(results[1].includes('"content":" World"'));
  assert.strictEqual(results[2], '[DONE]');
});

test('sseData rejects truncated events', async () => {
  const encoder = new TextEncoder();
  let threw = false;
  try {
    for await (const _ of sseData({
      [Symbol.asyncIterator]: async function* () {
        yield encoder.encode('data: {incomplete');
      },
    })) {}
  } catch (error) {
    threw = error.message === 'Gateway stream ended in the middle of an event';
  }
  assert.ok(threw, 'should throw on truncated event');
});

// ---------- ChatService SSE Mode Tests ----------

test('SSE mode: parses streaming tokens and emits turn.delta', async () => {
  const fetchImpl = async () => makeSseResponse([
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' World' } }] },
  ]);
  const chat = createChatService({ enableStreaming: true, fetchImpl });
  const events = [];
  await chat.send(
    { id: '123e4567-e89b-12d3-a456-426614174000', text: 'Hello' },
    (event) => events.push(event),
  );
  const deltas = events.filter((e) => e.type === 'turn.delta').map((e) => e.text);
  assert.deepStrictEqual(deltas, ['Hello', ' World']);
  assert.ok(events.some((e) => e.type === 'turn.completed'));
});

test('SSE mode: handles [DONE] marker', async () => {
  const fetchImpl = async () => makeSseResponse([{ choices: [{ delta: { content: 'Hi' } }] }]);
  const chat = createChatService({ enableStreaming: true, fetchImpl });
  const events = [];
  await chat.send(
    { id: '123e4567-e89b-12d3-a456-426614174001', text: 'Hi' },
    (event) => events.push(event),
  );
  assert.ok(events.some((e) => e.type === 'turn.completed'));
});

test('SSE mode: throws on provider error in event', async () => {
  const fetchImpl = async () => makeSseResponse([{ error: { message: 'Context overflow' } }]);
  const chat = createChatService({ enableStreaming: true, fetchImpl });
  let threw = false;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174002', text: 'Hi' },
      () => {},
    );
  } catch (error) {
    threw = error.code === 'CAPRI_GATEWAY_REPORTED_ERROR';
  }
  assert.ok(threw, 'should throw context compaction error');
});

test('SSE mode: AbortController cancels request', async () => {
  const fetchImpl = async () => makeSseResponse([{ choices: [{ delta: { content: 'Slow' } }] }]);
  const chat = createChatService({ enableStreaming: true, fetchImpl });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10);
  let threw = false;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174003', text: 'Slow' },
      () => {},
      { signal: controller.signal },
    );
  } catch (error) {
    threw = error.name === 'AbortError';
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(threw, 'should throw on abort');
});

// ---------- ChatService JSON Mode Tests ----------

test('JSON mode: parses full response', async () => {
  const fetchImpl = async () => makeJsonResponse({
    choices: [{ message: { content: 'Full response' } }],
  });
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  const events = [];
  await chat.send(
    { id: '123e4567-e89b-12d3-a456-426614174004', text: 'Hi' },
    (event) => events.push(event),
  );
  const deltas = events.filter((e) => e.type === 'turn.delta').map((e) => e.text);
  assert.deepStrictEqual(deltas, ['Full response']);
  assert.ok(events.some((e) => e.type === 'turn.completed'));
});

test('JSON mode: handles provider error', async () => {
  const fetchImpl = async () => makeErrorResponse(500);
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  let threw = false;
  let caughtCode = null;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174005', text: 'Hi' },
      () => {},
    );
  } catch (error) {
    threw = true;
    caughtCode = error.code;
  }
  assert.ok(threw, 'should throw on provider failure');
  assert.strictEqual(caughtCode, 'CAPRI_GATEWAY_HTTP_ERROR');
});

test('JSON mode: handles empty choices', async () => {
  const fetchImpl = async () => makeJsonResponse({ choices: [] });
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  const events = [];
  let threw = false;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174006', text: 'Hi' },
      (event) => events.push(event),
    );
  } catch {
    threw = true;
  }
  assert.ok(events.length > 0 || threw, 'should either emit events or throw');
});

test('JSON mode: AbortController cancels request', async () => {
  const fetchImpl = async () => makeJsonResponse({
    choices: [{ message: { content: 'Slow' } }],
  });
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10);
  let threw = false;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174007', text: 'Slow' },
      () => {},
      { signal: controller.signal },
    );
  } catch (error) {
    threw = error.name === 'AbortError';
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(threw, 'should throw on abort');
});

test('JSON mode: rejects response exceeding 2MB limit', async () => {
  const bigContent = 'x'.repeat(3 * 1024 * 1024);
  const fetchImpl = async () => makeJsonResponse({
    choices: [{ message: { content: bigContent } }],
  });
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  let threw = false;
  let caughtMessage = null;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174008', text: 'Hi' },
      () => {},
    );
  } catch (error) {
    threw = true;
    caughtMessage = error.message;
  }
  assert.ok(threw, 'should throw on size limit');
  assert.strictEqual(caughtMessage, 'Response exceeds size limit');
});

test('JSON mode: accepts response under 2MB limit', async () => {
  const okContent = 'x'.repeat(1024);
  const fetchImpl = async () => makeJsonResponse({
    choices: [{ message: { content: okContent } }],
  });
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  const events = [];
  await chat.send(
    { id: '123e4567-e89b-12d3-a456-426614174009', text: 'Hi' },
    (event) => events.push(event),
  );
  const deltas = events.filter((e) => e.type === 'turn.delta').map((e) => e.text);
  assert.deepStrictEqual(deltas, [okContent]);
});

test('JSON mode: invalid JSON does not crash UI', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: {
      [Symbol.asyncIterator]: async function* () {
        yield new TextEncoder().encode('not valid json {{{');
      },
      getReader: () => ({
        read: async () => ({ done: true, value: null }),
        releaseLock: () => {},
      }),
    },
  });
  const chat = createChatService({ enableStreaming: false, fetchImpl });
  let threw = false;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174010', text: 'Hi' },
      () => {},
    );
  } catch {
    threw = true;
  }
  assert.ok(threw, 'should throw on invalid JSON');
});

// ---------- validateInput Tests ----------

test('validateInput: valid message passes', () => {
  const result = validateInput({
    id: '123e4567-e89b-12d3-a456-426614174000',
    text: 'Hello world',
  });
  assert.strictEqual(result.id, '123e4567-e89b-12d3-a456-426614174000');
  assert.strictEqual(result.text, 'Hello world');
});

test('validateInput: rejects missing id', () => {
  assert.throws(
    () => validateInput({ text: 'Hello' }),
    /Invalid message/,
  );
});

test('validateInput: rejects empty text', () => {
  assert.throws(
    () => validateInput({ id: '123e4567-e89b-12d3-a456-426614174000', text: '' }),
    /Enter between 1 and/,
  );
});