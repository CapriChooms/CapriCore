// SPDX-License-Identifier: GPL-3.0-only
import { responseTimingRecord } from '../../../packages/runtime/src/response-timing-schema.mjs';

const timestamp = (record) => Date.parse(record?.time);
const duration = (start, end) => {
  if (!start || !end) return null;
  const value =
    start.source === end.source &&
    Number.isFinite(start.elapsedMs) &&
    Number.isFinite(end.elapsedMs)
      ? end.elapsedMs - start.elapsedMs
      : timestamp(end) - timestamp(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const phases = [
  ['dispatch', 'received', 'chat_started'],
  ['model', 'model_start', 'model_ready'],
  ['routing', 'routing_start', 'routing_ready'],
  ['intent', 'intent_start', 'intent_ready'],
  ['context', 'context_start', 'context_ready'],
  ['gateway', 'gateway_dispatch', 'gateway_first_token'],
  ['stream', 'first_delta', 'completed'],
  ['voice', 'first_delta', 'voice_audio'],
];

/** Join by explicit correlation IDs only. Process elapsed clocks are never mixed. */
export function responseTimelines(input, { maximum = 40 } = {}) {
  const groups = new Map(),
    seen = new Set();
  for (const value of input) {
    const row = responseTimingRecord(value);
    if (!row || !Number.isFinite(timestamp(row))) continue;
    const key = [row.traceId, row.requestId, row.source, row.stage, row.time, row.elapsedMs].join(
      ':',
    );
    if (seen.has(key)) continue;
    seen.add(key);
    if (!groups.has(row.traceId)) groups.set(row.traceId, []);
    groups.get(row.traceId).push(row);
  }
  return [...groups]
    .map(([id, records]) => {
      records.sort((a, b) => timestamp(a) - timestamp(b));
      const desktop = records.filter((r) => r.source === 'desktop');
      const first = (stage) => desktop.find((r) => r.stage === stage);
      const origin = first('received') ?? records[0];
      const terminal = desktop.findLast((r) =>
        ['completed', 'failed', 'cancelled'].includes(r.stage),
      );
      const requests = new Map();
      for (const record of records.filter((r) => r.source === 'provider' && r.requestId)) {
        if (!requests.has(record.requestId)) requests.set(record.requestId, []);
        requests.get(record.requestId).push(record);
      }
      const calls = [...requests].map(([requestId, rows]) => {
        const start = rows.find((r) => r.stage === 'provider_request'),
          end = rows.findLast((r) => r.stage === 'provider_finished');
        return {
          id: requestId,
          modelId: start?.modelId ?? null,
          streaming: start?.streaming,
          firstTokenMs: duration(
            start,
            rows.find((r) => r.stage === 'provider_first_token'),
          ),
          firstContentMs: duration(
            start,
            rows.find((r) => r.stage === 'provider_first_content'),
          ),
          wallMs: duration(start, end),
          loadMs: end?.loadMs ?? null,
          promptEvalMs: end?.promptEvalMs ?? null,
          evalMs: end?.evalMs ?? null,
          promptTokens: end?.promptTokens ?? null,
          outputTokens: end?.outputTokens ?? null,
          tokensPerSecond:
            end?.evalMs > 0 && Number.isFinite(end.outputTokens)
              ? (end.outputTokens * 1000) / end.evalMs
              : null,
          failed: rows.some((r) => r.stage === 'provider_failed'),
        };
      });
      return {
        id,
        time: origin.time,
        lastTime: records.at(-1).time,
        status: terminal?.stage ?? 'incomplete',
        linked: Boolean(first('received')),
        modelId: records.find((r) => r.modelId)?.modelId ?? null,
        firstTextMs: duration(origin, first('first_delta')),
        firstPaintMs: duration(
          origin,
          records.find((r) => r.stage === 'first_paint'),
        ),
        totalMs: duration(origin, terminal),
        phases: phases.map(([id, start, end]) => ({
          id,
          durationMs: duration(first(start), id === 'stream' ? terminal : first(end)),
        })),
        calls,
        events: records.slice(-200).map((row) => ({
          ...row,
          sinceStartMs: duration(origin, row),
        })),
      };
    })
    .sort((a, b) => Date.parse(b.lastTime) - Date.parse(a.lastTime))
    .slice(0, maximum);
}
