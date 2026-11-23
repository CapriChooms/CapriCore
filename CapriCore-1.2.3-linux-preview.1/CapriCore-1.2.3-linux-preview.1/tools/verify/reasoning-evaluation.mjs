// SPDX-License-Identifier: GPL-3.0-only
import { gradeReasoningAnswer, reasoningCases } from './reasoning-cases.mjs';

export const reasoningAnswerInstruction =
  'Solve the question. Return exactly one JSON object with only the key "answer". ' +
  'Its value must be a short string containing the requested exact number, fraction or letter(s), ' +
  'without units, explanations or Markdown. Do not include intermediate reasoning in the answer.';

async function boundedInference(infer, request, signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([...(signal ? [signal] : []), timeout]);
  combined.throwIfAborted();
  let listener;
  try {
    return await Promise.race([
      Promise.resolve().then(() => infer({ ...request, signal: combined })),
      new Promise((_, reject) => {
        listener = () => reject(combined.reason);
        combined.addEventListener('abort', listener, { once: true });
        if (combined.aborted) listener();
      }),
    ]);
  } finally {
    if (listener) combined.removeEventListener('abort', listener);
  }
}

/** Adapter supplies inference only; this runner has no access to app state or credentials. */
export async function runReasoningEvaluation({
  infer,
  model,
  cases = reasoningCases,
  requestTimeoutMs = 90000,
  overallTimeoutMs = 1200000,
  signal,
  onResult = () => {},
}) {
  if (typeof infer !== 'function' || typeof model !== 'string' || !model || model.length > 256)
    throw new Error('An explicit model and inference adapter are required.');
  for (const milliseconds of [requestTimeoutMs, overallTimeoutMs])
    if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 3600000)
      throw new Error('Evaluation deadlines must be bounded.');
  const budget = AbortSignal.timeout(overallTimeoutMs);
  const combined = AbortSignal.any([...(signal ? [signal] : []), budget]);
  const report = {
    schemaVersion: 1,
    requestedModel: model,
    startedAt: new Date().toISOString(),
    completed: false,
    stopped: null,
    questionCount: cases.length,
    results: [],
    limitations: [
      'A small synthetic multilingual sample is not a general intelligence or safety benchmark.',
      'Each question is asked once per mode; one run cannot establish statistical significance.',
      'Strict JSON answer format failures count as failures even if prose contains a correct value.',
      'Latency includes server queueing and model loading; no unrecorded warm-up requests are made.',
      'No generated reasoning or provider error body is saved in this report.',
    ],
  };
  for (const [index, caseValue] of cases.entries()) {
    const modes = index % 2 === 0 ? ['baseline', 'reasoning'] : ['reasoning', 'baseline'];
    for (const mode of modes) {
      if (combined.aborted) {
        report.stopped = signal?.aborted ? 'cancelled' : 'overall_timeout';
        break;
      }
      const started = performance.now();
      let result;
      try {
        const response = await boundedInference(
          infer,
          {
            mode,
            model,
            caseId: caseValue.id,
            messages: [
              { role: 'system', content: reasoningAnswerInstruction },
              { role: 'user', content: caseValue.prompt },
            ],
          },
          combined,
          requestTimeoutMs,
        );
        result = gradeReasoningAnswer(caseValue, response?.content);
        if (typeof response?.model === 'string' && response.model.length <= 256)
          result.actualModel = response.model;
        if (typeof response?.reasoningObserved === 'boolean')
          result.reasoningObserved = response.reasoningObserved;
        if (Number.isSafeInteger(response?.outputTokens) && response.outputTokens >= 0)
          result.outputTokens = response.outputTokens;
        for (const key of ['visibleCharacters', 'reasoningCharacters'])
          if (Number.isSafeInteger(response?.[key]) && response[key] >= 0)
            result[key] = response[key];
        if (['stop', 'length', 'other'].includes(response?.doneReason))
          result.doneReason = response.doneReason;
        if (typeof response?.budgetExhausted === 'boolean')
          result.budgetExhausted = response.budgetExhausted;
      } catch (error) {
        result = {
          pass: false,
          failure: combined.aborted
            ? 'cancelled'
            : error?.name === 'TimeoutError'
              ? 'request_timeout'
              : 'inference_error',
        };
      }
      const row = {
        caseId: caseValue.id,
        language: caseValue.language,
        category: caseValue.category,
        mode,
        latencyMs: Math.round(performance.now() - started),
        ...result,
      };
      report.results.push(row);
      await onResult(row);
      if (combined.aborted) {
        report.stopped = signal?.aborted ? 'cancelled' : 'overall_timeout';
        break;
      }
    }
    if (report.stopped) break;
  }
  report.completed = report.results.length === cases.length * 2 && !report.stopped;
  report.finishedAt = new Date().toISOString();
  report.paired = { improved: 0, regressed: 0, bothPassed: 0, bothFailed: 0, incomplete: 0 };
  for (const caseValue of cases) {
    const rows = report.results.filter((row) => row.caseId === caseValue.id);
    const baseline = rows.find((row) => row.mode === 'baseline');
    const reasoning = rows.find((row) => row.mode === 'reasoning');
    if (!baseline || !reasoning) report.paired.incomplete++;
    else if (baseline.pass && reasoning.pass) report.paired.bothPassed++;
    else if (!baseline.pass && !reasoning.pass) report.paired.bothFailed++;
    else if (reasoning.pass) report.paired.improved++;
    else report.paired.regressed++;
  }
  report.summary = Object.fromEntries(
    ['baseline', 'reasoning'].map((mode) => {
      const rows = report.results.filter((row) => row.mode === mode);
      return [
        mode,
        {
          completed: rows.length,
          validResponses: rows.filter(
            (row) => !['inference_error', 'request_timeout', 'cancelled'].includes(row.failure),
          ).length,
          passed: rows.filter((row) => row.pass).length,
          failed: rows.filter((row) => !row.pass).length,
          wrongAnswers: rows.filter((row) => row.failure === 'wrong_answer').length,
          formatFailures: rows.filter((row) => row.failure === 'answer_format').length,
          budgetExhaustions: rows.filter((row) => row.budgetExhausted).length,
          inferenceFailures: rows.filter((row) => row.failure === 'inference_error').length,
          timeouts: rows.filter((row) => row.failure === 'request_timeout').length,
          meanLatencyMs: rows.length
            ? Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length)
            : null,
        },
      ];
    }),
  );
  const reasoningRows = report.results.filter((row) => row.mode === 'reasoning');
  if (
    reasoningRows.some((row) => typeof row.reasoningObserved === 'boolean') &&
    !reasoningRows.some((row) => row.reasoningObserved)
  )
    report.limitations.push(
      'The server returned no separate thinking field; request flags alone do not prove that internal reasoning was enabled.',
    );
  return report;
}
