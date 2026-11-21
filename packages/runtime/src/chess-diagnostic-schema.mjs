// SPDX-License-Identifier: GPL-3.0-only
import { timingId } from './response-timing-schema.mjs';

const operations = new Set([
  'scan',
  'analyse',
  'watch',
  'install',
  'remove',
  'command',
  'ui',
  'reaction',
]);
const stages = new Set([
  'started',
  'captured',
  'access',
  'candidate',
  'bound',
  'recognition',
  'search',
  'result',
  'overlay',
  'progress',
  'decision',
  'paused',
  'resumed',
  'completed',
  'cancelled',
  'failed',
]);
const strings = {
  reactionEvent: new Set(['start', 'capture', 'check', 'mate', 'draw', 'castle', 'promotion']),
  source: new Set(['display', 'window', 'local', 'tracked']),
  provider: new Set(['chess-com', 'lichess', 'other']),
  browserProbe: new Set([
    'window_unavailable',
    'browser_unsupported',
    'browser_controls_unavailable',
    'browser_window_changed',
    'address_control_unavailable',
    'address_unavailable',
    'document_mismatch',
  ]),
  moveProbe: new Set([
    'target_changed',
    'target_obscured',
    'input_in_use',
    'input_rejected',
    'pointer_changed',
  ]),
  mode: new Set(['manual', 'automatic', 'normal', 'deep']),
  orientation: new Set(['white', 'black']),
  turn: new Set(['w', 'b']),
  phase: new Set(['idle', 'downloading', 'checking', 'ready', 'failed']),
  command: new Set([
    'install',
    'remove',
    'scan',
    'import',
    'analyse',
    'watch',
    'stop',
    'cancel',
    'auto-move',
    'explain',
  ]),
  reason: new Set([
    'selection_cancelled',
    'no_board',
    'no_browser_view',
    'route_rejected',
    'route_allowed',
    'game_already_verified',
    'game_allowed',
    'game_rejected',
    'game_lookup_failed',
    'inspection_error',
    'window_disappeared',
    'view_changed',
    'view_rebound',
    'display_changed',
    'overlay_failed',
    'board_not_found',
    'board_ambiguous',
    'board_relocated',
    'position_recovered',
    'position_changed',
    'new_game',
    'expired',
    'stopped',
    'skill_disabled',
    'invalid_request',
    'already_installed',
    'invalid_engine',
    'search_failed',
    'terminal_position',
    'awaiting_turn',
    'tracking_unavailable',
    'stockfish_missing',
    'settings_hidden',
    'local_move_offered',
    'local_move_applied',
    'local_move_skipped',
    'local_board_opened',
    'auto_move_promotion',
    'auto_move_board_changed',
    'auto_move_blocked',
    'auto_move_sent',
    'auto_move_pressed',
    'auto_move_uncertain',
    'auto_move_confirmed',
    'reaction_queued',
    'reaction_expired',
    'reaction_empty',
    'reaction_too_long',
    'reaction_duplicate',
    'reaction_generated',
    'reaction_delivered',
    'reaction_unverified',
  ]),
  exception: new Set([
    'Error',
    'AbortError',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'TimeoutError',
  ]),
  errorCode: new Set([
    'EPERM',
    'EACCES',
    'EBUSY',
    'ENOENT',
    'ENOSPC',
    'EIO',
    'EINVAL',
    'EEXIST',
    'EPIPE',
    'ABORT_ERR',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
  ]),
};
const numbers = [
  'elapsedMs',
  'captureMs',
  'recognitionMs',
  'verifyMs',
  'searchMs',
  'firstMoveMs',
  'probes',
  'recognitionPasses',
  'boardIndex',
  'candidates',
  'width',
  'height',
  'minConfidence',
  'meanConfidence',
  'uncertainSquares',
  'markedSquares',
  'ply',
  'historyPlies',
  'lines',
  'depth',
  'frames',
  'misses',
  'matches',
  'changes',
  'received',
  'total',
  'httpStatus',
  'attempt',
];
const flags = [
  'localized',
  'manual',
  'watchable',
  'reliable',
  'inView',
  'autoMove',
  'playRequested',
  'corrected',
  'waiting',
  'terminal',
  'bestMove',
  'applied',
  'installed',
  'supported',
  'cold',
  'visible',
  'cancelled',
];

/** Fixed diagnostic fields only. Never pass board data, addresses, handles or raw exceptions through. */
export function chessDiagnosticRecord(value) {
  if (
    value?.event !== 'chess-diagnostic' ||
    !timingId(value.traceId) ||
    !operations.has(value.operation) ||
    !stages.has(value.stage)
  )
    return undefined;
  const result = {
    schemaVersion: 1,
    event: 'chess-diagnostic',
    traceId: value.traceId,
    operation: value.operation,
    stage: value.stage,
  };
  if (timingId(value.scanId)) result.scanId = value.scanId;
  if (
    typeof value.time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.time)
  )
    result.time = value.time;
  if (typeof value.version === 'string' && /^\d{1,3}(?:\.\d{1,3}){0,2}$/.test(value.version))
    result.version = value.version;
  for (const [key, values] of Object.entries(strings))
    if (values.has(value[key])) result[key] = value[key];
  for (const key of numbers)
    if (Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1e12)
      result[key] = Math.round(value[key] * 1000) / 1000;
  for (const key of flags) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}
