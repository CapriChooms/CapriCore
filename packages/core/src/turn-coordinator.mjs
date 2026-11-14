// SPDX-License-Identifier: GPL-3.0-only
export const TURN_HANDLED = Symbol('turn handled');

// A host sets the precedence of handlers within a phase. The core keeps phase
// order and controls which phases may claim ownership of the turn.
const phases = [
  ['direct', true],
  ['approval', true],
  ['model', false],
  ['classification', false],
  ['intent', true],
  ['executor', true],
  ['context', false],
];

/** Return the exclusive stage that completed this turn, or null for dialogue. */
export function coordinateTurn(handlers, signal) {
  const stages = [];
  for (const [phase, exclusive] of phases) {
    for (const [id, run] of handlers[phase] ?? []) if (run) stages.push({ id, run, exclusive });
  }
  function runFrom(first) {
    for (let index = first; index < stages.length; index++) {
      signal.throwIfAborted();
      const { id, run, exclusive } = stages[index];
      const result = run();
      if (result?.then)
        return Promise.resolve(result).then((outcome) =>
          outcome === TURN_HANDLED ? finish(id, exclusive) : runFrom(index + 1),
        );
      if (result === TURN_HANDLED) return finish(id, exclusive);
    }
    signal.throwIfAborted();
    return null;
  }
  return runFrom(0);
}

function finish(stage, exclusive) {
  if (!exclusive) throw new Error('A preparation stage cannot complete a turn.');
  return stage;
}
