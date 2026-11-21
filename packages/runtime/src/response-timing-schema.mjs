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
  'computer_outcome',
  'youtube_music_planning',
  'youtube_music_start',
  'youtube_music_result',
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
  'voice_text',
  'voice_queued',
  'voice_synthesis',
  'voice_audio',
  'completed',
  'failed',
  'cancelled',
]);
const computerReasons = new Set([
  'completed',
  'cancelled',
  'incomplete',
  'plan_blocked',
  'planning_failed',
  'initial_plan_invalid',
  'target_stale',
  'target_covered',
  'foreground_changed',
  'window_changed',
  'indicator_bounds_failed',
  'escape_unavailable',
  'indicator_timeout',
  'action_failed',
  'stalled',
  'limit',
  'out_of_scope',
  'invalid_arguments',
  'network',
  'loading',
  'not_applied',
  'needs_user',
  'challenge',
  'sign_in',
  'profile',
  'exact_control_clicked',
  'checkpoint_pending',
  'application_ambiguous',
  'application_not_found',
  'navigation_unverified',
  'steam_game_unverified',
  'started',
  'running',
  'unconfirmed',
  'not-installed',
  'client-unavailable',
  'unavailable',
  'no_progress',
]);
const computerPhases = new Set([
  'acting',
  'call-focus',
  'idle',
  'observing',
  'planning',
  'starting',
  'verifying',
]);
const computerFailureCodes = new Set([
  'COMPUTER_APPLICATION_UNAVAILABLE',
  'COMPUTER_BROWSER_WINDOW_UNVERIFIED',
  'COMPUTER_ESCAPE_UNAVAILABLE',
  'COMPUTER_FIELD_FOCUS_CHANGED',
  'COMPUTER_FIELD_STALE',
  'COMPUTER_FOREGROUND_CHANGED',
  'COMPUTER_FULLSCREEN_TOOLBAR',
  'COMPUTER_INDICATOR_BOUNDS_FAILED',
  'COMPUTER_INDICATOR_TIMEOUT',
  'COMPUTER_OBSERVATION_CHANGED',
  'COMPUTER_PLAN_HTTP',
  'COMPUTER_PLAN_JSON',
  'COMPUTER_PLAN_SCHEMA',
  'COMPUTER_PLAN_TIMEOUT',
  'COMPUTER_TARGET_COVERED',
  'COMPUTER_TARGET_NOT_CLICKABLE',
  'COMPUTER_TARGET_STALE',
]);
const submissionReasons = new Set([
  'maintenance',
  'sign_in',
  'voice_training',
  'model_setup',
  'speech_installation',
  'shutting_down',
  'backend_unavailable',
  'busy',
  'skill_disabled',
  'internal',
]);
const youtubeMusicActions = new Set([
  'open',
  'search',
  'play',
  'start',
  'pause',
  'resume',
  'next',
  'previous',
  'volume',
  'status',
]);
const youtubeMusicResults = new Set([
  'ready',
  'opened',
  'search_opened',
  'playing',
  'resumed',
  'paused',
  'skipped',
  'previous',
  'volume_set',
  'disabled',
  'unsupported',
  'tab_not_found',
  'ambiguous_tab',
  'no_results',
  'player_unavailable',
  'helper_unavailable',
  'browser_open_failed',
  'playback_unverified',
  'control_unavailable',
  'control_unverified',
  'error',
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
  'speechCharacters',
  'requestMs',
  'tokenMs',
  'decoderMs',
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
  if (value.stage === 'failed' && value.source === 'desktop' && submissionReasons.has(value.reason))
    result.reason = value.reason;
  if (value.stage === 'youtube_music_start' && youtubeMusicActions.has(value.action))
    result.action = value.action;
  if (value.stage === 'youtube_music_result' && youtubeMusicResults.has(value.reason))
    result.reason = value.reason;
  if (value.stage === 'computer_outcome') {
    if (computerReasons.has(value.reason)) result.reason = value.reason;
    if (computerPhases.has(value.phase)) result.phase = value.phase;
    if (computerFailureCodes.has(value.failureCode)) result.failureCode = value.failureCode;
    if (Number.isInteger(value.httpStatus) && value.httpStatus >= 400 && value.httpStatus <= 599)
      result.httpStatus = value.httpStatus;
    if (value.outlineFallback === true) result.outlineFallback = true;
    for (const key of ['steps', 'completedCheckpoints', 'remainingCheckpoints'])
      if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 100)
        result[key] = value[key];
  }
  return result;
}
