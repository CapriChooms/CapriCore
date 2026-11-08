// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeReasoningAnswer, reasoningCases } from '../tools/verify/reasoning-cases.mjs';
import { runReasoningEvaluation } from '../tools/verify/reasoning-evaluation.mjs';
import { createReasoningOllamaAdapter } from '../tools/verify/reasoning-ollama-adapter.mjs';
import { decorateReasoningReport, reasoningReportHtml } from '../tools/verify/reasoning-report.mjs';

test('reasoning bank has eighteen unique balanced questions across seven languages with checkable answers', () => {
  assert.equal(reasoningCases.length, 18);
  assert.equal(new Set(reasoningCases.map((value) => value.id)).size, 18);
  assert.deepEqual([...new Set(reasoningCases.map((value) => value.language))].sort(), [
    'de',
    'en',
    'es',
    'fr',
    'ja',
    'ru',
    'zh',
  ]);
  for (const category of ['logic', 'mathematics', 'physics'])
    assert.equal(reasoningCases.filter((value) => value.category === category).length, 6);
  for (const value of reasoningCases) {
    const answer = value.kind === 'set' ? value.expected.join(',') : value.expected;
    assert.deepEqual(
      gradeReasoningAnswer(value, JSON.stringify({ answer })),
      { pass: true },
      value.id,
    );
    assert.deepEqual(
      gradeReasoningAnswer(
        value,
        JSON.stringify({ answer: value.kind === 'set' ? 'B' : '999999' }),
      ),
      { pass: false, failure: 'wrong_answer' },
      value.id,
    );
  }
  const power = Number(7n ** 222n % 100n);
  assert.equal(
    String(power),
    reasoningCases.find((value) => value.id === 'math-en-power-modulo').expected,
  );
  let josephus = 0;
  for (let count = 2; count <= 41; count++) josephus = (josephus + 3) % count;
  assert.equal(
    String(josephus + 1),
    reasoningCases.find((value) => value.id === 'logic-de-josephus').expected,
  );
});

test('answer checker handles exact fractions, signed/scientific numbers, explicit tolerance and unordered sets', () => {
  const number = { kind: 'number', expected: '5/2' };
  for (const answer of ['2.5', '10/4', '+25e-1', '2500e-3'])
    assert.equal(gradeReasoningAnswer(number, JSON.stringify({ answer })).pass, true);
  assert.equal(
    gradeReasoningAnswer({ kind: 'number', expected: '-3/2' }, '{"answer":"-1.5"}').pass,
    true,
  );
  assert.equal(
    gradeReasoningAnswer({ kind: 'number', expected: '1/3' }, '{"answer":"0.333333"}').pass,
    false,
  );
  assert.equal(
    gradeReasoningAnswer(
      { kind: 'number', expected: '1/3', absoluteTolerance: 0.001 },
      '{"answer":"0.333"}',
    ).pass,
    true,
  );
  assert.equal(
    gradeReasoningAnswer({ kind: 'set', expected: ['A', 'D'] }, '{"answer":"d, a"}').pass,
    true,
  );
  for (const content of [
    '2.5',
    '```json\n{"answer":"2.5"}\n```',
    '{"answer":"2.5", "reason":"private"}',
    '{"answer":"1/0"}',
    '{"answer":"1e9999"}',
    '{"answer":"2.5 m/s"}',
    '{"answer":true}',
    '{"answer":"process.exit()"}',
  ])
    assert.equal(gradeReasoningAnswer(number, content).failure, 'answer_format');
});

test('evaluation pairs identical questions in alternating mode order without retaining model output or provider details', async () => {
  const calls = [];
  const report = await runReasoningEvaluation({
    model: 'synthetic-unit-fixture',
    cases: reasoningCases.slice(0, 2),
    infer: async (request) => {
      calls.push(request);
      return { content: '{"answer":"A"}', model: 'synthetic-actual-model' };
    },
  });
  assert.equal(report.completed, true);
  assert.deepEqual(
    calls.map((value) => value.mode),
    ['baseline', 'reasoning', 'reasoning', 'baseline'],
  );
  assert.deepEqual(calls[0].messages, calls[1].messages);
  assert.deepEqual(calls[2].messages, calls[3].messages);
  assert.equal(report.results.length, 4);
  assert.deepEqual(report.paired, {
    improved: 0,
    regressed: 0,
    bothPassed: 1,
    bothFailed: 1,
    incomplete: 0,
  });
  assert(report.results.every((row) => row.actualModel === 'synthetic-actual-model'));
  assert.equal(JSON.stringify(report).includes('"content"'), false);
  const failure = await runReasoningEvaluation({
    model: 'synthetic-unit-fixture',
    cases: reasoningCases.slice(0, 1),
    infer: () => {
      throw new Error('private provider credential must never be recorded');
    },
  });
  assert.equal(failure.summary.baseline.failed, 1);
  assert.equal(JSON.stringify(failure).includes('private provider'), false);
});

