// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { computerPlanner, computerActionSchema } from '../apps/desktop/computer-planner.mjs';
import { matchesPlannerSchema, nativePlannerFormatError } from '../apps/desktop/planner-json.mjs';

const nativeError =
  'llama-server chat error: map[code:500 message:The model produced output that does not match the expected peg-native format type:server_error]';
const rejected = () => Response.json({ error: nativeError }, { status: 500 });
const packet = (value, extra = {}) =>
  Response.json({ done: true, message: { content: JSON.stringify(value) }, ...extra });
const state = () => ({
  originalOwnerGoal: 'Open the synthetic QA application.',
  currentObservation: {
    window: { untrustedTitle: 'Synthetic QA' },
    targets: [{ targetId: 'live-1', untrustedLabel: 'QA button' }],
  },
  taskPlan: { revision: 0, completedCheckpoints: [], remainingCheckpoints: [] },
});
const step = () => ({
  action: 'launch',
  query: 'Notepad',
  summary: 'Open the requested application.',
  plan: [
    {
      id: 'open',
      label: 'Open application',
      successCriterion: 'The requested application is visible.',
    },
  ],
});
const planner = (fetchImpl) =>
  computerPlanner({ url: 'http://127.0.0.1:1234', model: 'fixture', fetchImpl });

test('only the native PEG format failure retries once, caches JSON mode and preserves the exact request', async () => {
  const calls = [];
  const plan = planner(async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length === 1) return rejected();
    if (calls.length === 2) return packet(step());
    return packet({
      action: 'click',
      targetId: 'QA button [live-1]',
      summary: 'Select the requested control.',
    });
  });
  assert.equal((await plan(state())).action, 'launch');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].format.anyOf);
  assert.equal(calls[1].format, 'json');
  assert.deepEqual(calls[1].options, calls[0].options);
  assert.deepEqual(calls[1].messages.slice(1), calls[0].messages.slice(1));
  assert.deepEqual(calls[1].tools, []);
  assert.match(calls[1].messages[0].content, /allowed action shapes/);
  const later = state();
  later.taskPlan.revision = 1;
  assert.equal((await plan(later)).targetId, 'live-1');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].format, 'json');
});

test('unrelated HTTP failures, OOM, provider errors and oversized errors never trigger the fallback', async () => {
  for (const [status, error] of [
    [500, 'CUDA out of memory'],
    [500, 'Some other model failure'],
    [502, nativeError],
    [500, { message: nativeError }],
    [500, 'x'.repeat(5000) + nativeError],
  ]) {
    let calls = 0;
    const plan = planner(async () => {
      calls++;
      return Response.json({ error }, { status });
    });
    await assert.rejects(plan(state()), /Computer planning HTTP/);
    assert.equal(calls, 1);
  }
});

test('a failing JSON fallback is not retried again', async () => {
  let calls = 0;
  const plan = planner(async () => {
    calls++;
    return rejected();
  });
  await assert.rejects(plan(state()), /HTTP 500/);
  assert.equal(calls, 2);
});

