// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  InferenceApi,
  apiSettings,
  openRouterFreeReplyTimeoutMs,
  readApiSettings,
} from '../apps/desktop/inference-api.mjs';
import { createGatewayConfiguration } from '../packages/runtime/src/context.mjs';
import { settings } from '../packages/runtime/src/config/settings.mjs';
import { buildOpenAICompletionsParams } from '@openclaw/ai/transports';

const key = 'sk-test-secret-1234567890';
const storage = {
  available: async () => true,
  encrypt: async (s) => Buffer.from(s).reverse(),
  decrypt: async (b) => Buffer.from(b).reverse().toString(),
};
const config = {
  enabled: true,
  baseUrl: 'https://provider.example/v1',
  model: 'vendor/model',
  vision: true,
  contextTokens: 32768,
};
async function fixture(t, fetchImpl, provider = config) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-'));
  const options = { root, storage, fetchImpl };
  const profiles = new InferenceApi(options);
  const id = await profiles.saveProfile({ settings: provider, key });
  await profiles.selectProfile(id);
  const api = new InferenceApi(options);
  await api.start(0);
  t.after(() => api.close());
  return { root, api, id };
}

test('Groq applies documented reasoning controls to probes, chat and explicit thinking', async (t) => {
  for (const [model, normal, field, value] of [
    ['openai/gpt-oss-20b', 'low', 'include_reasoning', false],
    ['openai/gpt-oss-120b', 'low', 'include_reasoning', false],
    ['qwen/qwen3.8-27b', 'none', 'reasoning_format', 'hidden'],
  ]) {
    const requests = [];
    const { api, id } = await fixture(
      t,
      async (_url, { body }) => {
        requests.push(JSON.parse(body));
        return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
      },
      { ...config, baseUrl: 'https://api.groq.com/openai/v1', model, tools: false },
    );
    await api.testProfile(id);
    for (const effort of [undefined, 'high']) {
      const reply = await api.localFetch(api.url + '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true,
          reasoning_effort: effort,
        }),
      });
      assert.match(await reply.text(), /"content":"OK"/u);
    }
    assert.deepEqual(
      requests.map((request) => request.reasoning_effort),
      [normal, normal, 'high'],
    );
    for (const request of requests) {
      assert.equal(request[field], value);
      assert.equal(
        request[field === 'include_reasoning' ? 'reasoning_format' : 'include_reasoning'],
        undefined,
      );
    }
  }
});

test('HTTP 413 retries an oversized text-only history once and preserves current instructions and input', async (t) => {
  const requests = [];
  const { api } = await fixture(
    t,
    async (_url, { body }) => {
      requests.push(JSON.parse(body));
      if (requests.length !== 2) return Response.json({ error: 'private-canary' }, { status: 413 });
      return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
    },
    { ...config, tools: false },
  );
  const send = (messages) =>
    api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages, stream: true }),
    });
  const system = { role: 'system', content: 'Retain this instruction' };
  const latest = { role: 'user', content: 'Keep my request intact' };
  const history = [system, { role: 'user', content: 'An earlier turn' }, latest];
  const reply = await send(history);
  assert.equal(reply.status, 200);
  assert.match(await reply.text(), /"content":"OK"/u);
  assert.deepEqual(
    requests.map(({ messages }) => messages),
    [history, [system, latest]],
  );
  assert.equal(api.diagnostics().lastFailure, null);
  const failed = await send(history);
  assert.equal(failed.status, 413);
  assert.match(await failed.text(), /request is too large/u);
  assert.equal(requests.length, 4);
  const attachment = await send([
    ...history,
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
    },
  ]);
  assert.equal(attachment.status, 413);
  assert.doesNotMatch(await attachment.text(), /private-canary/u);
  assert.equal(requests.length, 5);
});

test('a provider ignoring streaming is normalized once, preserving choices and tool calls without private traces', async (t) => {
  const completion = {
    id: 'synthetic-completion',
    object: 'chat.completion',
    model: config.model,
    choices: [
      {
        index: 2,
        message: {
          role: 'assistant',
          content: null,
          reasoning: 'Private deliberation ' + key,
          reasoning_content: 'Private deliberation',
          reasoning_details: [{ text: 'Private deliberation' }],
          thinking: 'Private deliberation',
          tool_calls: [
            { id: 'call-one', type: 'function', function: { name: 'first', arguments: '{"x":1}' } },
            {
              id: 'call-two',
              type: 'function',
              function: { name: 'second', arguments: JSON.stringify({ value: key }) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
      {
        index: 7,
        message: {
          role: 'assistant',
          content: 'Señal ' + key + '.',
          reasoning: 'Private deliberation',
        },
        finish_reason: 'length',
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  };
  const escapedKey = [...key]
    .map((character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
  const bytes = Buffer.from(JSON.stringify(completion).replaceAll(key, escapedKey));
  let calls = 0;
  const { api } = await fixture(t, async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'Application/JSON; charset=utf-8' } },
    );
  });
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Synthetic request' }],
      stream: true,
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const text = await response.text();
  const frames = text.trim().split('\n\n');
  assert.equal(frames.length, 2);
  assert.equal(frames[1], 'data: [DONE]');
  const event = JSON.parse(frames[0].slice(6));
  assert.equal(event.object, 'chat.completion.chunk');
  assert.equal(event.id, completion.id);
  assert.deepEqual(event.usage, completion.usage);
  assert.deepEqual(
    event.choices.map(({ index, finish_reason }) => ({ index, finish_reason })),
    [
      { index: 2, finish_reason: 'tool_calls' },
      { index: 7, finish_reason: 'length' },
    ],
  );
  assert.equal(event.choices[0].delta.content, null);
  assert.deepEqual(event.choices[0].delta.tool_calls, [
    { ...completion.choices[0].message.tool_calls[0], index: 0 },
    {
      id: 'call-two',
      type: 'function',
      index: 1,
      function: { name: 'second', arguments: '{"value":"[REDACTED]"}' },
    },
  ]);
  assert.equal(event.choices[1].delta.content, 'Señal [REDACTED].');
  assert(event.choices.every((choice) => choice.message === undefined));
  assert.doesNotMatch(text, /Private deliberation|reasoning|thinking/);
  assert.equal(text.includes(key), false);
  assert.equal(calls, 1, 'Normalization must never replay a conversation.');
});

test('native provider SSE remains incremental and keeps its terminal event', async (t) => {
  const first =
    'data: {"choices":[{"index":0,"delta":{"content":"Ready."},"finish_reason":null}]}\n\n';
  const last =
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  let source,
    calls = 0;
  const { api } = await fixture(t, async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          source = controller;
          controller.enqueue(Buffer.from(first));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ messages: [], stream: true }),
  });
  const reader = response.body.getReader();
  const initial = await reader.read();
  assert.equal(Buffer.from(initial.value).toString(), first);
  source.enqueue(Buffer.from(last));
  source.close();
  let tail = '';
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    tail += Buffer.from(part.value).toString();
  }
  reader.releaseLock();
  assert.equal(tail, last);
  assert.equal(calls, 1);
});

test('remote availability checks streaming text and terminal success rather than a separate nonstream reply', async (t) => {
  const event = 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\n';
  let mode = 'stream',
    calls = 0;
  const { api, id } = await fixture(t, async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.stream, true);
    assert.equal(request.max_tokens, 256);
    assert.equal(request.reasoning_effort, undefined);
    if (mode === 'json')
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      });
    if (mode === 'json-error') return Response.json({ error: { message: key } });
    if (mode === 'json-reasoning')
      return Response.json({ choices: [{ message: { reasoning: 'Private' } }] });
    if (mode === 'oversized-json')
      return Response.json({ choices: [{ message: { content: 'é'.repeat(33 * 1024) } }] });
    const bodies = {
      stream: event + 'data: [DONE]\n\n',
      error: event + 'data: {"error":{"message":"Private ' + key + '"}}\n\ndata: [DONE]\n\n',
      eof: event,
      empty: 'data: [DONE]\n\n',
      malformed: 'data: {broken}\n\ndata: [DONE]\n\n',
      reasoning: 'data: {"choices":[{"delta":{"reasoning":"Private"}}]}\n\ndata: [DONE]\n\n',
    };
    return new Response(bodies[mode], { headers: { 'content-type': 'text/event-stream' } });
  });
  for (mode of ['stream', 'json']) {
    const before = calls;
    assert.ok((await api.testProfile(id)).elapsedMs >= 0);
    assert.equal(calls - before, 1);
  }
  for (mode of [
    'error',
    'eof',
    'empty',
    'malformed',
    'reasoning',
    'json-error',
    'json-reasoning',
    'oversized-json',
  ]) {
    const before = calls;
    await assert.rejects(
      api.testProfile(id),
      (error) => /API model returned no text/.test(error.message) && !error.message.includes(key),
    );
    assert.equal(calls - before, 1, mode + ' must not replay the probe.');
  }
});