test('overall budget and explicit cancellation stop a hung adapter without dispatching later questions', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let calls = 0;
    const report = await runReasoningEvaluation({
      model: 'synthetic-unit-fixture',
      cases: reasoningCases.slice(0, 2),
      overallTimeoutMs: 30,
      requestTimeoutMs: 500,
      signal: controller.signal,
      infer: () => {
        calls++;
        if (cancel) controller.abort();
        return new Promise(() => {});
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.completed, false);
    assert.equal(report.stopped, cancel ? 'cancelled' : 'overall_timeout');
  }
});

test('local adapter sends actual think flags with bounded budgets and never serializes tools or credentials', async () => {
  const requests = [];
  const infer = createReasoningOllamaAdapter({
    url: 'http://127.0.0.1:1234',
    contextTokens: 8192,
    reasoningTokens: 4096,
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, '/api/chat');
      assert.equal(options.headers.authorization, undefined);
      requests.push(JSON.parse(options.body));
      return Response.json({
        done: true,
        done_reason: 'stop',
        eval_count: 11,
        model: 'synthetic-fixture',
        message: { content: '{"answer":"A"}', thinking: 'never retain this reasoning' },
      });
    },
  });
  for (const mode of ['baseline', 'reasoning']) {
    const result = await infer({
      mode,
      model: 'synthetic-fixture',
      messages: [
        { role: 'system', content: 'JSON only.' },
        { role: 'user', content: 'Public question.' },
      ],
    });
    assert.equal(result.content, '{"answer":"A"}');
    assert.equal(result.reasoningObserved, true);
    assert.equal(result.visibleCharacters, '{"answer":"A"}'.length);
    assert.equal(result.reasoningCharacters, 'never retain this reasoning'.length);
    assert.equal(result.doneReason, 'stop');
    assert.equal(result.budgetExhausted, false);
    assert.equal(JSON.stringify(result).includes('never retain'), false);
  }
  assert.deepEqual(
    requests.map((request) => request.think),
    [false, true],
  );
  assert.deepEqual(
    requests.map((request) => request.options.num_predict),
    [768, 4096],
  );
  assert(
    requests.every((request) => request.options.num_ctx === 8192 && request.tools.length === 0),
  );
  assert.deepEqual(requests[0].messages[1], requests[1].messages[1]);
  for (const url of [
    'https://example.com',
    'http://127.0.0.1.evil.test',
    'http://user:secret@localhost',
    'http://localhost/?key=secret',
  ])
    assert.throws(() => createReasoningOllamaAdapter({ url }));
});

test('readable report escapes metadata and distinguishes unavailable diagnostics from derived limits', async () => {
  const report = await runReasoningEvaluation({
    model: '<img src=x onerror=alert(1)>',
    cases: reasoningCases.slice(0, 1),
    infer: async () => ({ content: '{"answer":"A"}', outputTokens: 768 }),
  });
  report.metadata = { baseline: { outputTokens: 768 }, reasoning: { outputTokens: 8192 } };
  decorateReasoningReport(report, reasoningCases.slice(0, 1));
  assert.equal(report.summary.baseline.tokenLimitReachedByCount, 1);
  assert.equal(report.summary.reasoning.tokenLimitReachedByCount, 0);
  assert.equal(report.metricAvailability.reasoningCharacters, false);
  assert.equal(report.metadata.nativeThinkingCapVerified, false);
  const html = reasoningReportHtml(report, reasoningCases.slice(0, 1));
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img/);
  assert.match(html, /Final format unverified/);
});
