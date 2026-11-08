// SPDX-License-Identifier: GPL-3.0-only
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) =>
  typeof value === 'string' &&
  value.trim().length > 1 &&
  value.length <= limit &&
  !/[\x00-\x1f\x7f`{}]/u.test(value);
const checkpoint = (value) =>
  plainObject(value) &&
  Object.keys(value).every((key) => ['id', 'label', 'successCriterion'].includes(key)) &&
  typeof value.id === 'string' &&
  /^[a-z0-9_-]{1,32}$/iu.test(value.id) &&
  text(value.label, 120) &&
  text(value.successCriterion, 180);
const evidenceText = (value) =>
  typeof value === 'string' &&
  value.trim().length > 1 &&
  value.length <= 240 &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Task-local notes only. No checkpoint is executable or grants permission; the
// host still validates every action and the final observed completion evidence.
export class ComputerTaskPlan {
  #completed = [];
  #remaining = [];
  #revision = 0;
  #recoveryAttempts = 0;
  #signal;
  #limits;

  constructor({ signal, maxCheckpoints = 8, maxRevisions = 8, maxRecoveryAttempts = 3 } = {}) {
    for (const [value, maximum] of [
      [maxCheckpoints, 12],
      [maxRevisions, 12],
      [maxRecoveryAttempts, 5],
    ])
      if (!Number.isInteger(value) || value < 1 || value > maximum)
        throw new RangeError('Task plan limits must be small positive integers.');
    this.#signal = signal;
    this.#limits = { maxCheckpoints, maxRevisions, maxRecoveryAttempts };
  }

  // Both metadata fields arrive alongside the ordinary next action, without an
  // extra model request. Invalid replies leave the previous plan untouched.
  update(reply, { observation, evidenceExists } = {}) {
    this.#signal?.throwIfAborted();
    if (!plainObject(reply)) return 'Task plan metadata must accompany an action object.';
    const { plan, verifiedCheckpoints = [] } = reply;
    const { maxCheckpoints, maxRevisions } = this.#limits;
    if (
      plan !== undefined &&
      (!Array.isArray(plan) ||
        plan.length > maxCheckpoints ||
        (!this.#revision && !plan.length) ||
        plan.some((entry) => !checkpoint(entry)) ||
        new Set(plan.map((entry) => entry.id)).size !== plan.length)
    )
      return 'Use at most eight checkpoints with unique IDs, short labels and observable successCriterion text.';
    if (
      !Array.isArray(verifiedCheckpoints) ||
      verifiedCheckpoints.length > maxCheckpoints ||
      new Set(verifiedCheckpoints.map((entry) => entry?.id)).size !== verifiedCheckpoints.length
    )
      return 'Verified checkpoints must be a short list of distinct IDs and current evidence.';

    const known = [...this.#completed, ...this.#remaining];
    const completed = [...this.#completed];
    for (const proof of verifiedCheckpoints) {
      if (
        !plainObject(proof) ||
        Object.keys(proof).some((key) => !['id', 'evidence'].includes(key)) ||
        !known.some((entry) => entry.id === proof.id) ||
        !evidenceText(proof.evidence) ||
        !plainObject(observation) ||
        typeof evidenceExists !== 'function' ||
        !evidenceExists(observation, proof.evidence)
      )
        return 'Verify only an existing checkpoint using exact evidence from the current observation.';
      if (!completed.some((entry) => entry.id === proof.id))
        completed.push(known.find((entry) => entry.id === proof.id));
    }
    const remaining = this.#remaining.filter(
      (entry) => !completed.some((done) => done.id === entry.id),
    );
    if (
      plan?.some((entry) => {
        const done = completed.find((value) => value.id === entry.id);
        return (
          done && (done.label !== entry.label || done.successCriterion !== entry.successCriterion)
        );
      })
    )
      return 'Completed checkpoint IDs cannot be reused for changed labels or success criteria.';
    const next = (plan ?? remaining)
      .filter((entry) => !completed.some((done) => done.id === entry.id))
      .map(({ id, label, successCriterion }) => ({ id, label, successCriterion }));
    if (completed.length + next.length > maxCheckpoints)
      return 'Keep the completed and remaining checkpoints within the task plan limit.';
    const revised = plan !== undefined && !same(next, remaining);
    if (revised && this.#revision >= maxRevisions)
      return 'Task plan revision limit reached; request owner help instead of another recovery loop.';
    this.#completed = completed;
    this.#remaining = next;
    if (revised) this.#revision++;
    return null;
  }

  // A delivered input is only an attempt. Failures/no visible progress request
  // revision on the next normal decision; revisions never reset this budget.
  recordOutcome({ ok, changed = true, blocked = false } = {}) {
    this.#signal?.throwIfAborted();
    this.#recoveryAttempts =
      ok === true && changed === true && blocked === false
        ? 0
        : Math.min(this.#recoveryAttempts + 1, this.#limits.maxRecoveryAttempts);
    return this.context();
  }

  context() {
    return {
      revision: this.#revision,
      completedCheckpoints: this.#completed.map((entry) => ({ ...entry })),
      remainingCheckpoints: this.#remaining.map((entry) => ({ ...entry })),
      needsRevision: this.#recoveryAttempts > 0,
      recoveryAttempts: this.#recoveryAttempts,
      exhausted: this.#recoveryAttempts >= this.#limits.maxRecoveryAttempts,
    };
  }

  // Safe for diagnostic traces: never return labels, criteria or UI evidence.
  diagnostics() {
    return {
      revision: this.#revision,
      completed: this.#completed.length,
      remaining: this.#remaining.length,
      recoveryAttempts: this.#recoveryAttempts,
    };
  }
}