test('invalid buffered completions fail safely before successful SSE headers and are never replayed', async (t) => {
  let body,
    calls = 0;
  const { api } = await fixture(t, async () => {
    calls++;
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  });
  for (const packet of [
    { error: { message: key + ' Private provider response' } },
    { choices: [] },
    { choices: {} },
    { choices: [{ message: { role: 'user', content: 'Private provider response' } }] },
    { choices: [{ message: { content: '', reasoning: 'Private provider response' } }] },
    {
      choices: [
        { message: { tool_calls: [{ type: 'function', function: { name: 'incomplete' } }] } },
      ],
    },
    '{malformed ' + key,
  ]) {
    body = typeof packet === 'string' ? packet : JSON.stringify(packet);
    const before = calls;
    const response = await api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [], stream: true }),
    });
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const result = await response.json();
    assert.equal(result.error.code, 'CAPRI_API_RESPONSE_INVALID');
    assert.doesNotMatch(JSON.stringify(result), /Private provider response/);
    assert.equal(JSON.stringify(result).includes(key), false);
    assert.equal(api.diagnostics().lastFailure.code, 'CAPRI_API_RESPONSE_INVALID');
    assert.equal(calls - before, 1);
  }
});

test('cancelled buffered normalization releases even a provider body that ignores the fetch signal', async (t) => {
  let notifyStarted, notifyCancelled;
  const started = new Promise((resolve) => (notifyStarted = resolve));
  const cancelled = new Promise((resolve) => (notifyCancelled = resolve));
  let calls = 0;
  const { api } = await fixture(t, async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('{"choices":['));
          notifyStarted();
        },
        cancel() {
          notifyCancelled();
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const controller = new AbortController();
  const pending = api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    signal: controller.signal,
    body: JSON.stringify({ messages: [], stream: true }),
  });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await Promise.race([
    cancelled,
    delay(1000).then(() => {
      throw new Error('Provider body was not cancelled');
    }),
  ]);
  assert.equal(calls, 1);
});

test('buffered response normalization enforces the existing byte limit and cancels oversized bodies', async (t) => {
  let calls = 0,
    cancelled = false;
  const { api } = await fixture(t, async () => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ messages: [], stream: true }),
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'CAPRI_API_RESPONSE_LIMIT');
  assert.equal(api.diagnostics().lastFailure.code, 'CAPRI_API_RESPONSE_LIMIT');
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});

test('proxy diagnostics retain only safe failure classification and clear on the next request', async (t) => {
  let fail = true;
  const { api } = await fixture(t, async () => {
    if (fail)
      throw new TypeError('Private provider response ' + key, {
        cause: Object.assign(new Error(key), { code: 'ECONNRESET' }),
      });
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'Ready.' } }] });
  });
  const send = () =>
    api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [], stream: true }),
    });
  const failed = await send();
  assert.equal((await failed.json()).error.code, 'CAPRI_API_NETWORK_ERROR');
  const diagnostics = api.diagnostics();
  assert.equal(diagnostics.lastFailure.stage, 'connect');
  assert.equal(diagnostics.lastFailure.networkCode, 'ECONNRESET');
  assert.equal(diagnostics.lastFailure.httpStatus, 502);
  assert.equal(diagnostics.lastFailure.streaming, true);
  assert.ok(diagnostics.lastFailure.elapsedMs >= 0);
  assert.ok(diagnostics.lastFailure.failedAtMs > 0);
  assert.ok(diagnostics.lastFailure.monotonicMs >= 0);
  assert.equal(JSON.stringify(diagnostics).includes(key), false);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /Private provider|provider\.example|messages|headers/,
  );
  diagnostics.lastFailure.code = 'tampered';
  assert.equal(api.diagnostics().lastFailure.code, 'CAPRI_API_NETWORK_ERROR');
  fail = false;
  assert.match(await (await send()).text(), /Ready/);
  assert.equal(api.diagnostics().lastFailure, null);
});

test('provider body transport failures retain a safe network code without the private cause', async (t) => {
  const { api } = await fixture(
    t,
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(
              new TypeError('API transport failed with private provider response ' + key, {
                cause: Object.assign(new Error(key), { code: 'UND_ERR_SOCKET' }),
              }),
            );
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ messages: [], stream: true }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, 'CAPRI_API_NETWORK_ERROR');
  assert.equal(api.diagnostics().lastFailure.stage, 'stream');
  assert.equal(api.diagnostics().lastFailure.networkCode, 'UND_ERR_SOCKET');
  assert.equal(JSON.stringify(body).includes(key), false);
  assert.equal(
    body.error.message,
    'API connection failed. Check the provider URL and network. (UND_ERR_SOCKET)',
  );
  assert.doesNotMatch(JSON.stringify(api.diagnostics()), /Private provider response/);
});

test('the final proxy error boundary never trusts API-shaped provider prose', async (t) => {
  const { api } = await fixture(t, async () => Response.json({}));
  for (const [message, fields, expected] of [
    ...['API ', 'Saved API ', 'Invalid API ', 'Enable vision '].map((prefix) => [
      prefix + 'private provider detail ' + key,
      {},
      'API request could not be completed.',
    ]),
    ['API private ' + key, { code: 'CAPRI_API_RESPONSE_INVALID' }, 'API model returned no text.'],
    ['API private ' + key, { code: 'CAPRI_API_RESPONSE_LIMIT' }, 'API response exceeds limits.'],
    [
      'API private ' + key,
      { code: 'CAPRI_API_PROVIDER_ERROR', providerStatus: 429 },
      'API provider returned HTTP 429. The provider rate limit was reached.',
    ],
    [
      'API private ' + key,
      { code: 'CAPRI_API_PROVIDER_ERROR', providerStatus: 503 },
      'API provider returned HTTP 503. Check access, model availability and account balance.',
    ],
    [
      'API private ' + key,
      { code: 'CAPRI_API_NETWORK_ERROR', networkCode: 'ECONNRESET' },
      'API connection failed. Check the provider URL and network. (ECONNRESET)',
    ],
    [
      'API private ' + key,
      { code: 'CAPRI_API_NETWORK_ERROR', networkCode: key },
      'API connection failed. Check the provider URL and network.',
    ],
    ['API key is missing.', {}, 'API key is missing.'],
    [
      'API connection to ProxyAPI timed out before HTTPS. Check your VPN or proxy route.',
      {},
      'API connection to ProxyAPI timed out before HTTPS. Check your VPN or proxy route.',
    ],
  ]) {
    api.upstream = async () => {
      throw Object.assign(new Error(message), fields);
    };
    const response = await api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [], stream: true }),
    });
    const body = await response.json();
    assert.equal(body.error.message, expected);
    assert.equal(JSON.stringify(body).includes(key), false);
    assert.equal(JSON.stringify(api.diagnostics()).includes(key), false);
    assert.doesNotMatch(JSON.stringify(body), /private provider detail/);
  }
});

