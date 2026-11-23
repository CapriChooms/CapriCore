// SPDX-License-Identifier: GPL-3.0-only
// Explicit, already-running local model only. No downloads or model unloads.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { reasoningCases } from './reasoning-cases.mjs';
import { runReasoningEvaluation } from './reasoning-evaluation.mjs';
import { createReasoningOllamaAdapter } from './reasoning-ollama-adapter.mjs';
import { decorateReasoningReport, reasoningReportHtml } from './reasoning-report.mjs';

const args = process.argv.slice(2);
const known = new Set([
  '--url',
  '--model',
  '--limit',
  '--context-tokens',
  '--reasoning-tokens',
  '--request-timeout-ms',
  '--overall-timeout-ms',
]);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!known.has(args[index]) || !args[index + 1] || Object.hasOwn(options, args[index]))
    throw new Error('Use explicit --url and --model, with optional documented evaluation budgets.');
  options[args[index]] = args[index + 1];
}
if (!options['--url'] || !options['--model'])
  throw new Error('An explicit --url http://127.0.0.1:PORT and --model MODEL are required.');
const limit = Number(options['--limit'] ?? 18);
if (![12, 18].includes(limit))
  throw new Error('Use --limit 12 or --limit 18 for a balanced sample.');
const shortIndices = new Set([0, 1, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15]);
const cases =
  limit === 18 ? reasoningCases : reasoningCases.filter((_, index) => shortIndices.has(index));
const contextTokens = Number(options['--context-tokens'] ?? 8192);
const reasoningTokens = Number(options['--reasoning-tokens'] ?? 4096);
const requestTimeoutMs = Number(options['--request-timeout-ms'] ?? 120000);
const overallTimeoutMs = Number(options['--overall-timeout-ms'] ?? 1200000);
const infer = createReasoningOllamaAdapter({
  url: options['--url'],
  contextTokens,
  reasoningTokens,
});
const parent = path.join(root, '.runtime/reasoning-evaluation');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const file = path.join(folder, 'report.json');
const controller = new AbortController();
const stop = () => controller.abort(new DOMException('Evaluation cancelled', 'AbortError'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const metadata = {
  adapter: 'ollama-api-chat',
  contextTokens,
  temperature: 0,
  seed: 73421,
  baseline: { think: false, outputTokens: 768 },
  reasoning: { think: true, outputTokens: reasoningTokens, carefulCheckInstruction: true },
  requestTimeoutMs,
  overallTimeoutMs,
  credentialsRead: false,
  ownerDataRead: false,
  modelDownloads: false,
};
const partial = { schemaVersion: 1, completed: false, metadata, results: [] };
writeFileSync(file, JSON.stringify(partial, null, 2) + '\n');
console.log(JSON.stringify({ started: true, questionCount: cases.length, folder }));
try {
  const report = await runReasoningEvaluation({
    infer,
    model: options['--model'],
    cases,
    requestTimeoutMs,
    overallTimeoutMs,
    signal: controller.signal,
    onResult: (result) => {
      partial.results.push(result);
      writeFileSync(file, JSON.stringify(partial, null, 2) + '\n');
      console.log(JSON.stringify(result));
    },
  });
  report.metadata = metadata;
  report.limitations.push(
    'Reasoning mode uses a larger token budget and an extra checking instruction; this measures the proposed product modes, not only the think switch.',
  );
  report.limitations.push(
    'The total generation token limit is bounded. A separate hard limit on hidden thinking is not verified; a model may exhaust generation or fail to provide a valid final answer.',
  );
  decorateReasoningReport(report, cases);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(folder, 'RESULTS.html'), reasoningReportHtml(report, cases));
  console.log(JSON.stringify({ completed: report.completed, summary: report.summary, folder }));
  if (!report.completed) process.exitCode = 2;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
