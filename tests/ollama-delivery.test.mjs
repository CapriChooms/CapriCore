import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { root } from '../packages/runtime/src/index.mjs';
import { applyOpenClawCompatibility } from '../scripts/openclaw-compat.mjs';

applyOpenClawCompatibility(root);
const { createOllamaStreamFn, buildAssistantMessage } = await import(
  '../node_modules/openclaw/dist/stream.runtime-DVVOeOOt.mjs'
);
const model = {
  id: 'capri-qwen3.5:9b',
  name: 'Capri Qwen',
  input: ['text'],
  provider: 'ollama',
  api: 'ollama',
  reasoning: true,
  contextWindow: 16384,
  maxTokens: 2048,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  params: { num_ctx: 16384, temperature: 0.85 },
};

test('only an explicit Capri final-answer prefix can recover a mislabeled reply; private analysis stays private', () => {
  const build = (message) =>
    buildAssistantMessage(
      {
        message: { role: 'assistant', ...message },
        done: true,
        done_reason: 'stop',
        eval_count: 8,
        prompt_eval_count: 12,
      },
      model,
      {},
    );
  const recovered = build({ thinking: '[avatar:neutral]\nFour.', content: '' });
  assert.deepEqual(recovered.content, [{ type: 'text', text: '[avatar:neutral]\nFour.' }]);
  for (const thinking of [
    'Private analysis about which action to take.',
    'I might select [avatar:neutral] later.',
  ]) {
    const result = build({ thinking, content: '' });
    assert.ok(!result.content.some((item) => item.type === 'text'));
  }
  const tool = build({
    thinking: '[avatar:neutral]\nNot yet executed.',
    content: '',
    tool_calls: [
      { id: 'test', function: { name: 'spotify_control', arguments: { action: 'pause' } } },
    ],
  });
  assert.ok(!tool.content.some((item) => item.type === 'text'));
});

test('tool delivery overrides late payload policies and preserves a final JSON reply as visible text', async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json');
    // A final JSON object without a newline must work as well as NDJSON chunks.
    res.end(
      JSON.stringify({
        model: model.id,
        message: { role: 'assistant', content: 'Music paused.' },
        done: true,
        done_reason: 'stop',
        eval_count: 4,
        prompt_eval_count: 12,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const stream = createOllamaStreamFn(`http://127.0.0.1:${server.address().port}`);
  const user = { role: 'user', content: [{ type: 'text', text: 'Hold the music.' }] };
  const tool = {
    role: 'toolResult',
    toolName: 'spotify_control',
    toolCallId: 'pause-test',
    content: [{ type: 'text', text: '{"ok":true,"confirmation":"Music paused."}' }],
  };
  const forcedPolicy = (body) => ({
    ...body,
    think: true,
    stream: true,
    options: { ...body.options, temperature: 0.85, presence_penalty: 1.5 },
  });
  const events = [];
  for await (const event of stream(
    model,
    { systemPrompt: 'Use the exact confirmation.', messages: [user, tool] },
    { reasoning: 'low', onPayload: forcedPolicy },
  ))
    events.push(event);
  assert.ok(requests.length, 'Provider failed before HTTP: ' + JSON.stringify(events));
  assert.equal(requests[0].think, false);
  assert.equal(requests[0].shift, false, 'Auxiliary calls must match this gateway runner policy');
  assert.equal(requests[0].truncate, false);
  assert.equal(requests[0].stream, false);
  assert.equal(requests[0].options.temperature, 0.2);
  assert.equal(requests[0].options.presence_penalty, 0);
  assert.ok(events.some((event) => event.type === 'text_delta' && event.delta === 'Music paused.'));
  assert.ok(events.some((event) => event.type === 'done'));
  assert.ok(!events.some((event) => event.type === 'thinking_delta'));
  for await (const _event of stream(
    model,
    { systemPrompt: 'Ordinary conversation.', messages: [user] },
    { reasoning: 'low', onPayload: forcedPolicy },
  )) {
    /* Drain the ordinary streaming path. */
  }
  assert.equal(requests[1].think, true);
  assert.equal(requests[1].stream, true);
  assert.equal(requests[1].options.temperature, 0.85);
});

test('selected local reasoning changes only this request and bounds total output without reloading the model', async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { role: 'assistant', content: 'Four.' }, done: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const stream = createOllamaStreamFn(`http://127.0.0.1:${server.address().port}`);
  const context = { messages: [{ role: 'user', content: [{ type: 'text', text: 'Check 2+2.' }] }] };
  for (const [selectedModel, options] of [
    [
      { ...model, maxTokens: 8192 },
      { reasoning: 'medium', maxTokens: 8192, onPayload: (body) => ({ ...body, think: false }) },
    ],
    [
      { ...model, maxTokens: 8192 },
      { reasoning: 'off', onPayload: (body) => ({ ...body, think: true }) },
    ],
    [
      { ...model, id: 'unsupported', reasoning: false, maxTokens: 8192 },
      { reasoning: 'medium', maxTokens: 8192 },
    ],
    [
      { ...model, maxTokens: 8192 },
      { reasoning: 'medium', maxTokens: 6144 },
    ],
  ])
    for await (const _event of stream(selectedModel, context, options)) {
      /* Drain the provider response. */
    }
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.url === '/api/chat'));
  assert.equal(requests[0].body.think, true);
  // This caps thinking plus visible text together; it does not reserve a
  // separate answer portion or prove that a model ends its thinking early.
  assert.equal(requests[0].body.options.num_predict, 8192);
  assert.equal(requests[0].body.options.num_ctx, model.params.num_ctx);
  assert.equal(requests[1].body.think, false);
  assert.equal(requests[1].body.options.num_predict, 2048);
  assert.equal(requests[2].body.think, undefined);
  assert.equal(requests[2].body.options.num_predict, 8192);
  assert.equal(requests[3].body.options.num_predict, 6144, 'Preserve a context-clamped SDK limit.');
  assert.equal(model.maxTokens, 2048);
  assert.equal(model.params.num_ctx, 16384);
});
