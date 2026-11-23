// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { reasoningCases } from './reasoning-cases.mjs';

const median = (values) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

/** Add only derivable counts; do not invent missing response diagnostics. */
export function decorateReasoningReport(report, cases = reasoningCases) {
  report.metadata ??= {};
  report.metadata.datasetSha256 = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
  report.metadata.nativeThinkingCapVerified = false;
  for (const row of report.results) {
    const limit = report.metadata[row.mode]?.outputTokens;
    if (Number.isSafeInteger(row.outputTokens) && Number.isSafeInteger(limit))
      row.outputTokenLimitReachedByCount = row.outputTokens >= limit;
  }
  for (const mode of ['baseline', 'reasoning']) {
    const rows = report.results.filter((row) => row.mode === mode);
    report.summary[mode].medianLatencyMs = median(rows.map((row) => row.latencyMs));
    report.summary[mode].tokenLimitReachedByCount = rows.filter(
      (row) => row.outputTokenLimitReachedByCount,
    ).length;
  }
  for (const [name, field] of [
    ['byCategory', 'category'],
    ['byLanguage', 'language'],
  ])
    report[name] = Object.fromEntries(
      [...new Set(cases.map((row) => row[field]))].map((group) => [
        group,
        Object.fromEntries(
          ['baseline', 'reasoning'].map((mode) => {
            const rows = report.results.filter((row) => row.mode === mode && row[field] === group);
            return [
              mode,
              {
                attempted: rows.length,
                verified: rows.filter((row) => row.pass).length,
                wrongAnswer: rows.filter((row) => row.failure === 'wrong_answer').length,
                formatUnverified: rows.filter((row) => row.failure === 'answer_format').length,
              },
            ];
          }),
        ),
      ]),
    );
  const message =
    'A separate hard limit on hidden thinking was not verified. Total generation is bounded, but the model may use the budget without a valid final answer. A format failure is not proof of a mathematically wrong answer.';
  if (!report.limitations.includes(message)) report.limitations.push(message);
  report.metricAvailability = {
    visibleCharacters: report.results.every((row) => Number.isSafeInteger(row.visibleCharacters)),
    reasoningCharacters: report.results.every((row) =>
      Number.isSafeInteger(row.reasoningCharacters),
    ),
    doneReason: report.results.every((row) => typeof row.doneReason === 'string'),
    note: 'Missing diagnostics were not retroactively fabricated. Output-token limit flags are derived from recorded token counts and requested limits.',
  };
  return report;
}

const escape = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
const seconds = (value) => `${(value / 1000).toFixed(value < 1000 ? 2 : 1)} s`;
const status = (row) =>
  !row
    ? ['pending', 'Not attempted']
    : row.pass
      ? ['pass', 'Verified']
      : row.failure === 'wrong_answer'
        ? ['wrong', 'Wrong answer']
        : row.failure === 'answer_format'
          ? ['unknown', 'Final format unverified']
          : ['unknown', 'Not verified'];

