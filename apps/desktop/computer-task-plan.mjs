// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';

const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) =>
  typeof value === 'string' &&
  value.trim().length > 1 &&
  value.length <= limit &&
  !/[\x00-\x1f\x7f`{}]/u.test(value);
const checkpoint = (value) =>
  plainObject(value) &&
  Object.keys(value).every((key) =>
    ['id', 'label', 'successCriterion', 'verifyOn'].includes(key),
  ) &&
  typeof value.id === 'string' &&
  /^[a-z0-9_-]{1,32}$/iu.test(value.id) &&
  text(value.label, 120) &&
  text(value.successCriterion, 180) &&
  (value.verifyOn === undefined ||
    (plainObject(value.verifyOn) &&
      Object.keys(value.verifyOn).every((key) => ['action', 'target'].includes(key)) &&
      ['open_url', 'browser_search', 'launch'].includes(value.verifyOn.action) &&
      text(value.verifyOn.target, 240)));
const evidenceText = (value) =>
  typeof value === 'string' &&
  value.trim().length > 1 &&
  value.length <= 240 &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const evidenceKey = (value) =>
  createHash('sha256')
    .update(value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase())
    .digest('hex');

// Task-local notes only. No checkpoint is executable or grants permission; the
// host still validates every action and the final observed completion evidence.
export class ComputerTaskPlan {
  #completed = [];
  #remaining = [];
  #outcome = null;
  #milestoneProofs = new Set();
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

  startOutline({ milestones, outcome }) {
    const final = {
      id: 'owner-outcome',
      label: outcome?.label,
      successCriterion: outcome?.successCriterion,
    };
    if (this.#revision || !Array.isArray(milestones) || !checkpoint(final))
      return 'An initial plan must describe the final result the owner requested.';
    const last = milestones.at(-1);
    const preparatory =
      checkpoint(last) &&
      last.label === final.label &&
      last.successCriterion === final.successCriterion
        ? milestones.slice(0, -1)
        : milestones;
    if (
      preparatory.some(
        (entry) =>
          entry?.label === final.label || entry?.successCriterion === final.successCriterion,
      )
    )
      return 'Separate preparatory work from the final result. Do not duplicate the same milestone.';
    const problem = this.update({ plan: [...preparatory, final] });
    if (!problem) this.#outcome = final;
    return problem;
  }

  readyForReview() {
    return this.#remaining.every((entry) => entry.id === this.#outcome?.id);
  }

  usedMilestoneEvidence(value) {
    return evidenceText(value) && this.#milestoneProofs.has(evidenceKey(value));
  }

  confirmObservedAction(action, matchesTarget, evidence, observation, evidenceExists) {
    const next = this.#remaining[0];
    if (
      !next ||
      next.id === this.#outcome?.id ||
      next.verifyOn?.action !== action ||
      !matchesTarget(next.verifyOn.target) ||
      !evidenceText(evidence)
    )
      return false;
    return (
      this.update(
        { verifiedCheckpoints: [{ id: next.id, evidence }] },
        { observation, evidenceExists },
      ) === null
    );
  }

  confirmOutcome(observation, evidence, evidenceExists, { newlyObserved = false } = {}) {
    this.#signal?.throwIfAborted();
    if (!this.readyForReview()) return false;
    if (this.#outcome && this.#remaining.length) {
      if (
        !evidenceExists(observation, evidence) ||
        (!newlyObserved && this.usedMilestoneEvidence(evidence))
      )
        return false;
      this.#completed.push(this.#outcome);
      this.#remaining = [];
    }
    return true;
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
    const newProofs = [];
    for (const proof of verifiedCheckpoints) {
      if (
        !plainObject(proof) ||
        Object.keys(proof).some((key) => !['id', 'evidence'].includes(key)) ||
        proof.id === this.#outcome?.id ||
        !known.some((entry) => entry.id === proof.id) ||
        !evidenceText(proof.evidence) ||
        !plainObject(observation) ||
        typeof evidenceExists !== 'function' ||
        !evidenceExists(observation, proof.evidence)
      )
        return 'Verify only an existing checkpoint using exact evidence from the current observation.';
      if (!completed.some((entry) => entry.id === proof.id)) {
        completed.push(known.find((entry) => entry.id === proof.id));
        if (this.#outcome) newProofs.push(evidenceKey(proof.evidence));
      }
    }
    const remaining = this.#remaining.filter(
      (entry) => !completed.some((done) => done.id === entry.id),
    );
    if (
      plan?.some((entry) => {
        const done = completed.find((value) => value.id === entry.id);
        return (
          done &&
          (done.label !== entry.label ||
            done.successCriterion !== entry.successCriterion ||
            (entry.verifyOn !== undefined &&
              (done.verifyOn?.action !== entry.verifyOn.action ||
                done.verifyOn?.target !== entry.verifyOn.target)))
        );
      })
    )
      return 'Completed checkpoint IDs cannot be reused for changed labels or success criteria.';
    const next = (plan ?? remaining)
      .filter((entry) => !completed.some((done) => done.id === entry.id))
      .map(({ id, label, successCriterion, verifyOn }) => ({
        id,
        label,
        successCriterion,
        ...(verifyOn && { verifyOn: { ...verifyOn } }),
      }));
    if (this.#outcome && remaining.some((entry) => entry.id === this.#outcome.id)) {
      const proposed = next.findIndex((entry) => entry.id === this.#outcome.id);
      if (proposed !== -1 && !same(next[proposed], this.#outcome))
        return 'The final owner outcome cannot be replaced during replanning.';
      if (proposed !== -1) next.splice(proposed, 1);
      next.push(this.#outcome);
    }
    if (completed.length + next.length > maxCheckpoints)
      return 'Keep the completed and remaining checkpoints within the task plan limit.';
    const revised = plan !== undefined && !same(next, remaining);
    if (revised && this.#revision >= maxRevisions)
      return 'Task plan revision limit reached; request owner help instead of another recovery loop.';
    this.#completed = completed;
    this.#remaining = next;
    for (const proof of newProofs) this.#milestoneProofs.add(proof);
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
    const copy = (entry) => ({
      ...entry,
      ...(entry.verifyOn && { verifyOn: { ...entry.verifyOn } }),
    });
    return {
      revision: this.#revision,
      ...(this.#outcome ? { outcomeId: this.#outcome.id } : {}),
      completedCheckpoints: this.#completed.map(copy),
      remainingCheckpoints: this.#remaining.map(copy),
      needsRevision: this.#recoveryAttempts > 0,
      recoveryAttempts: this.#recoveryAttempts,
      exhausted: this.#recoveryAttempts >= this.#limits.maxRecoveryAttempts,
    };
  }

  // Ephemeral on-screen view, never persisted in diagnostic traces.
  view() {
    return {
      revision: this.#revision,
      replanning: this.#recoveryAttempts > 0,
      steps: [
        ...this.#completed.map(({ id, label }) => ({ id, label, state: 'completed' })),
        ...this.#remaining.map(({ id, label }, index) => ({
          id,
          label,
          state: index === 0 ? 'active' : 'pending',
        })),
      ],
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
