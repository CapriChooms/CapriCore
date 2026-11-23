// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatService, validateInput } from '../apps/desktop/chat-service.mjs';
import { sseData } from '../apps/desktop/chat-service.mjs';

const gatewayUrl = 'http://127.0.0.1:18789';
const agentId = 'capri';
const sessionKey = 'agent:capri:main';
const token = () => 'test-token';

// ---------- Helpers ----------

function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  chunks.push(encoder.encode('data: [DONE]\n\n'));
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (key) => (key === 'content-type' ? 'text/event-stream' : null) },
    body: {
      [Symbol.asyncIterator]: async function* () {
        while (index < chunks.length) yield chunks[index++];
      },
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true, value: null };
          return { done: false, value: chunks[index++] };
        },
        releaseLock: () => {},
      }),
    },
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
  const fetchImpl = async () => makeSseResponse([{ error: { message: 'Provider rejected request' } }]);
  const chat = createChatService({ enableStreaming: true, fetchImpl });
  const events = [];
  await chat.send(
    { id: '123e4567-e89b-12d3-a456-426614174002', text: 'Hi' },
    (event) => events.push(event),
  );
  assert.ok(events.some((e) => e.type === 'turn.failed'), 'should emit turn.failed');
  assert.strictEqual(chat.lastFailure.code, 'CAPRI_GATEWAY_REPORTED_ERROR');
});

test('SSE mode: AbortController cancels request', async () => {
  const fetchImpl = async (_url, init = {}) => {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener('abort', abort, { once: true });
      setTimeout(
        () => resolve(makeSseResponse([{ choices: [{ delta: { content: 'Slow' } }] }])),
        1000,
      );
    });
  };
  const chat = createChatService({ enableStreaming: true, fetchImpl });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10);
  const events = [];
  let threw = false;
  try {
    await chat.send(
      { id: '123e4567-e89b-12d3-a456-426614174003', text: 'Slow' },
      (event) => events.push(event),
      { signal: controller.signal },
    );
  } catch (error) {
    threw = error.name === 'AbortError';
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(threw || events.some((e) => e.type === 'turn.cancelled'), 'should cancel on abort');
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
