// SPDX-License-Identifier: GPL-3.0-only
// End-to-end executor against a disposable native form. No owner app may receive input.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { computerPlanner } from '../../apps/desktop/computer-planner.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
const root = process.cwd(),
  parent = path.join(root, '.runtime/computer-agent-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  executable = path.join(folder, 'Fixture.exe'),
  log = path.join(folder, 'input.log');
execFileSync(
  path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/target:winexe',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + executable,
    path.join(root, 'tools/verify/native/ComputerControlFixture.cs'),
  ],
  { windowsHide: true },
);
const child = spawn(executable, [log], { stdio: 'ignore', windowsHide: false });
const report = {
  passed: false,
  folder,
  ownerApplicationsTouched: false,
  model: process.env.CAPRI_VERIFY_MODEL ?? null,
  actions: [],
};
let control;
try {
  await delay(600);
  await callApplicationBridge(root, { action: 'catalog_launch', executable });
  const state = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(
    Number(state.processId),
    child.pid,
    'Fixture must be foreground before any test input.',
  );
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => true,
    unregisterEscape: () => {},
    showBorder: async () => {},
    hideBorder: () => {},
    bridge: async (args, options) => {
      if (args.action === 'computer_release') return callApplicationBridge(root, args, options);
      const live = await callApplicationBridge(root, { action: 'computer_state' }, options);
      assert.equal(Number(live.processId), child.pid, 'Never operate on an owner window.');
      if (args.action === 'computer_state') return live;
      report.actions.push(args.action);
      return callApplicationBridge(root, args, options);
    },
    capture: async () => {
      throw Error('Fixture requires accessible controls only');
    },
  });
  const deterministic = async ({ currentObservation: view }) => {
    const field = view.targets.find((t) => t.editable && t.untrustedLabel === 'Verification text');
    const button = view.targets.find((t) =>
      ['Verification click', 'Draft saved'].includes(t.untrustedLabel),
    );
    if (field.untrustedValue !== 'Capri verified')
      return {
        action: 'enter_text',
        targetId: field.targetId,
        text: 'Capri verified',
        summary: 'Type the draft.',
      };
    if (button.untrustedLabel !== 'Draft saved')
      return { action: 'click', targetId: button.targetId, summary: 'Save the draft.' };
    return { action: 'finish', evidence: 'Draft saved', summary: 'Entered and saved the draft.' };
  };
  const plan = report.model
    ? computerPlanner({
        url: process.env.CAPRI_VERIFY_OLLAMA_URL,
        model: report.model,
        params: { num_ctx: Number(process.env.CAPRI_VERIFY_CONTEXT ?? 8192) },
      })
    : deterministic;
  const tracedPlan = async (context, options) => {
    const step = await plan(context, options);
    console.log(JSON.stringify({ fixtureAction: step.action, review: options.review === true }));
    return step;
  };
  if (plan.outline) tracedPlan.outline = plan.outline;
  const agent = new ComputerAgent({
    control,
    plan: tracedPlan,
    applications: {
      operation: (_id, _args, run) => run(),
      execute: async () => {
        throw Error('The fixture is already open; other app launches are forbidden in this test.');
      },
    },
    emit: (event) => {
      console.log(JSON.stringify({ phase: event.phase, steps: event.steps }));
    },
  });
  const result = await agent.run(
    'In the already open Capri isolated input verification window, enter exactly Capri verified in Verification text, then click Verification click to save it. Do not launch another app.',
  );
  report.result = result;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    report.actions,
    ['computer_type', 'computer_click'],
    'Completed input/click must not be repeated.',
  );
  assert(readFileSync(log, 'utf8').includes('text:Capri verified'));
  assert(readFileSync(log, 'utf8').includes('click'));
  assert.equal(control.session, null);
  report.passed = true;
} finally {
  await control?.stop();
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