test('owner reasoning markers are one-turn controls with a bounded answer budget and private traces removed', async (t) => {
  const requests = [];
  const packet = {
    choices: [
      {
        message: {
          content: 'Verified answer.',
          reasoning: 'Private trace.',
          reasoning_content: 'Private trace.',
          reasoning_details: [{ text: 'Private trace.' }],
          thinking: 'Private trace.',
        },
      },
    ],
  };
  const { api } = await fixture(
    t,
    async (_, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.stream)
        return new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: packet.choices[0].message }] }) +
            '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      return Response.json(packet);
    },
    { ...config, baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/reasoner' },
  );
  const send = (input, endpoint = '/v1/chat/completions') =>
    api.localFetch(api.url + endpoint, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Check carefully.' }], ...input }),
    });
  assert.equal(
    (await (await send({ reasoning_effort: 'medium' })).json()).choices[0].message.content,
    'Verified answer.',
  );
  assert.deepEqual(requests[0].reasoning, { effort: 'medium', exclude: true });
  assert.equal(requests[0].reasoning_effort, undefined);
  assert.equal(requests[0].max_tokens, 8192);
  const ordinary = await (await send({ reasoning_effort: 'none', max_tokens: 8192 })).json();
  assert.deepEqual(ordinary.choices[0].message, { content: 'Verified answer.' });
  assert.equal(requests[1].reasoning, undefined);
  assert.equal(requests[1].reasoning_effort, undefined);
  assert.equal(requests[1].max_tokens, 2048);
  const streaming = await (await send({ reasoning_effort: 'medium', stream: true })).text();
  assert.match(streaming, /Verified answer/);
  assert.ok(!/Private trace|reasoning|thinking/.test(streaming));
  assert.match(streaming, /\[DONE\]/);
  await (await send({ think: true, options: { num_predict: 8192 } }, '/api/chat')).text();
  assert.equal(requests[3].max_tokens, 8192);
  assert.deepEqual(requests[3].reasoning, { effort: 'medium', exclude: true });
  await (await send({ think: false, options: { num_predict: 768 } }, '/api/chat')).text();
  assert.equal(requests[4].max_tokens, 768);
  assert.equal(requests[4].reasoning, undefined);
  await (await send({ reasoning_effort: 'medium', max_completion_tokens: 6144 })).text();
  assert.equal(requests[5].max_tokens, 6144, 'Preserve a context-aware SDK limit.');
  assert.equal(requests[5].max_completion_tokens, undefined);
});

test('cancelling a selected reasoning turn aborts its provider request promptly', async (t) => {
  let notifyStarted;
  const started = new Promise((resolve) => (notifyStarted = resolve));
  let notifyAborted;
  const aborted = new Promise((resolve) => (notifyAborted = resolve));
  const { api } = await fixture(t, async (_, { signal }) => {
    notifyStarted();
    return new Promise((_, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          notifyAborted();
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  const controller = new AbortController();
  const pending = api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ messages: [], reasoning_effort: 'medium' }),
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await Promise.race([
    aborted,
    delay(1000).then(() => {
      throw new Error('Reasoning provider was not cancelled.');
    }),
  ]);
});

test('a custom provider without a known reasoning protocol receives only the careful prompt and larger answer budget', async (t) => {
  let request;
  const { api } = await fixture(t, async (_, options) => {
    request = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: 'Answer.' } }] });
  });
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'system', content: 'Check the answer carefully before replying.' }],
      reasoning_effort: 'medium',
      reasoning: { effort: 'high' },
      thinking: { type: 'enabled' },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(request.max_tokens, 8192);
  assert.equal(request.reasoning, undefined);
  assert.equal(request.reasoning_effort, undefined);
  assert.equal(request.thinking, undefined);
  assert.equal(request.messages[0].content, 'Check the answer carefully before replying.');
});

test('the managed API declaration carries a medium control through the real provider adapter', () => {
  const gateway = createGatewayConfiguration(
    {
      stateDir: 'fixture',
      workspace: 'fixture',
      gatewayPort: 18789,
      ollamaUrl: 'http://127.0.0.1:11435',
      inferenceUrl: 'http://127.0.0.1:11436',
      remote: config,
    },
    settings,
  );
  const declaration = gateway.models.providers['capri-api'];
  const model = {
    ...declaration.models[0],
    api: declaration.api,
    provider: 'capri-api',
    baseUrl: declaration.baseUrl,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const context = { messages: [{ role: 'user', content: 'Check carefully.' }] };
  const selected = buildOpenAICompletionsParams(model, context, {
    reasoning: 'medium',
    maxTokens: 8192,
  });
  assert.equal(selected.reasoning_effort, 'medium');
  assert.equal(selected.max_completion_tokens ?? selected.max_tokens, 8192);
  assert.equal(gateway.agents.defaults.thinkingDefault, 'off');
});

test('Hugging Face inference uses its router and preserves the selected provider suffix', async (t) => {
  const provider = {
    ...config,
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'owner/model:provider',
    vision: false,
    tools: false,
  };
  const { api, id } = await fixture(
    t,
    async (url, options) => {
      assert.equal(url, 'https://router.huggingface.co/v1/chat/completions');
      assert.equal(options.headers.authorization, 'Bearer ' + key);
      assert.equal(options.redirect, 'error');
      const request = JSON.parse(options.body);
      assert.equal(request.model, provider.model);
      assert.equal(request.messages.length, 1);
      assert.equal(request.tools, undefined);
      return Response.json({ choices: [{ message: { content: 'OK' } }] });
    },
    provider,
  );
  assert.ok((await api.testProfile(id)).elapsedMs >= 0);
});
test('ProxyAPI uses the unified endpoint and forwards streaming tool calls with a full model ID', async (t) => {
  const provider = { ...config, baseUrl: 'https://api.proxyapi.ru/v1', model: 'openai/gpt-5-mini' };
  const tool = {
    type: 'function',
    function: { name: 'calculator', parameters: { type: 'object' } },
  };
  const toolCall = {
    index: 0,
    id: 'call_fixture',
    type: 'function',
    function: { name: 'calculator', arguments: '{}' },
  };
  const packet = { choices: [{ index: 0, delta: { tool_calls: [toolCall] } }] };
  const { api } = await fixture(
    t,
    async (url, options) => {
      assert.equal(url, 'https://api.proxyapi.ru/v1/chat/completions');
      assert.equal(options.headers.authorization, 'Bearer ' + key);
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'openai/gpt-5-mini');
      assert.equal(payload.stream, true);
      assert.deepEqual(payload.tools, [tool]);
      return new Response('data: ' + JSON.stringify(packet) + '\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
    provider,
  );
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Calculate' }],
      tools: [tool],
      stream: true,
    }),
  });
  assert.equal(response.status, 200);
  const [event, end] = (await response.text()).trim().split('\n\n');
  assert.deepEqual(JSON.parse(event.slice('data: '.length)), packet);
  assert.equal(end, 'data: [DONE]');
});

test('ProxyAPI uses the configured system proxy, keeps direct routes, and reports connect timeouts', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-proxyapi-'));
  const provider = apiSettings({ ...config, baseUrl: 'https://api.proxyapi.ru/v1' });
  const calls = [];
  let route = 'PROXY proxy.example:8080';
  const proxySession = {
    resolveProxy: async (url) => {
      assert.equal(url, 'https://api.proxyapi.ru/v1/chat/completions');
      return route;
    },
    fetch: async (_url, options) => {
      calls.push('proxy');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer ' + key);
      return Response.json({});
    },
  };
  const api = new InferenceApi({
    root,
    storage,
    config: provider,
    proxySession: () => proxySession,
    fetchImpl: async () => {
      calls.push('direct');
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('unpublished details'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
      });
    },
  });
  const send = (signal = AbortSignal.timeout(1000), settings = provider) =>
    api.upstream({ messages: [], stream: false }, signal, settings, key);
  await (await send()).response.body.cancel();
  route = 'DIRECT';
  await assert.rejects(send(), /ProxyAPI timed out before HTTPS.*VPN/);
  await assert.rejects(send(undefined, config), /API connection failed.*UND_ERR_CONNECT_TIMEOUT/);
  proxySession.resolveProxy = () => new Promise(() => {});
  const controller = new AbortController();
  const pending = send(controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled or timed out/);
  assert.deepEqual(calls, ['proxy', 'direct', 'direct']);
});

