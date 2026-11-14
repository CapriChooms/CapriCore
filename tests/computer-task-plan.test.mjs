// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerTaskPlan } from '../apps/desktop/computer-task-plan.mjs';

const entry = (id, label, successCriterion = `${label} is visible`) => ({
  id,
  label,
  successCriterion,
});
const browser = entry('browser', 'Open requested browser', 'Chrome is in the foreground');
const search = entry('search', 'Find requested video', 'Requested results are visible');
const video = entry('video', 'Open requested video', 'Requested video title is visible');
const current = (visible) => ({
  observation: { observationId: 'fresh', visible },
  evidenceExists: (observation, evidence) => observation.visible.includes(evidence),
});

test('host-confirmed actions credit only the matching active milestone and keep final review independent', () => {
  const opened = { ...browser, verifyOn: { action: 'launch', target: 'Chrome' } };
  const task = new ComputerTaskPlan();
  const proof = current(['Chrome']);
  assert.equal(task.startOutline({ milestones: [opened], outcome: video }), null);
  task.context().remainingCheckpoints[0].verifyOn.target = 'Other app';
  const credit = (action, target, evidence) =>
    task.confirmObservedAction(
      action,
      (planned) => planned === target,
      evidence,
      proof.observation,
      proof.evidenceExists,
    );
  assert.equal(credit('launch', 'Other app', 'Chrome'), false);
  assert.equal(credit('launch', 'Chrome', 'Missing evidence'), false);
  assert.equal(credit('launch', 'Chrome', 'Chrome'), true);
  assert.equal(task.view().steps[0].state, 'completed');
  assert.equal(task.view().steps[1].state, 'active');
  assert.equal(task.confirmOutcome(proof.observation, 'Chrome', proof.evidenceExists), false);
});
test('an exact final checkpoint echoed at the end of the outline is recorded once', () => {
  const { id, ...outcome } = video;
  const task = new ComputerTaskPlan();
  assert.equal(task.startOutline({ milestones: [browser, video], outcome }), null);
  assert.deepEqual(task.context().remainingCheckpoints, [
    browser,
    { id: 'owner-outcome', ...outcome },
  ]);
  assert.equal(task.readyForReview(), false);
  assert.match(
    new ComputerTaskPlan().startOutline({ milestones: [video, browser], outcome }),
    /duplicate/,
  );
});
test('UI plan contains labels and verified state while diagnostics exclude private labels', () => {
  const task = new ComputerTaskPlan();
  task.update({ plan: [browser, search] });
  assert.equal(task.view().steps[0].state, 'active');
  task.update(
    { verifiedCheckpoints: [{ id: 'browser', evidence: 'Chrome' }] },
    current(['Chrome']),
  );
  assert.deepEqual(
    task.view().steps.map((row) => row.state),
    ['completed', 'active'],
  );
  assert.ok(!JSON.stringify(task.diagnostics()).includes(browser.label));
});

test('a new native result may finish the task even when the model used it for an intermediate checkpoint', () => {
  const task = new ComputerTaskPlan();
  const proof = 'Saved draft';
  const { observation, evidenceExists } = current([proof]);
  assert.equal(
    task.startOutline({
      milestones: [entry('confirm', 'Confirm the save')],
      outcome: { label: 'Save the draft', successCriterion: 'The app reports a saved draft' },
    }),
    null,
  );
  assert.equal(
    task.update({ verifiedCheckpoints: [{ id: 'confirm', evidence: proof }] }, current([proof])),
    null,
  );
  assert.equal(task.confirmOutcome(observation, proof, evidenceExists), false);
  assert.equal(
    task.confirmOutcome(observation, proof, evidenceExists, { newlyObserved: true }),
    true,
  );
});

test('blocked work replaces obsolete pending checkpoints and keeps observed milestones', () => {
  const task = new ComputerTaskPlan();
  assert.equal(task.update({ plan: [browser, search, video] }), null);
  assert.equal(
    task.update(
      { verifiedCheckpoints: [{ id: 'browser', evidence: 'Chrome' }] },
      current(['Chrome']),
    ),
    null,
  );
  assert.equal(task.context().revision, 1, 'Verification alone does not revise the plan');
  assert.equal(task.recordOutcome({ ok: false, blocked: true }).needsRevision, true);
  const overlay = entry('overlay', 'Dismiss blocking overlay', 'Page content is accessible');
  const revisedSearch = {
    ...search,
    successCriterion: 'Requested results are visible on this page',
  };
  assert.equal(task.update({ plan: [overlay, revisedSearch, video] }), null);
  assert.deepEqual(task.context().completedCheckpoints, [browser]);
  assert.deepEqual(task.context().remainingCheckpoints, [overlay, revisedSearch, video]);
  assert.equal(task.context().recoveryAttempts, 1, 'Changing the plan cannot replenish recovery');
  assert.equal(task.update({ plan: [revisedSearch, video] }), null);
  assert.deepEqual(task.context().remainingCheckpoints, [revisedSearch, video]);
  assert.equal(task.context().revision, 3);
});

