// SPDX-License-Identifier: GPL-3.0-only
import { privateLogRecord } from '../../../packages/runtime/src/privacy-log.mjs';

const PRIVATE_FIELD =
  /(?:prompt|transcript|utterance|messages|history|personality|content|goal|query|parameters|arguments|clipboard|windowTitle|caption|fileName|filePath|executable|url|token|secret|password|headers|environment|recording|screenshot|image|audioData|text)/i;
const STATES = new Set([
  'encrypted',
  'incomplete',
  'needs_user',
  'stalled',
  'limit',
  'observing',
  'acting',
  'planning',
  'recovering',
  'directory-inheritance',
  'contents',
  'links-not-followed',
  'supported',
  'unsupported',
  'efs-unavailable',
  'idle',
  'off',
  'on',
  'enabled',
  'disabled',
  'active',
  'inactive',
  'available',
  'unavailable',
  'ready',
  'loading',
  'starting',
  'started',
  'stopping',
  'stopped',
  'sleeping',
  'asleep',
  'connecting',
  'connected',
  'disconnected',
  'disconnecting',
  'listening',
  'recording',
  'thinking',
  'speaking',
  'streaming',
  'complete',
  'completed',
  'cancelled',
  'interrupted',
  'pending',
  'waiting',
  'checking',
  'preparing',
  'downloading',
  'installing',
  'verifying',
  'error',
  'failed',
  'failure',
  'warning',
  'timeout',
  'unknown',
  'fallback',
  'catalog',
  'model',
  'voice',
  'recognition',
  'startup',
  'response',
  'request',
  'synthesis',
  'decode',
  'playback',
  'capture',
  'microphone',
  'system',
  'both',
  'remote',
  'local',
  'external-api',
  'cpu',
  'cuda',
  'rocm',
  'directml',
  'vulkan',
  'gpu',
  'partial',
  'float16',
  'float32',
  'bfloat16',
  'auto',
  'int8',
  'q8_0',
  'q4_0',
  'vision',
  'tools',
  'text',
  'stream',
  'buffered',
  'pcm',
  'wav',
  'f32le',
  'voice-runtime',
  'request-router',
  'multilingual',
  'chatterbox-turbo',
  'chatterbox-multilingual',
  'qwen3-tts',
  'native',
  'wgc',
  'dxgi',
  'wasapi',
]);
const ERRORS = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'ImportError',
  'ModuleNotFoundError',
  'RuntimeError',
  'ValueError',
  'OSError',
  'MemoryError',
  'TimeoutError',
  'AbortError',
]);
// Host-defined control vocabulary only. Never admit arbitrary target labels,
// destinations, message text or model-provided prose under these field names.
const CONTROL_VALUES = {
  action: new Set([
    'observe',
    'launch',
    'open_url',
    'browser_search',
    'focus_window',
    'click',
    'enter_text',
    'press_keys',
    'drag',
    'scroll',
    'wait',
    'finish',
    'ask_user',
    'discord_task',
    'steam_launch',
    'navigate',
    'join_voice',
    'leave_voice',
    'list_channels',
    'read_context',
    'send_message',
    'send_current_message',
  ]),
  outcome: new Set([
    'applied',
    'not_applied',
    'invalid_arguments',
    'preflight_rejected',
    'discord_dispatched',
    'discord_structured_step_required',
    'pending_navigation_not_replayed',
    'verified',
    'unverified',
  ]),
  reason: new Set([
    'COMPUTER_APPLICATION_UNAVAILABLE',
    'COMPUTER_BROWSER_WINDOW_UNVERIFIED',
    'COMPUTER_FIELD_FOCUS_CHANGED',
    'COMPUTER_FIELD_STALE',
    'COMPUTER_FOREGROUND_CHANGED',
    'COMPUTER_INPUT_BUSY',
    'COMPUTER_OBSERVATION_CHANGED',
    'COMPUTER_TARGET_COVERED',
    'completed',
    'cancelled',
    'incomplete',
    'stalled',
    'limit',
    'clarify',
    'needs_user',
    'invalid_arguments',
    'not_applied',
    'target_covered',
    'window_changed',
    'planning_failed',
    'action_failed',
    'discord_unverified',
    'discord_action_unverified',
    'discord_control_unresolved',
    'discord_current_composer_unavailable',
    'discord_current_composer_scan_incomplete',
    'discord_current_scope_unavailable',
    'discord_current_observation_truncated',
    'discord_current_composer_ambiguous',
    'discord_current_scope_changed',
    'discord_current_submission_unverified',
    'discord_current_draft_changed',
    'discord_current_draft_present',
    'discord_structured_step_required',
    'discord_completion_unverified',
    'steam_game_unverified',
    'plan_blocked',
    'owner_cancelled',
    'session_revoked',
    'timeout',
    'step_limit',
  ]),
};

export function isDiagnosticControlValue(key, value) {
  return (
    typeof value === 'string' &&
    Object.hasOwn(CONTROL_VALUES, key) &&
    CONTROL_VALUES[key].has(value)
  );
}

/** Diagnostics are technical state, never an extensible arbitrary-text dump. */
export function diagnosticState(value, key = '', depth = 0) {
  if (depth > 12) return '[DEPTH LIMIT]';
  if (
    PRIVATE_FIELD.test(key) &&
    !(typeof value === 'number' && /(?:Tokens|Bytes|Count|Ms)$/i.test(key))
  )
    return '[PRIVATE DATA OMITTED]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (STATES.has(value) || ERRORS.has(value)) return value;
    if (isDiagnosticControlValue(key, value)) return value;
    if (
      /^(?:code|startupStage|failureCode|errorCode|lastFailureCode)$/.test(key) &&
      /^(?:ASR_|VOICE_|CAPRI_|COMPUTER_|UND_ERR_|ERR_|E[A-Z]{3,})[A-Z0-9_]{0,72}$/.test(value)
    )
      return value;
    if (
      /^(?:language|interface|conversation|speech)$/.test(key) &&
      /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)
    )
      return value;
    const record = privateLogRecord(value);
    if (record.code || record.exception || record.httpStatus) return record;
    return '[PRIVATE TEXT OMITTED]';
  }
  if (Array.isArray(value))
    return value.slice(0, 150).map((item) => diagnosticState(item, '', depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 150)
        .map(([name, item]) => [name, diagnosticState(item, name, depth + 1)]),
    );
  return undefined;
}