test('damaged API settings request repair without replacing the owner file or selecting local inference', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-recovery-'));
  const file = path.join(root, 'data/desktop/inference-api.json');
  mkdirSync(path.dirname(file), { recursive: true });
  const damaged = '{"enabled":true,"model":"interrupted';
  writeFileSync(file, damaged);
  assert.equal(readApiSettings(root).enabled, false);
  assert.equal(readApiSettings(root).setupRequired, true);
  assert.equal(readFileSync(file, 'utf8'), damaged);
});
test('selected API and encrypted profile survive Windows UTF-8 BOM files and repeated restarts', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-bom-'));
  const options = {
    root,
    storage,
    fetchImpl: async (url, request) => {
      assert.equal(url, config.baseUrl + '/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer ' + key);
      assert.equal(JSON.parse(request.body).model, config.model);
      return Response.json({ choices: [{ message: { content: 'OK' } }] });
    },
  };
  const api = new InferenceApi(options);
  const id = await api.saveProfile({ settings: config, key });
  await api.selectProfile(id);
  for (const file of [api.settingsFile, api.profilesFile])
    writeFileSync(file, '\uFEFF' + readFileSync(file, 'utf8'));

  for (let restart = 0; restart < 2; restart++) {
    const restored = new InferenceApi(options);
    assert.equal(restored.config.enabled, true);
    assert.equal(restored.config.profileId, id);
    assert.equal(restored.activeProfileId(), id);
    assert.equal(await restored.key(), key);
    assert.equal((await restored.status()).activeId, id);
    assert.ok((await restored.testProfile(id)).elapsedMs >= 0);
    assert.equal(JSON.stringify(await restored.status()).includes(key), false);
    await restored.start(0);
    t.after(() => restored.close());
    const response = await restored.localFetch(restored.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Synthetic provider persistence check.' }],
        stream: false,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, 'OK');
    restored.close();
  }
  await api.selectProfile(null);
  const local = new InferenceApi(options);
  assert.equal(local.config.enabled, false);
  assert.equal((await local.status()).activeId, null);
  assert.equal((await local.status()).profiles[0].id, id);
});
test('editing a saved API profile keeps its ID and exact encrypted key without decrypting it', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-key-'));
  let encryptions = 0;
  const api = new InferenceApi({
    root,
    storage: {
      ...storage,
      encrypt: async (value) => {
        encryptions++;
        return storage.encrypt(value);
      },
      decrypt: async () => {
        throw new Error('Editing and status must not decrypt saved credentials.');
      },
    },
  });
  const id = await api.saveProfile({ settings: config, name: 'Original', key });
  const credential = api.profile(id).credential;
  for (const value of [undefined, '', ' \u200b ']) {
    assert.equal(
      await api.saveProfile({
        id,
        name: ' Updated ',
        settings: {
          ...config,
          baseUrl: 'HTTPS://PROVIDER.EXAMPLE:443/other/v1/',
          model: 'vendor/updated',
          vision: false,
          tools: false,
          contextTokens: 65536,
        },
        key: value,
      }),
      id,
    );
    assert.deepEqual(api.profile(id).credential, credential);
  }
  assert.equal(encryptions, 1);
  const status = await api.status();
  assert.equal(status.activeId, null);
  assert.equal(status.profiles.length, 1);
  assert.equal(status.profiles[0].id, id);
  assert.equal(status.profiles[0].name, 'Updated');
  assert.equal(status.profiles[0].baseUrl, 'https://provider.example/other/v1');
  assert.equal(status.profiles[0].model, 'vendor/updated');
  assert.equal(status.profiles[0].contextTokens, 65536);
  assert.equal(status.profiles[0].vision, false);
  assert.equal(status.profiles[0].tools, false);
  assert.equal(status.profiles[0].hasKey, true);
  assert.equal(status.profiles[0].canConnect, true);
  assert.equal(JSON.stringify(status).includes(key), false);
  assert.equal(JSON.stringify(status).includes(credential.ciphertext), false);
  assert.equal(readFileSync(api.profilesFile, 'utf8').includes(key), false);
  assert.equal(existsSync(api.settingsFile), false);
});

test('editing active and inactive API profiles rotates keys without changing the running selection', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-active-'));
  const options = { root, storage };
  const saved = new InferenceApi(options);
  const activeId = await saved.saveProfile({ settings: config, key });
  const inactiveId = await saved.saveProfile({ settings: config, key, name: 'Inactive' });
  await saved.selectProfile(activeId);
  const api = new InferenceApi(options);
  const runningConfig = api.config;
  const activeCredential = { ...api.activeCredential };
  const selection = readFileSync(api.settingsFile);
  const replacement = 'sk-rotated-secret-9876543210';
  const updated = { ...config, model: 'vendor/replacement', contextTokens: 65536 };
  assert.equal(
    await api.saveProfile({ id: activeId, settings: updated, key: replacement }),
    activeId,
  );
  assert.notEqual(api.profile(activeId).credential.ciphertext, activeCredential.ciphertext);
  assert.equal(await api.decodeKey(api.profile(activeId).credential), replacement);
  await api.saveProfile({ id: inactiveId, settings: updated, name: 'Still inactive' });
  assert.equal(api.config, runningConfig);
  assert.equal(api.config.model, config.model);
  assert.deepEqual(api.activeCredential, activeCredential);
  assert.equal(await api.key(), key);
  assert.equal(api.activeProfileId(), activeId);
  assert.equal((await api.status()).activeId, activeId);
  assert.equal((await api.status()).profiles.length, 2);
  assert.deepEqual(readFileSync(api.settingsFile), selection);
  assert.equal(readFileSync(api.profilesFile, 'utf8').includes(replacement), false);
  await api.selectProfile(activeId);
  const restarted = new InferenceApi(options);
  assert.equal(restarted.activeProfileId(), activeId);
  assert.equal(restarted.config.model, updated.model);
  assert.equal(restarted.config.contextTokens, updated.contextTokens);
  assert.equal(await restarted.key(), replacement);
});

test('editing an unknown or malformed API profile ID never creates a connection', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-id-'));
  const api = new InferenceApi({ root, storage });
  const missing = '00000000-0000-4000-8000-000000000000';
  await assert.rejects(api.saveProfile({ id: missing, settings: config, key }), /was not found/);
  assert.equal(existsSync(api.profilesFile), false);
  const id = await api.saveProfile({ settings: config, key });
  const previous = readFileSync(api.profilesFile);
  for (const value of [missing, 'legacy', '', 'unknown', null, 7, [], {}]) {
    await assert.rejects(api.saveProfile({ id: value, settings: config, key }), /was not found/);
    assert.deepEqual(readFileSync(api.profilesFile), previous);
    assert.deepEqual(
      api.readProfiles().map((profile) => profile.id),
      [id],
    );
  }
});

test('invalid edits and secure-storage failures leave API profile files byte identical', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-invalid-'));
  let available = true;
  let encryptionFails = false;
  const api = new InferenceApi({
    root,
    storage: {
      ...storage,
      available: async () => available,
      encrypt: async (value) => {
        if (encryptionFails) throw new Error('Encryption failed.');
        return storage.encrypt(value);
      },
    },
  });
  const id = await api.saveProfile({ settings: config, key, name: 'Retained' });
  await api.selectProfile(id);
  const previous = readFileSync(api.profilesFile);
  const selection = readFileSync(api.settingsFile);
  for (const change of [
    { name: 3 },
    { name: 'x'.repeat(65) },
    { settings: { ...config, enabled: false } },
    { settings: { ...config, model: 'invalid model' } },
    { settings: { ...config, contextTokens: 8192 } },
    { settings: { ...config, vision: 'yes' } },
    { settings: { ...config, tools: 'yes' } },
    { settings: { ...config, baseUrl: 'https://user:password@provider.example/v1' } },
    { settings: { ...config, baseUrl: 'https://provider.example/v1?key=secret' } },
    { settings: { ...config, profileId: id } },
    { settings: { ...config, arbitrary: true } },
    { key: null },
    { key: 'short' },
    { key: 'bad key with spaces' },
    { key: 'x'.repeat(4097) },
  ]) {
    await assert.rejects(api.saveProfile({ id, settings: config, ...change }));
    assert.deepEqual(readFileSync(api.profilesFile), previous);
    assert.deepEqual(readFileSync(api.settingsFile), selection);
  }
  available = false;
  for (const value of [undefined, 'sk-new-valid-secret']) {
    await assert.rejects(
      api.saveProfile({ id, settings: config, key: value }),
      /Secure credential storage is unavailable/,
    );
    assert.deepEqual(readFileSync(api.profilesFile), previous);
  }
  available = true;
  encryptionFails = true;
  await assert.rejects(
    api.saveProfile({ id, settings: config, key: 'sk-new-valid-secret' }),
    /Encryption failed/,
  );
  assert.deepEqual(readFileSync(api.profilesFile), previous);
  assert.deepEqual(readFileSync(api.settingsFile), selection);
});

