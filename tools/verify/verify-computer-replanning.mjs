// SPDX-License-Identifier: GPL-3.0-only
// Real native input against one disposable owned process, never an owner app.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

assert.equal(process.platform, 'win32', 'This native verifier requires Windows.');
const root = process.cwd();
const temp = path.join(root, '.runtime/tmp');
mkdirSync(temp, { recursive: true });
process.env.TEMP = temp;
process.env.TMP = temp;
const parent = path.join(root, '.runtime/computer-replanning-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const executable = path.join(folder, 'Fixture.exe');
const log = path.join(folder, 'input.log');
const trigger = path.join(folder, 'show-dialog');
execFileSync(
  path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + executable,
    path.join(root, 'tools/verify/native/ComputerReplanningFixture.cs'),
  ],
  { windowsHide: true },
);
const child = spawn(executable, [log, trigger], { stdio: 'ignore', windowsHide: false });
const report = {
  passed: false,
  folder,
  ownerApplicationsTouched: false,
  actions: [],
  preflightRejections: [],
  mainObserved: false,
  modalObserved: false,
  pendingPlanRevised: false,
  completedMilestoneRetained: false,
};
let control;
const state = async (options) => {
  const live = await callApplicationBridge(root, { action: 'computer_state' }, options);
  assert.equal(Number(live.processId), child.pid, 'Only the disposable fixture may be foreground.');
  return live;
};
const waitForModal = async () => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const live = await state();
    if (live.modal && live.untrustedTitle === 'Capri fixture blocking dialog') return;
    await delay(100);
  }
  throw Error('The owned fixture modal did not appear.');
};
const draft = {
  id: 'draft',
  label: 'Enter the requested fixture text',
  successCriterion: 'Verification text contains Capri replanned',
};
const save = {
  id: 'save',
  label: 'Save the fixture draft',
  successCriterion: 'Draft saved is visible',
};
const dismiss = {
  id: 'dialog',
  label: 'Dismiss the ordinary blocking fixture dialog',
  successCriterion: 'Fixture dialog dismissed is visible',
};
let forced = false;
try {
  await delay(500);
  await callApplicationBridge(root, { action: 'catalog_launch', executable });
  await state();
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {},
    hideBorder: () => {},
    bridge: async (args, options) => {
      const live = await state(options); // Includes cleanup: never send input to an owner PID.
      if (args.action === 'computer_state') return live;
      try {
        const receipt = await callApplicationBridge(root, args, options);
        if (args.action !== 'computer_release') report.actions.push(args.action);
        return receipt;
      } catch (error) {
        if (error.inputPerformed === false) report.preflightRejections.push(error.code);
        throw error;
      }
    },
    capture: async () => {
      throw Error('The fixture uses accessible native controls only.');
    },
  });
  const agent = new ComputerAgent({
    control,
    maxDecisions: 12,
    applications: {
      operation: (_id, _args, run) => run(),
      execute: async () => {
        throw Error('The fixture is already open; launching another application is forbidden.');
      },
    },
    plan: async ({ currentObservation: view, taskPlan }, { review }) => {
      if (review)
        return {
          action: 'finish',
          evidence: 'Draft saved',
          summary: 'The fixture draft is saved.',
        };
      const dialog = view.targets.find(
        (target) => target.untrustedLabel === 'Dismiss fixture dialog',
      );
      if (dialog) {
        assert.equal(view.window.modal, true);
        assert.equal(taskPlan.needsRevision, true);
        assert.deepEqual(
          taskPlan.completedCheckpoints.map((entry) => entry.id),
          ['draft'],
        );
        report.modalObserved = true;
        report.pendingPlanRevised = true;
        report.completedMilestoneRetained = true;
        return {
          action: 'click',
          targetId: dialog.targetId,
          plan: [dismiss, save],
          summary: 'Dismiss the ordinary fixture dialog, then continue saving.',
        };
      }
      const field = view.targets.find(
        (target) => target.editable && target.untrustedLabel === 'Verification text',
      );
      assert(field, 'The main fixture must expose its owned editable field.');
      report.mainObserved = true;
      if (field.untrustedValue !== 'Capri replanned')
        return {
          action: 'enter_text',
          targetId: field.targetId,
          text: 'Capri replanned',
          plan: [draft, save],
          summary: 'Enter the requested fixture draft.',
        };
      const button = view.targets.find((target) =>
        ['Save fixture draft', 'Draft saved'].includes(target.untrustedLabel),
      );
      assert(button);
      if (button.untrustedLabel === 'Draft saved')
        return {
          action: 'finish',
          evidence: 'Draft saved',
          verifiedCheckpoints: [{ id: 'save', evidence: 'Draft saved' }],
          summary: 'The fixture draft is saved.',
        };
      if (!forced) {
        forced = true;
        writeFileSync(trigger, 'owned fixture dialog');
        await waitForModal();
        // Deliberately make this previously observed Save target stale. The real
        // native preflight must reject it before any click, then the agent replans.
        return {
          action: 'click',
          targetId: button.targetId,
          verifiedCheckpoints: [{ id: 'draft', evidence: 'Capri replanned' }],
          summary: 'Save the verified fixture draft.',
        };
      }
      return {
        action: 'click',
        targetId: button.targetId,
        verifiedCheckpoints: [{ id: 'dialog', evidence: 'Fixture dialog dismissed' }],
        summary: 'Continue the remaining Save action after dismissing the dialog.',
      };
    },
  });
  report.result = await agent.run(
    'In the already open Capri isolated replanning verification window, enter exactly Capri replanned in Verification text, then click Save fixture draft. Do not launch another app.',
  );
  report.plan = agent.diagnostics().plan;
  assert.equal(report.result.ok, true, JSON.stringify(report.result));
  assert.equal(report.result.steps, 3);
  assert.deepEqual(report.actions, ['computer_type', 'computer_click', 'computer_click']);
  assert.deepEqual(report.preflightRejections, ['COMPUTER_FOREGROUND_CHANGED']);
  assert(
    report.mainObserved &&
      report.modalObserved &&
      report.pendingPlanRevised &&
      report.completedMilestoneRetained,
  );
  assert.deepEqual(report.plan, { revision: 2, completed: 3, remaining: 0, recoveryAttempts: 0 });
  const events = readFileSync(log, 'utf8').trim().split(/\r?\n/u);
  assert.deepEqual(events, [
    'ready',
    'draft-complete',
    'dialog-opened',
    'dialog-dismissed',
    'saved',
  ]);
  assert.equal(control.session, null);
  report.passed = true;
} catch (error) {
  report.error = { message: error.message, ...(error.code ? { code: error.code } : {}) };
  throw error;
} finally {
  await control?.stop();
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