test('an attempted action never verifies a checkpoint and stale screen evidence is rejected', () => {
  const task = new ComputerTaskPlan();
  task.update({ plan: [browser, search] });
  task.recordOutcome({ ok: true });
  assert.deepEqual(task.context().completedCheckpoints, []);
  const before = task.context();
  assert.match(
    task.update(
      { verifiedCheckpoints: [{ id: 'search', evidence: 'Requested results' }] },
      current(['Chrome']),
    ),
    /current observation/u,
  );
  assert.deepEqual(task.context(), before);
  assert.equal(
    task.update(
      { verifiedCheckpoints: [{ id: 'search', evidence: 'Requested results' }] },
      current(['Requested results']),
    ),
    null,
  );
  assert.deepEqual(task.context().completedCheckpoints, [search]);
});

test('new or changed criteria cannot inherit a previous checkpoint completion', () => {
  const task = new ComputerTaskPlan();
  task.update({ plan: [browser, search] });
  const before = task.context();
  const changed = { ...search, successCriterion: 'A different page is visible' };
  assert.match(
    task.update(
      {
        plan: [browser, changed],
        verifiedCheckpoints: [{ id: 'search', evidence: 'Requested results' }],
      },
      current(['Requested results']),
    ),
    /cannot be reused/u,
  );
  assert.deepEqual(task.context(), before, 'A rejected revision is atomic');
  assert.match(
    task.update(
      { plan: [video], verifiedCheckpoints: [{ id: 'video', evidence: 'Video title' }] },
      current(['Video title']),
    ),
    /existing checkpoint/u,
  );
  assert.equal(task.update({ plan: [browser, changed] }), null);
  assert.equal(
    task.update(
      { verifiedCheckpoints: [{ id: 'search', evidence: 'A different page' }] },
      current(['A different page']),
    ),
    null,
  );
  assert.deepEqual(task.context().completedCheckpoints, [changed]);
});

test('completed checkpoints survive full-plan echoes and cannot change meaning', () => {
  const task = new ComputerTaskPlan();
  task.update({ plan: [browser, search] });
  task.update(
    { verifiedCheckpoints: [{ id: 'browser', evidence: 'Chrome' }] },
    current(['Chrome']),
  );
  assert.equal(task.update({ plan: [browser, search] }), null);
  assert.equal(task.context().revision, 1, 'Echoing a plan consumes no revision');
  assert.match(
    task.update({ plan: [{ ...browser, label: 'Open another browser' }, search] }),
    /cannot be reused/u,
  );
  assert.deepEqual(task.context().completedCheckpoints, [browser]);
});

test('checkpoint data is bounded, human readable and never stores executable arguments', () => {
  for (const plan of [
    [],
    ['Launch Chrome'],
    [browser, browser],
    [{ ...browser, action: 'launch', query: 'Chrome' }],
    [{ ...browser, successCriterion: '' }],
    [{ ...browser, label: 'x'.repeat(121) }],
    [{ ...browser, label: 'Run\nthis' }],
    [{ ...browser, label: '`powershell -c arbitrary`' }],
    Array.from({ length: 9 }, (_, index) => entry(`step${index}`, 'Visible checkpoint')),
  ]) {
    const task = new ComputerTaskPlan();
    assert.equal(typeof task.update({ plan }), 'string');
    assert.deepEqual(task.context().remainingCheckpoints, []);
  }
  const task = new ComputerTaskPlan({ maxCheckpoints: 2 });
  task.update({ plan: [browser, search] });
  task.update(
    { verifiedCheckpoints: [{ id: 'browser', evidence: 'Chrome' }] },
    current(['Chrome']),
  );
  assert.match(task.update({ plan: [search, video] }), /within the task plan limit/u);
  assert.throws(() => new ComputerTaskPlan({ maxCheckpoints: 100000 }), RangeError);
});

test('descriptive application names and drive paths remain inert checkpoint text', () => {
  const task = new ComputerTaskPlan();
  const shell = entry(
    'shell',
    'Open the requested PowerShell window',
    'PowerShell is in the foreground',
  );
  const file = entry('file', 'Inspect the requested file', 'E:\\Projects\\draft.txt is visible');
  assert.equal(task.update({ plan: [shell, file] }), null);
  assert.deepEqual(task.context().remainingCheckpoints, [shell, file]);
  assert.equal(
    typeof task.update({ plan: [{ ...shell, command: 'Get-Content private.txt' }] }),
    'string',
  );
  assert.deepEqual(task.context().remainingCheckpoints, [shell, file]);
});