/** Standalone report: public questions and numeric results only, never generated answer/CoT text. */
export function reasoningReportHtml(report, cases = reasoningCases) {
  const rowHtml = cases
    .map((value) => {
      const cells = ['baseline', 'reasoning']
        .map((mode) => {
          const row = report.results.find((item) => item.caseId === value.id && item.mode === mode);
          const [kind, label] = status(row);
          return `<td><span class="badge ${kind}">${label}</span><small>${row ? seconds(row.latencyMs) : '—'}${row?.outputTokenLimitReachedByCount ? ' · token limit reached' : ''}</small></td>`;
        })
        .join('');
      return `<tr><td>${escape(value.language.toUpperCase())}</td><td>${escape(value.category)}</td><td><details><summary>${escape(value.id)}</summary><p lang="${escape(value.language)}">${escape(value.prompt)}</p></details></td>${cells}</tr>`;
    })
    .join('\n');
  const categoryRows = Object.entries(report.byCategory ?? {})
    .map(
      ([name, data]) =>
        `<tr><td>${escape(name)}</td><td>${data.baseline.verified}/${data.baseline.attempted}</td><td>${data.reasoning.verified}/${data.reasoning.attempted}</td></tr>`,
    )
    .join('');
  const cards = ['baseline', 'reasoning']
    .map((mode) => {
      const summary = report.summary[mode];
      return `<article><h2>${mode === 'baseline' ? 'Baseline · think: false' : 'Reasoning · think: true'}</h2><strong>${summary.passed} / ${summary.completed}</strong><p>verified final answers</p><small>${summary.wrongAnswers} wrong · ${summary.formatFailures} format-unverified<br>Median ${seconds(summary.medianLatencyMs)} · mean ${seconds(summary.meanLatencyMs)}</small></article>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capri reasoning evaluation</title><style>
  :root{color-scheme:dark;font-family:system-ui,sans-serif;background:#091319;color:#d6e7eb}body{max-width:1100px;margin:36px auto;padding:0 22px;line-height:1.55}h1,h2,p{margin:0 0 12px}h1{font-size:28px}h2{font-size:17px;color:#8ce1e1}small{display:block;color:#9bb2bc}.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:22px 0}article{padding:20px;border:1px solid #34616a;border-radius:10px;background:#10232c}strong{font-size:42px}.notice{padding:16px;border-left:3px solid #edc56b;background:#2b281e;color:#efe2ba;margin:20px 0}.table{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th,td{padding:12px 9px;vertical-align:top;border-bottom:1px solid #25404b}th{color:#9ec1ca}td:first-child{text-transform:uppercase}.badge{display:inline-block;white-space:nowrap;font-size:12px;padding:3px 7px;border:1px solid;border-radius:5px}.pass{color:#9ce7bb;background:#153428}.wrong{color:#f0adb0;background:#392329}.unknown{color:#f1d69b;background:#352d20}summary{cursor:pointer}details p{max-width:500px;font-size:14px;margin-top:10px;color:#b9cdd3}.meta{font-size:13px;color:#a2b9c2}li{margin:8px 0}footer{margin-top:28px;border-top:1px solid #25404b;padding-top:15px;font-size:13px;color:#9bb2bc}@media(max-width:650px){body{padding:0 12px;margin:22px auto}.cards{grid-template-columns:1fr}th,td{padding:9px 7px}}
  </style><h1>Capri reasoning evaluation</h1><p>${escape(report.requestedModel)} · ${cases.length} public questions · ${new Set(cases.map((row) => row.language)).size} languages · matched baseline/reasoning pairs</p><p class="meta">Completed: ${report.completed ? 'yes' : 'no'} · ${escape(report.startedAt)} — ${escape(report.finishedAt)}</p><section class="cards">${cards}</section>
  <div class="notice">This is a small single-pass test, not a general accuracy estimate. “Final format unverified” means that the checker could not verify a valid short JSON answer; it does not establish a mathematically wrong answer. Hidden reasoning and generated answers are not saved.</div>
  <h2>Verified answers by category</h2><table><thead><tr><th>Category</th><th>Baseline</th><th>Reasoning</th></tr></thead><tbody>${categoryRows}</tbody></table><h2 style="margin-top:24px">All questions</h2><p class="meta">Expand a question to read its public test prompt. No model answer or private reasoning is included.</p><div class="table"><table><thead><tr><th>Language</th><th>Category</th><th>Question</th><th>Baseline</th><th>Reasoning</th></tr></thead><tbody>${rowHtml}</tbody></table></div>
  <h2 style="margin-top:24px">Conditions and limits</h2><p class="meta">Context ${escape(report.metadata?.contextTokens)} tokens · temperature ${escape(report.metadata?.temperature)} · baseline ${escape(report.metadata?.baseline?.outputTokens)} generation tokens · reasoning ${escape(report.metadata?.reasoning?.outputTokens)} generation tokens. Reasoning also receives a careful-check instruction. Order alternates between pairs.</p><ul>${report.limitations.map((text) => `<li>${escape(text)}</li>`).join('')}</ul><footer>No user history, API keys, personal prompts or PC inventory are included. Model responses were sent only to an explicitly selected local server. <a href="report.json">Machine-readable report</a></footer></html>`;
}
