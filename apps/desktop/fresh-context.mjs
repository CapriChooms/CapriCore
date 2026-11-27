// SPDX-License-Identifier: GPL-3.0-only
/**
 * Fresh context mode: every question starts from an empty conversation.
 *
 * For a companion used as a task assistant (look this up, check that), earlier
 * turns only cost context tokens and let old answers leak into new ones. With
 * the mode on, the gateway session is reset before each turn and no earlier
 * chat messages are added to the request, so the model sees only the system
 * prompt, the persona and the current question. The visible chat history,
 * long-term memory files and settings are left alone.
 */

/** The earlier messages a turn may draw on: none in fresh context mode. */
export function turnHistory(fresh, snapshot) {
  return fresh === true ? [] : snapshot;
}

/**
 * Resets the conversation before a turn when the mode is on.
 * Returns 'off', 'reset' or 'failed'. A failed reset never blocks the turn:
 * the question is still answered, with whatever context the session holds.
 */
export async function prepareFreshTurn({ enabled, reset, onFailure = () => {} }) {
  if (typeof enabled !== 'function' || typeof reset !== 'function')
    throw new TypeError('prepareFreshTurn needs enabled and reset functions.');
  if (enabled() !== true) return 'off';
  try {
    await reset();
    return 'reset';
  } catch (error) {
    onFailure(error);
    return 'failed';
  }
}