test('editing an API provider origin requires a new key and never retargets the saved credential', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-origin-'));
  const api = new InferenceApi({ root, storage });
  const id = await api.saveProfile({ settings: config, key });
  const previous = readFileSync(api.profilesFile);
  const credential = api.profile(id).credential;
  for (const baseUrl of [
    'https://different.example/v1',
    'https://provider.example:8443/v1',
    'http://127.0.0.1:13305/v1',
  ]) {
    for (const value of [undefined, '', ' \u200b ']) {
      await assert.rejects(
        api.saveProfile({ id, settings: { ...config, baseUrl }, key: value }),
        /Enter a new API key when changing the provider address/,
      );
      assert.deepEqual(readFileSync(api.profilesFile), previous);
      assert.deepEqual(api.profile(id).credential, credential);
    }
  }
  const replacement = 'sk-another-provider-secret';
  assert.equal(
    await api.saveProfile({
      id,
      settings: { ...config, baseUrl: 'https://different.example/v1' },
      key: replacement,
    }),
    id,
  );
  assert.equal(api.profile(id).credential.origin, 'https://different.example');
  assert.equal(await api.decodeKey(api.profile(id).credential), replacement);
  assert.notEqual(api.profile(id).credential.ciphertext, credential.ciphertext);
  assert.equal(api.readProfiles().length, 1);
});

test('API profile save prepares validation and encryption before its awaited commit hook', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-commit-'));
  const events = [];
  let encryptionFails = false;
  const api = new InferenceApi({
    root,
    storage: {
      ...storage,
      encrypt: async (value) => {
        events.push('encrypt');
        if (encryptionFails) throw new Error('Encryption failed.');
        return storage.encrypt(value);
      },
    },
  });
  const id = await api.saveProfile({ settings: config, key });
  await api.selectProfile(id);
  const previous = readFileSync(api.profilesFile);
  const selection = readFileSync(api.settingsFile);
  const hook = async () => {
    events.push('hook');
    assert.deepEqual(readFileSync(api.profilesFile), previous);
    await delay(1);
    throw new Error('Restart preparation failed.');
  };
  events.length = 0;
  await assert.rejects(api.saveProfile({ id, settings: config, key: 'invalid' }, hook));
  assert.deepEqual(events, []);
  encryptionFails = true;
  await assert.rejects(
    api.saveProfile({ id, settings: config, key: 'sk-valid-replacement' }, hook),
    /Encryption failed/,
  );
  assert.deepEqual(events, ['encrypt']);
  encryptionFails = false;
  events.length = 0;
  await assert.rejects(
    api.saveProfile({ id, settings: config, key: 'sk-valid-replacement' }, hook),
    /Restart preparation failed/,
  );
  assert.deepEqual(events, ['encrypt', 'hook']);
  assert.deepEqual(readFileSync(api.profilesFile), previous);
  assert.deepEqual(readFileSync(api.settingsFile), selection);
  let ready = false;
  await api.saveProfile({ id, settings: config, name: 'Committed' }, async () => {
    assert.deepEqual(readFileSync(api.profilesFile), previous);
    await delay(1);
    ready = true;
  });
  assert.equal(ready, true);
  assert.equal(api.profile(id).name, 'Committed');
});

test('concurrent API profile saves retain each connection and recover after a rejected save', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-concurrent-'));
  const api = new InferenceApi({ root, storage });
  const ids = await Promise.all(
    ['First', 'Second', 'Third'].map((name) => api.saveProfile({ settings: config, name, key })),
  );
  assert.deepEqual(
    api.readProfiles().map((profile) => profile.id),
    ids,
  );
  const events = [];
  const results = await Promise.allSettled([
    api.saveProfile({ id: ids[0], settings: config, key: 'invalid' }),
    api.saveProfile({ id: ids[0], settings: config, name: 'Updated' }, async () => {
      events.push('first');
      await delay(1);
      events.push('ready');
    }),
    api.saveProfile({ id: ids[1], settings: config, name: 'Also updated' }, () => {
      assert.equal(api.profile(ids[0]).name, 'Updated');
      events.push('second');
    }),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'fulfilled', 'fulfilled'],
  );
  assert.deepEqual(events, ['first', 'ready', 'second']);
  assert.deepEqual(
    api.readProfiles().map((profile) => profile.id),
    ids,
  );
  assert.equal(api.profile(ids[1]).name, 'Also updated');
});

test('keyless local API profiles can change loopback origin without secure storage or authorization', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-local-'));
  let storageChecks = 0;
  const api = new InferenceApi({
    root,
    storage: {
      available: async () => {
        storageChecks++;
        return false;
      },
    },
  });
  const local = { ...config, baseUrl: 'http://localhost:13305/v1', contextTokens: 8192 };
  const id = await api.saveProfile({ settings: local });
  assert.equal(
    await api.saveProfile({
      id,
      settings: { ...local, baseUrl: 'http://[::1]:13306/v1' },
      key: '',
    }),
    id,
  );
  assert.equal(storageChecks, 0);
  assert.equal(api.profile(id).credential, null);
  assert.equal(api.profile(id).settings.baseUrl, 'http://[::1]:13306/v1');
  const status = await api.status();
  assert.equal(status.profiles.length, 1);
  assert.equal(status.profiles[0].hasKey, false);
  assert.equal(status.profiles[0].canConnect, true);
  const previous = readFileSync(api.profilesFile);
  await assert.rejects(api.saveProfile({ id, settings: config }), /Enter a valid API key/);
  assert.deepEqual(readFileSync(api.profilesFile), previous);
});

test('editing a saved API profile succeeds when the connection limit is full', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-full-'));
  const api = new InferenceApi({ root, storage: { available: async () => false } });
  const local = { ...config, baseUrl: 'http://127.0.0.1:13305/v1', contextTokens: 8192 };
  const ids = [];
  for (let index = 0; index < 20; index++)
    ids.push(await api.saveProfile({ settings: local, name: 'Connection ' + index }));
  assert.equal(
    await api.saveProfile({
      id: ids[9],
      settings: { ...local, model: 'replacement' },
      name: 'Edited',
    }),
    ids[9],
  );
  assert.deepEqual(
    api.readProfiles().map((profile) => profile.id),
    ids,
  );
  assert.equal(api.profile(ids[9]).name, 'Edited');
  assert.equal(api.profile(ids[9]).settings.model, 'replacement');
  const previous = readFileSync(api.profilesFile);
  await assert.rejects(api.saveProfile({ settings: local }), /Remove a saved API connection first/);
  assert.deepEqual(readFileSync(api.profilesFile), previous);
});

test('editing a legacy API profile preserves its secret file and active identity', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-edit-legacy-'));
  const settingsFile = path.join(root, 'data/desktop/inference-api.json');
  const credentialFile = path.join(root, 'data/secrets/inference-api.json');
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  mkdirSync(path.dirname(credentialFile), { recursive: true });
  writeFileSync(settingsFile, '\uFEFF' + JSON.stringify(config));
  writeFileSync(
    credentialFile,
    JSON.stringify({
      schemaVersion: 1,
      ciphertext: (await storage.encrypt(key)).toString('base64'),
    }),
  );
  const previousSecret = readFileSync(credentialFile);
  const selection = readFileSync(settingsFile);
  const api = new InferenceApi({
    root,
    storage: {
      ...storage,
      encrypt: async () => {
        throw new Error('The legacy encrypted key must be preserved.');
      },
      decrypt: async () => {
        throw new Error('Editing must not decrypt the legacy credential.');
      },
    },
  });
  const credential = api.profile('legacy').credential;
  assert.equal(
    await api.saveProfile({
      id: 'legacy',
      settings: { ...config, model: 'vendor/updated' },
      name: 'Updated legacy',
    }),
    'legacy',
  );
  assert.equal(api.readProfiles().length, 1);
  assert.deepEqual(api.profile('legacy').credential, credential);
  assert.deepEqual(readFileSync(credentialFile), previousSecret);
  assert.deepEqual(readFileSync(settingsFile), selection);
  assert.equal(api.config.model, config.model);
  assert.equal((await api.status()).activeId, 'legacy');
  assert.equal((await api.status()).profiles[0].name, 'Updated legacy');
});

