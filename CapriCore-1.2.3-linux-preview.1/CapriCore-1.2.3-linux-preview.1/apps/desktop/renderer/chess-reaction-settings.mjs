// SPDX-License-Identifier: GPL-3.0-only
export const CHESS_REACTION_EVENTS = Object.freeze({
  start: 'Game start',
  capture: 'Piece captures',
  check: 'Check',
  mate: 'Checkmate',
  draw: 'Draws and stalemate',
  castle: 'Castling',
  promotion: 'Pawn promotion',
});

export const CHESS_REACTION_DEFAULTS = Object.freeze({
  enabled: false,
  spoken: true,
  events: Object.freeze(
    Object.fromEntries(Object.keys(CHESS_REACTION_EVENTS).map((key) => [key, true])),
  ),
});

export function chessReactionSettings(value = CHESS_REACTION_DEFAULTS) {
  const { enabled, spoken, interval, events } = value ?? {};
  const keys = Object.keys(CHESS_REACTION_EVENTS);
  if (
    typeof enabled !== 'boolean' ||
    typeof spoken !== 'boolean' ||
    (interval !== undefined && ![5, 12, 25].includes(interval)) ||
    !events ||
    keys.some((key) => typeof events[key] !== 'boolean') ||
    Object.keys(events).length !== keys.length
  )
    throw new Error('Invalid chess reaction settings');
  return { enabled, spoken, events: { ...events } };
}