test('legacy action replies need no plan and malformed or unsupported proofs change no state', () => {
  const task = new ComputerTaskPlan();
  assert.equal(task.update({ action: 'click', targetId: 'existing' }), null);
  assert.equal(task.context().revision, 0);
  task.update({ plan: [browser] });
  const before = task.context();
  for (const verifiedCheckpoints of [
    null,
    'browser',
    [null],
    [{ id: 'unknown', evidence: 'Chrome' }],
    [{ id: 'browser' }],
    [{ id: 'browser', evidence: 'Chrome', action: 'launch' }],
    [{ id: 'browser', evidence: 'Chrome\0' }],
    [{ id: 'browser', evidence: 'x'.repeat(241) }],
    [
      { id: 'browser', evidence: 'Chrome' },
      { id: 'browser', evidence: 'Chrome' },
    ],
    Array.from({ length: 9 }, (_, index) => ({ id: `proof${index}`, evidence: 'Chrome' })),
  ]) {
    assert.equal(typeof task.update({ verifiedCheckpoints }, current(['Chrome'])), 'string');
    assert.deepEqual(task.context(), before);
  }
  assert.match(
    task.update({ verifiedCheckpoints: [{ id: 'browser', evidence: 'Chrome' }] }),
    /current observation/u,
  );
  assert.deepEqual(task.context(), before);
});

test('exact UI evidence may include paths and code punctuation without becoming executable', () => {
  const task = new ComputerTaskPlan();
  task.update({ plan: [browser] });
  const evidence = 'C:\\Projects\\draft `{example}`';
  assert.equal(
    task.update({ verifiedCheckpoints: [{ id: 'browser', evidence }] }, current([evidence])),
    null,
  );
  assert.equal(task.context().revision, 1);
  assert.deepEqual(task.context().completedCheckpoints, [browser]);
  assert.deepEqual(task.context().remainingCheckpoints, []);
  assert(!JSON.stringify(task.context()).includes(evidence), 'Do not retain raw proof contents');
});

test('replanning and apparent successful input cannot hide repeated lack of progress', () => {
  const task = new ComputerTaskPlan({ maxRevisions: 2, maxRecoveryAttempts: 2 });
  task.update({ plan: [browser] });
  assert.equal(task.recordOutcome({ ok: true, changed: false }).needsRevision, true);
  assert.equal(task.update({ plan: [search] }), null);
  assert.equal(task.recordOutcome({ ok: false }).exhausted, true);
  assert.match(task.update({ plan: [video] }), /revision limit/u);
  assert.equal(task.recordOutcome({ ok: false }).recoveryAttempts, 2);
  assert.equal(task.recordOutcome({ ok: true, changed: true }).needsRevision, false);
  assert.deepEqual(task.context().completedCheckpoints, []);
});

test('diagnostics and returned copies cannot leak or mutate private checkpoint state', () => {
  const task = new ComputerTaskPlan();
  const initial = { ...browser };
  task.update({ plan: [initial] });
  initial.label = 'Caller changed the input';
  const snapshot = task.context();
  snapshot.remainingCheckpoints[0].label = 'Caller changed a returned value';
  snapshot.remainingCheckpoints.push(video);
  assert.deepEqual(task.context().remainingCheckpoints, [browser]);
  assert.deepEqual(task.diagnostics(), {
    revision: 1,
    completed: 0,
    remaining: 1,
    recoveryAttempts: 0,
  });
  assert(!JSON.stringify(task.diagnostics()).includes('Chrome'));
});

test('cancellation stops mutations and the next goal owns an independent plan and budget', () => {
  const controller = new AbortController();
  const cancelled = new ComputerTaskPlan({ signal: controller.signal });
  cancelled.update({ plan: [browser] });
  cancelled.recordOutcome({ ok: false });
  controller.abort();
  assert.throws(() => cancelled.update({ plan: [search] }), { name: 'AbortError' });
  assert.throws(() => cancelled.recordOutcome({ ok: true }), { name: 'AbortError' });
  const nextGoal = new ComputerTaskPlan();
  assert.equal(nextGoal.update({ plan: [search] }), null);
  assert.equal(nextGoal.context().recoveryAttempts, 0);
  assert.deepEqual(nextGoal.context().completedCheckpoints, []);
  assert.deepEqual(cancelled.context().remainingCheckpoints, [browser]);
});