test('API keys are encrypted, absent from status/config, and requests require a separate loopback credential', async (t) => {
  let calls = 0;
  const { root, api } = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url, config.baseUrl + '/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer ' + key);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.model);
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'Ready' } }] });
  });
  assert.equal(JSON.stringify(await api.status()).includes(key), false);
  assert.equal(
    readFileSync(path.join(root, 'data/secrets/inference-api-profiles.json'), 'utf8').includes(key),
    false,
  );
  assert.equal(
    (await fetch(api.url + '/v1/chat/completions', { method: 'POST', body: '{}' })).status,
    401,
  );
  assert.equal(calls, 0);
  const result = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [{ type: 'function' }],
      stream: false,
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
  const gateway = createGatewayConfiguration(
    {
      stateDir: root,
      workspace: root,
      gatewayPort: 18789,
      ollamaUrl: 'http://127.0.0.1:11435',
      inferenceUrl: api.url,
      remote: config,
    },
    settings,
  );
  assert.equal(gateway.models.providers['capri-api'].apiKey, '${CAPRI_REMOTE_PROXY_TOKEN}');
  assert.equal(gateway.agents.defaults.model.primary, 'capri-api/vendor/model');
  assert.equal(gateway.memory.search.remote.baseUrl, 'http://127.0.0.1:11435');
  assert.equal(JSON.stringify(gateway).includes(key), false);
  assert.equal(readdirSync(path.join(root, 'data/secrets')).length, 1);
});
test('provider errors and split streaming echoes cannot disclose the real API key', async (t) => {
  let fails = true;
  const { api } = await fixture(t, async () => {
    if (fails) return new Response('Invalid key ' + key, { status: 401 });
    const text = `data: ${JSON.stringify({ choices: [{ delta: { content: key } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const c of text) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
    );
  });
  const send = () =>
    api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [], stream: true }),
    });
  const failed = await send();
  assert.equal(failed.status, 401);
  assert.equal((await failed.text()).includes(key), false);
  fails = false;
  const response = await send(),
    text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(key), false);
  assert.match(text, /REDACTED/);
  assert.match(text, /\[DONE\]/);
});

test('provider client errors keep their HTTP status without exposing the provider body', async (t) => {
  let status = 403;
  const { api } = await fixture(
    t,
    async () => new Response('Private provider detail ' + key, { status }),
  );
  for (status of [400, 401, 402, 403, 404, 422, 429]) {
    const response = await api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [], stream: false }),
    });
    assert.equal(response.status, status);
    const text = await response.text();
    assert.equal(text.includes(key), false);
    assert.equal(text.includes('Private provider detail'), false);
  }
});

test('connection tests distinguish nested network errors, provider credentials and budget', async (t) => {
  let status = 401;
  const { api, id } = await fixture(t, async () => {
    if (!status)
      throw new TypeError('fetch failed', {
        cause: new AggregateError([Object.assign(new Error(), { code: 'ETIMEDOUT' })]),
      });
    return new Response('Provider details: ' + key, { status });
  });
  await assert.rejects(api.testProfile(id), /HTTP 401.*key belongs/);
  status = 402;
  await assert.rejects(api.testProfile(id), /HTTP 402.*balance/);
  status = 0;
  await assert.rejects(api.testProfile(id), /API connection failed.*ETIMEDOUT/);
});

async function localProbeFixture(reply) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-probe-thinking-'));
  const api = new InferenceApi({ root, storage });
  const provider = { ...config, baseUrl: 'http://127.0.0.1:11434/v1', model: 'thinking-model' };
  const id = await api.saveProfile({ settings: provider });
  const requests = [];
  api.upstream = async (request, _signal, settings, credential) => {
    assert.equal(credential, null);
    assert.deepEqual(request.messages, [{ role: 'user', content: 'Reply with only OK.' }]);
    requests.push({ ...request, model: settings.model });
    return { response: Response.json(reply(request, settings)) };
  };
  return { api, id, requests, provider };
}
const reasoningProbePacket = (fingerprint = 'fp_ollama') => ({
  system_fingerprint: fingerprint,
  choices: [
    { finish_reason: 'length', message: { content: '', reasoning: 'Synthetic reasoning' } },
  ],
});
const visibleProbePacket = (fingerprint = 'fp_ollama') => ({
  system_fingerprint: fingerprint,
  choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
});

test('local Ollama reasoning-only probes retry once with a small supported no-thinking budget', async () => {
  const { api, id, requests } = await localProbeFixture((request) =>
    request.reasoning_effort === 'none' ? visibleProbePacket() : reasoningProbePacket(),
  );
  assert.ok((await api.testProfile(id)).elapsedMs >= 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].max_tokens, 256);
  assert.equal(requests[0].reasoning_effort, undefined);
  assert.equal(requests[1].max_tokens, 64);
  assert.equal(requests[1].reasoning_effort, 'none');
  await api.testProfile(id);
  assert.equal(requests.length, 3, 'Only a successfully verified no-thinking probe is cached.');
  assert.equal(requests[2].reasoning_effort, 'none');
});

test('successful default probes and other models never inherit an unverified thinking control', async () => {
  const { api, id, requests, provider } = await localProbeFixture(() => visibleProbePacket());
  await api.testProfile(id);
  await api.testProfile(id);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.reasoning_effort === undefined));
  api.upstream = async (request, _signal, settings) => {
    requests.push({ ...request, model: settings.model });
    if (settings.model !== provider.model && request.reasoning_effort === 'none')
      throw Object.assign(new Error('Synthetic model does not support this thinking control.'), {
        providerStatus: 400,
      });
    return {
      response: Response.json(
        request.reasoning_effort ? visibleProbePacket() : reasoningProbePacket(),
      ),
    };
  };
  await api.testProfile(id);
  const other = await api.saveProfile({
    settings: { ...provider, model: 'mandatory-thinking-model' },
  });
  await assert.rejects(api.testProfile(other), { providerStatus: 400 });
  assert.equal(requests[4].model, 'mandatory-thinking-model');
  assert.equal(
    requests[4].reasoning_effort,
    undefined,
    'Verification is scoped to endpoint AND model.',
  );
  assert.equal(api.verifiedOllamaProbes.size, 1, 'Unsupported controls must not be cached.');
});

test('unknown and remote providers never gain speculative thinking parameters from a fingerprint', async (t) => {
  const local = await localProbeFixture(() => reasoningProbePacket('unrecognized-provider'));
  await assert.rejects(local.api.testProfile(local.id), /API model returned no text/);
  assert.equal(local.requests.length, 1);
  assert.equal(local.requests[0].reasoning_effort, undefined);
  let requests = 0;
  const { api, id } = await fixture(t, async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.reasoning_effort, undefined);
    assert.equal(JSON.stringify(request).includes(key), false);
    requests++;
    return Response.json(reasoningProbePacket());
  });
  await assert.rejects(api.testProfile(id), /API model returned no text/);
  assert.equal(
    requests,
    1,
    'A forged cloud fingerprint must not trigger provider-specific retries.',
  );
});

test('a reasoning-only or empty retry is not availability and never increases the fixed probe budget', async () => {
  const { api, id, requests } = await localProbeFixture(() => reasoningProbePacket());
  await assert.rejects(api.testProfile(id), /API model returned no text/);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => request.max_tokens),
    [256, 64],
  );
  assert.equal(api.verifiedOllamaProbes.size, 0, 'Failed no-thinking controls must not be cached.');
});

test('legacy connection migrates and selected profiles keep separate keys, even before restart', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-api-legacy-'));
  const next = { ...config, baseUrl: 'https://other.example/v1' };
  const legacyFile = path.join(root, 'data/secrets/inference-api.json');
  const settingsFile = path.join(root, 'data/desktop/inference-api.json');
  mkdirSync(path.dirname(legacyFile), { recursive: true });
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(config));
  writeFileSync(
    legacyFile,
    JSON.stringify({
      schemaVersion: 1,
      ciphertext: (await storage.encrypt(key)).toString('base64'),
    }),
  );
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      authorization: options.headers.authorization,
      body: JSON.parse(options.body),
    });
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };
  const api = new InferenceApi({ root, storage, fetchImpl });
  assert.equal(await api.key(), key);
  assert.equal((await api.status()).activeId, 'legacy');
  const nextKey = 'a-new-provider-test-key';
  const id = await api.saveProfile({ settings: next, name: 'Backup', key: nextKey });
  assert.equal((await api.status()).profiles.length, 2);
  await api.testProfile(id);
  assert.deepEqual(calls[0], {
    url: next.baseUrl + '/chat/completions',
    authorization: 'Bearer ' + nextKey,
    body: {
      model: next.model,
      messages: [{ role: 'user', content: 'Reply with only OK.' }],
      stream: true,
      max_tokens: 256,
    },
  });
  await api.selectProfile(id);
  assert.equal(await api.key(), key);
  const restarted = new InferenceApi({ root, storage, fetchImpl });
  assert.equal(restarted.config.baseUrl, next.baseUrl);
  assert.equal(await restarted.key(), nextKey);
  await restarted.testProfile('legacy');
  assert.equal(calls[1].url, config.baseUrl + '/chat/completions');
  assert.equal(calls[1].authorization, 'Bearer ' + key);
  assert.throws(() => restarted.removeProfile(id), /Switch to another/);
  await restarted.selectProfile(null);
  const local = new InferenceApi({ root, storage });
  assert.equal((await local.status()).activeId, null);
  assert.equal((await local.status()).profiles.length, 2);
  local.removeProfile('legacy');
  assert.equal((await local.status()).profiles.length, 1);
});

test('a key split over separate SSE deltas is withheld before it reaches the gateway', async (t) => {
  const split = Math.floor(key.length / 2);
  const { api } = await fixture(
    t,
    async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            const send = (content) =>
              controller.enqueue(
                new TextEncoder().encode(
                  'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n',
                ),
              );
            send('Safe opening.');
            await delay(30);
            send(key.slice(0, split));
            await delay(30);
            send(key.slice(split));
            controller.close();
          },
        }),
      ),
  );
  const response = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ messages: [], stream: true }),
  });
  const seen = [];
  await assert.rejects(async () => {
    for await (const bytes of response.body) seen.push(Buffer.from(bytes));
  });
  const output = Buffer.concat(seen).toString();
  assert.match(output, /Safe opening/);
  assert.ok(!output.includes(key.slice(0, split)));
  assert.ok(!output.includes(key.slice(split)));
});
test('tool-free vision uses the selected API, rejects unexpected actions, and API configuration rejects unsafe endpoints', async (t) => {
  let payload;
  const { api } = await fixture(t, async (_, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: '{"summary":"blue"}' } }] });
  });
  const response = await api.localFetch(api.url + '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Describe', images: ['AA=='] }],
      format: { type: 'object' },
      stream: true,
    }),
  });
  assert.equal((await response.json()).message.content, '{"summary":"blue"}');
  assert.equal(payload.messages[1].content[1].image_url.url, 'data:image/png;base64,AA==');
  assert.equal(payload.tools, undefined);
  assert.equal(payload.reasoning, undefined);
  for (const baseUrl of [
    'http://provider.example',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?key=secret',
    'https://example.com/#secret',
  ])
    assert.throws(() => apiSettings({ ...config, baseUrl }));
});

test('OpenRouter Nemotron reserves the output budget for visible replies unless thinking is selected', async (t) => {
  const requests = [];
  const provider = {
    ...config,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3.5-super-vl:free',
  };
  const { api, id } = await fixture(
    t,
    async (url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.at(-1).stream)
        return new Response(
          ': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      return Response.json({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
    },
    provider,
  );
  const call = async (pathname, body) =>
    api.localFetch(api.url + pathname, { method: 'POST', body: JSON.stringify(body) });
  const response = await call('/api/chat', {
    messages: [{ role: 'user', content: 'Describe', images: ['AA=='] }],
    options: { num_predict: 192 },
  });
  assert.equal((await response.json()).done_reason, 'length');
  assert.equal(requests[0].max_tokens, 192);
  assert.deepEqual(requests[0].reasoning, { enabled: false });
  await call('/v1/chat/completions', { messages: [{ role: 'user', content: 'Hello' }] });
  assert.deepEqual(requests[1].reasoning, { enabled: false });
  await call('/api/chat', {
    messages: [{ role: 'user', content: 'Plan a desktop step' }],
    options: { num_predict: 64 },
    format: { type: 'object' },
  });
  assert.deepEqual(requests[2].reasoning, { enabled: false });
  assert.deepEqual(requests[2].response_format, { type: 'json_object' });
  await call('/v1/chat/completions', {
    messages: [{ role: 'user', content: 'Solve this' }],
    reasoning_effort: 'medium',
  });
  assert.deepEqual(requests[3].reasoning, { effort: 'medium', exclude: true });

  const timeout = AbortSignal.timeout;
  const timeoutMock = t.mock.method(AbortSignal, 'timeout', (ms) => timeout(ms));
  await api.testProfile(id);
  assert.equal(timeoutMock.mock.calls[0].arguments[0], 60000);
  assert.deepEqual(requests[4].reasoning, { enabled: false });
  assert.equal(openRouterFreeReplyTimeoutMs(provider), 60000);
  assert.equal(openRouterFreeReplyTimeoutMs({ ...provider, model: 'vendor/paid' }), undefined);
  assert.equal(openRouterFreeReplyTimeoutMs({ ...config, model: provider.model }), undefined);
});

test('a text-only API accepts chat and refuses images before they leave Capri', async (t) => {
  const requests = [];
  const { api } = await fixture(
    t,
    async (_, options) => {
      requests.push(JSON.parse(options.body));
      return Response.json({ choices: [{ message: { content: 'Hello' } }] });
    },
    { ...config, vision: false },
  );
  const call = (pathname, message) =>
    api.localFetch(api.url + pathname, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', ...message }] }),
    });
  assert.ok((await call('/v1/chat/completions', { content: 'Explain the image_url field.' })).ok);
  assert.ok(!(await call('/api/chat', { content: 'Describe', images: ['AA=='] })).ok);
  assert.ok(
    !(
      await call('/v1/chat/completions', {
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
      })
    ).ok,
  );
  assert.equal(requests.length, 1);
});

test('manual vision preflight never queries a catalog or overrides a working image model', async (t) => {
  let posts = 0;
  const provider = {
    ...config,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'fixture/opaque-choice',
  };
  const { api } = await fixture(
    t,
    async (url, options) => {
      assert.equal(url, provider.baseUrl + '/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(
        JSON.parse(options.body).messages[0].content[1].image_url.url,
        'data:image/png;base64,AA==',
      );
      posts++;
      return Response.json({ choices: [{ message: { content: 'Image received' } }] });
    },
    provider,
  );
  assert.equal(await api.assertImageSupport(), true);
  assert.equal(posts, 0);
  const response = await api.localFetch(api.url + '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Describe', images: ['AA=='] }] }),
  });
  assert.equal(response.status, 200);
  await response.body.cancel();
  assert.equal(posts, 1);
  const blocked = await fixture(
    t,
    async () => assert.fail('Unchecked vision must block images before sending.'),
    { ...provider, vision: false },
  );
  await assert.rejects(blocked.api.assertImageSupport(), {
    code: 'MODEL_IMAGES_UNSUPPORTED',
    providerStatus: 422,
  });
  const warning = await blocked.api.localFetch(blocked.api.url + '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', images: ['AA=='] }] }),
  });
  assert.equal(warning.status, 422);
  assert.deepEqual(await warning.json(), {
    error: {
      code: 'model_images_unsupported',
      message: 'The active model cannot read images or video frames.',
    },
  });
});

test('only explicit provider image modality rejections become fixed typed warnings', async (t) => {
  let failure;
  const { api } = await fixture(t, async () =>
    Response.json(failure.body, { status: failure.status }),
  );
  const messages = [
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
    },
  ];
  for (const [status, message] of [
    [400, 'This model fixture.v1 does not support images.'],
    [404, 'No endpoints found that support image input'],
    [415, 'Image input is not supported by this model.'],
    [422, 'Unsupported image modality'],
  ]) {
    failure = { status, body: { error: { message, metadata: { raw: key } } } };
    await assert.rejects(api.upstream({ messages }, AbortSignal.timeout(1000)), {
      code: 'MODEL_IMAGES_UNSUPPORTED',
      providerStatus: 422,
      message: 'The active model cannot read images or video frames.',
    });
    const response = await api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.deepEqual(body, {
      error: {
        code: 'model_images_unsupported',
        message: 'The active model cannot read images or video frames.',
      },
    });
    assert.equal(JSON.stringify(body).includes(key), false);
    assert.equal(JSON.stringify(body).includes(message), false);
  }
  failure = { status: 400, body: { error: { code: 'image_input_not_supported' } } };
  await assert.rejects(api.upstream({ messages }, AbortSignal.timeout(1000)), {
    code: 'MODEL_IMAGES_UNSUPPORTED',
  });
});

test('format, size, access, account and non-image failures retain generic errors without body leaks', async (t) => {
  let failure;
  const { api } = await fixture(
    t,
    async () =>
      new Response(failure.raw ?? JSON.stringify({ error: { message: failure.message } }), {
        status: failure.status,
      }),
  );
  const imageMessages = [
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
    },
  ];
  for (failure of [
    { status: 400, message: 'Unsupported image format: JPEG metadata invalid.' },
    { status: 422, message: 'Image input is not supported at this size.' },
    { status: 400, message: 'This image resolution is unsupported.' },
    { status: 404, message: 'Model was not found.' },
    { status: 401, message: 'Model does not support images.' },
    { status: 403, message: 'Model does not support images.' },
    { status: 402, message: 'Model does not support images.' },
    { status: 408, message: 'Model does not support images.' },
    { status: 429, message: 'Model does not support images.' },
    { status: 400, message: 'Image input not supported: API key permissions are missing.' },
    { status: 400, raw: 'Model does not support images. ' + key },
    {
      status: 400,
      raw: JSON.stringify({
        error: {
          message: 'Model does not support images.',
          private: key,
          padding: 'x'.repeat(8192),
        },
      }),
    },
  ]) {
    const response = await api.localFetch(api.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: imageMessages }),
    });
    assert.equal(response.status, failure.status);
    const body = await response.json();
    assert.equal(body.error.code, 'CAPRI_API_PROVIDER_ERROR');
    assert.match(body.error.message, /^API provider returned HTTP /);
    assert.equal(JSON.stringify(body).includes(key), false);
    assert.equal(JSON.stringify(body).includes('Unsupported image format'), false);
  }
  failure = { status: 400, message: 'Model does not support images.' };
  const textOnly = await api.localFetch(api.url + '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Text only' }] }),
  });
  assert.equal(textOnly.status, 400);
  assert.equal((await textOnly.json()).error.code, 'CAPRI_API_PROVIDER_ERROR');
});

test('Lemonade Gemma uses the canonical ID, keeps vision and sends a minimal RyzenAI request', async (t) => {
  const base = {
    enabled: true,
    model: 'Gemma-3-4b-it-mm-npu',
    contextTokens: 8192,
    tools: true,
    vision: true,
  };
  const normalized = apiSettings({ ...base, baseUrl: 'http://localhost: 13305/v1' });
  assert.equal(normalized.baseUrl, 'http://127.0.0.1:13305/api/v1');
  assert.equal(normalized.model, 'Gemma-3-4b-it-mm-NPU');
  assert.equal(normalized.tools, false);
  assert.equal(normalized.vision, true);
  assert.equal(
    apiSettings({ ...base, contextTokens: 32768, baseUrl: 'https://localhost:13305/v1' }).baseUrl,
    'https://localhost:13305/v1',
  );
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (requests.at(-1).stream)
      res
        .setHeader('content-type', 'text/event-stream')
        .end(
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
    else
      res
        .setHeader('content-type', 'application/json')
        .end('{"choices":[{"message":{"content":"A picture."},"finish_reason":"stop"}]}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-gemma-npu-'));
  const options = { root, storage: { available: async () => false } };
  const api = new InferenceApi(options);
  let restarted;
  t.after(() => {
    restarted?.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  const id = await api.saveProfile({
    settings: { ...base, baseUrl: `http://127.0.0.1:${upstream.address().port}/api/v1` },
  });
  await api.testProfile(id);
  await api.selectProfile(id);
  restarted = new InferenceApi(options);
  await restarted.start(0);
  const result = await restarted.localFetch(restarted.url + '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Describe', images: ['AA=='] }],
      options: { num_predict: 64 },
    }),
  });
  assert.equal((await result.json()).message.content, 'A picture.');
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].max_tokens, 32);
  assert.equal(requests[1].model, 'Gemma-3-4b-it-mm-NPU');
  assert.deepEqual(requests[1].messages[0].content, [
    { type: 'text', text: 'Describe' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
  ]);
});

