// SPDX-License-Identifier: GPL-3.0-only
import { diagnosticModelId } from './technical-model-id.mjs';
const stages = new Set([
  'received',
  'chat_started',
  'model_start',
  'model_ready',
  'routing_start',
  'routing_ready',
  'intent_start',
  'intent_ready',
  'context_start',
  'context_ready',
  'gateway_dispatch',
  'gateway_received',
  'gateway_first_delta',
  'gateway_finished',
  'provider_request',
  'provider_headers',
  'provider_first_token',
  'provider_first_content',
  'provider_finished',
  'provider_failed',
  'gateway_headers',
  'gateway_first_token',
  'first_delta',
  'first_paint',
  'completed',
  'failed',
  'cancelled',
]);
const counters = new Set([
  'contextShift',
  'truncate',
  'toolCount',
  'toolSchemaCharacters',
  'reasoningCharactersBeforeText',
  'threadCount',
  'batchSize',
  'gpuLayers',
  'predictTokens',
  'thinking',
  'linked',
  'availableRamBytes',
  'residentBytes',
  'residentGpuBytes',
  'residentContextTokens',
  'elapsedMs',
  'durationMs',
  'inputCharacters',
  'systemCharacters',
  'contextCharacters',
  'historyMessages',
  'messageCount',
  'payloadBytes',
  'outputCharacters',
  'contextTokens',
  'promptTokens',
  'outputTokens',
  'loadMs',
  'promptEvalMs',
  'evalMs',
  'totalMs',
  'rendererElapsedMs',
  'cold',
  'streaming',
  'status',
]);
export const timingId = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9-]{36}$/i.test(value) &&
  value
    .split('-')
    .map((x) => x.length)
    .join() === '8,4,4,4,12';

/** This is an explicit technical schema, never a generic object or prose logger. */
export function responseTimingRecord(value) {
  if (
    !value ||
    value.event !== 'response-timing' ||
    !timingId(value.traceId) ||
    !['desktop', 'gateway', 'provider', 'renderer'].includes(value.source) ||
    !stages.has(value.stage)
  )
    return undefined;
  const result = {
    schemaVersion: 1,
    event: 'response-timing',
    traceId: value.traceId,
    source: value.source,
    stage: value.stage,
  };
  if (timingId(value.requestId)) result.requestId = value.requestId;
  const modelId = diagnosticModelId(value.modelId);
  if (modelId) result.modelId = modelId;
  if (
    typeof value.time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.time)
  )
    result.time = value.time;
  for (const key of counters)
    if (Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1e12)
      result[key] = Math.round(value[key] * 1000) / 1000;
  return result;
}