test('owner cancellation prevents a format retry after the failed inference', async () => {
  let calls = 0;
  const controller = new AbortController();
  const plan = planner(async () => {
    calls++;
    controller.abort();
    return rejected();
  });
  await assert.rejects(plan(state(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('cached JSON completion reviews retain boolean and current-evidence constraints', async () => {
  let calls = 0,
    invalid = false;
  const plan = planner(async () => {
    if (++calls === 1) return rejected();
    if (calls === 2) return packet(step());
    return packet({
      complete: invalid ? 'yes' : true,
      evidence: 'Synthetic QA',
      summary: 'Done.',
      missing: '',
    });
  });
  await plan(state());
  assert.equal((await plan(state(), { review: true })).action, 'finish');
  invalid = true;
  await assert.rejects(plan(state(), { review: true }), /Invalid computer plan/);
  assert.equal(calls, 4);
});

test('JSON fallback retains complete branch, target, argument and first-plan constraints', async () => {
  const invalid = [
    { ...step(), query: undefined },
    { ...step(), query: 'https://example.org' },
    { ...step(), extra: 'Unrequested field' },
    { ...step(), summary: 'x'.repeat(501) },
    { ...step(), plan: undefined },
    { ...step(), plan: [] },
    {
      ...step(),
      plan: [{ id: 'invalid id', label: 'Open application', successCriterion: 'Visible window' }],
    },
    { ...step(), action: 'click', query: undefined, targetId: 'forged' },
    { ...step(), action: 'press_keys', query: undefined, keys: ['CTRL', 'N'], holdMs: 2001 },
  ];
  for (const value of invalid) {
    let calls = 0;
    const plan = planner(async () => (++calls === 1 ? rejected() : packet(value)));
    await assert.rejects(plan(state()), /Invalid computer plan/);
    assert.equal(calls, 2);
  }
});

test('remote JSON-object adapters cannot bypass the full action schema without a native fallback', async () => {
  for (const value of [
    { ...step(), query: undefined },
    { ...step(), plan: undefined },
    { ...step(), command: 'Unrequested arbitrary command' },
    { action: 'click', targetId: 'Unobserved [forged]', summary: 'Click it.', plan: step().plan },
    {
      action: 'enter_text',
      targetId: 'QA button [live-1]',
      text: 'Synthetic text',
      summary: 'Type.',
      plan: step().plan,
    },
  ]) {
    let calls = 0;
    // InferenceApi forwards format as response_format=json_object. A provider
    // can therefore return valid JSON that violates the action-specific schema.
    const plan = planner(async () => {
      calls++;
      return packet(value);
    });
    await assert.rejects(plan(state()), /Invalid computer plan/);
    assert.equal(calls, 1);
  }
  const valid = planner(async () => packet(step()));
  assert.equal((await valid(state())).action, 'launch');
});

test('JSON fallback still rejects incomplete packets, tool calls and malformed JSON', async () => {
  for (const response of [
    () => packet(step(), { done: false }),
    () => packet(step(), { done_reason: 'length' }),
    () =>
      Response.json({ done: true, message: { tool_calls: [{}], content: JSON.stringify(step()) } }),
    () => Response.json({ done: true, message: { content: 'not JSON' } }),
  ]) {
    let calls = 0;
    const plan = planner(async () => (++calls === 1 ? rejected() : response()));
    await assert.rejects(plan(state()));
    assert.equal(calls, 2);
  }
});

test('host schema validation covers nested constraints, item uniqueness and fails closed on unknown keywords', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'value'],
          properties: {
            id: { type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$' },
            value: { type: 'integer', minimum: 1, maximum: 3, enum: [1, 3] },
          },
        },
      },
    },
  };
  const valid = { items: [{ id: 'ab', value: 3 }] };
  assert.equal(matchesPlannerSchema(valid, schema), true);
  for (const value of [
    { items: [] },
    { items: [valid.items[0], valid.items[0]] },
    { items: [{ id: 'abcd', value: 3 }] },
    { items: [{ id: 'a1', value: 3 }] },
    { items: [{ id: 'ab', value: 2 }] },
    { items: [{ id: 'ab', value: 4 }] },
    { items: [{ id: 'ab', value: 1.5 }] },
    { items: [{ id: 'ab', value: 1, extra: true }] },
  ])
    assert.equal(matchesPlannerSchema(value, schema), false);
  assert.equal(matchesPlannerSchema(valid, { ...schema, not: {} }), false);
  assert.equal(matchesPlannerSchema('a', { type: 'integer', anyOf: [{ type: 'string' }] }), false);
  const generated = computerActionSchema(
    { targets: [] },
    { type: 'string', enum: ['Synthetic QA'] },
  );
  assert.equal(
    matchesPlannerSchema(
      { action: 'finish', summary: 'Done', evidence: 'Synthetic QA' },
      generated,
    ),
    true,
  );
  assert.equal(
    matchesPlannerSchema({ action: 'click', summary: 'Click', targetId: 'unknown' }, generated),
    false,
  );
});

test('native error-body inspection is bounded and cancels an oversized stream', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5000));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 500 },
  );
  assert.equal(await nativePlannerFormatError(response), false);
  assert.equal(cancelled, true);
});