test('Lemonade-style HTTP profiles can save and run keyless, with no model tool calls', async (t) => {
  const requests = [];
  let streamError = false;
  const upstream = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push({ url: request.url, authorization: request.headers.authorization, body });
    if (
      body.messages.some(
        ({ role, content }) =>
          !['system', 'user', 'assistant'].includes(role) || typeof content !== 'string',
      ) ||
      (Array.isArray(body.stop) && body.stop.some((value) => typeof value !== 'string'))
    ) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          error: {
            message:
              'Invalid JSON: [json.exception.type_error.302] type must be string, but is null',
          },
        }),
      );
      return;
    }
    if (body.stream) {
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        streamError
          ? 'data: {"error":{"message":"Fixture stream failed"}}\n\ndata: [DONE]\n\n'
          : 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
      );
    } else {
      response.setHeader('content-type', 'application/json');
      response.end('{"choices":[{"message":{"role":"assistant","content":"OK","refusal":null}}]}');
    }
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-loopback-'));
  const options = { root, storage: { available: async () => false } };
  const api = new InferenceApi(options);
  const id = await api.saveProfile({
    settings: {
      enabled: true,
      model: 'Phi-4-mini-instruct-NPU',
      baseUrl: 'http://localhost:' + upstream.address().port + '/api/v1',
      contextTokens: 8192,
      tools: true,
      vision: true,
    },
  });
  const profile = (await api.status()).profiles[0];
  assert.equal(profile.canConnect, true);
  assert.equal(profile.hasKey, false);
  assert.equal(profile.tools, false);
  assert.equal(profile.vision, false);
  assert.match(profile.baseUrl, /^http:\/\/127\.0\.0\.1:/u);
  await api.testProfile(id);
  await api.selectProfile(id);
  const restarted = new InferenceApi(options);
  await restarted.start(0);
  t.after(() => restarted.close());
  const config = createGatewayConfiguration(
    {
      stateDir: root,
      workspace: root,
      gatewayPort: 18789,
      ollamaUrl: 'http://127.0.0.1:11435',
      inferenceUrl: restarted.url,
      remote: restarted.config,
    },
    settings,
  );
  assert.equal(config.models.providers['capri-api'].models[0].compat.supportsTools, false);
  assert.equal(config.models.providers['capri-api'].models[0].contextWindow, 8192);
  const send = (stream) =>
    restarted.localFetch(restarted.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        stream,
        tools: [{ type: 'function' }],
        tool_choice: 'auto',
        stop: [null, 'END'],
        messages: [
          { role: 'developer', content: 'Keep replies short.' },
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer', reasoning_content: 'Internal' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'old' }] },
          { role: 'tool', tool_call_id: 'old', content: 'Old result' },
          { role: 'user', content: null },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'text', text: 'Capri' },
            ],
          },
        ],
      }),
    });
  assert.equal(
    (await fetch(restarted.url + '/v1/chat/completions', { method: 'POST' })).status,
    401,
  );
  assert.match(await (await send(true)).text(), /"finish_reason":null/);
  assert.equal((await (await send(false)).json()).choices[0].message.refusal, null);
  assert.equal(requests.length, 3);
  for (const { url, authorization, body } of requests) {
    assert.equal(url, '/api/v1/chat/completions');
    assert.equal(authorization, undefined);
    assert.equal(body.model, 'Phi-4-mini-instruct-NPU');
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
  }
  assert.equal(requests[0].body.stream, true);
  assert.deepEqual(
    requests[0].body.messages.map(({ role }) => role),
    ['system', 'user', 'assistant', 'user'],
  );
  for (const { body } of requests.slice(1)) {
    assert.deepEqual(body.stop, ['END']);
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'Keep replies short.' },
      { role: 'user', content: 'Previous question' },
      { role: 'assistant', content: 'Previous answer' },
      { role: 'user', content: 'Hello\nCapri' },
    ]);
  }
  streamError = true;
  await assert.rejects(api.testProfile(id), /API model returned no text/);
  assert.throws(() => apiSettings({ ...profile, id: undefined }), /Invalid API settings/);
  for (const baseUrl of [
    'http://192.168.1.2:13305/v1',
    'http://localhost.example/v1',
    'http://localhost: 13305/v1',
    'http://localhost:13305/v1?token=a',
  ])
    assert.throws(() => apiSettings({ enabled: true, model: 'x', baseUrl }), /Use HTTPS/);
  await assert.rejects(
    api.saveProfile({
      settings: {
        enabled: true,
        baseUrl: 'https://external.example/v1',
        model: 'x',
      },
    }),
    /valid API key/,
  );
});
