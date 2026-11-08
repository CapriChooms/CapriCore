// SPDX-License-Identifier: GPL-3.0-only
// Real input and hooks are restricted to one generated WinForms fixture.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { TaskWorkflows } from '../../apps/desktop/task-workflows.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
const parent = path.join(root, '.runtime/0.6.2/workflow-native');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  exe = path.join(folder, 'OwnedFixture.exe'),
  log = path.join(folder, 'input.log');
execFileSync(
  path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/target:winexe',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + exe,
    path.join(root, 'tools/verify/native/ComputerControlFixture.cs'),
  ],
  { windowsHide: true, env: { ...process.env, TEMP: folder, TMP: folder } },
);
const child = spawn(exe, [log, '--clipboard', '--synthetic-clipboard'], {
  windowsHide: false,
  stdio: 'ignore',
});
let turn = 'record-fixture',
  catalog,
  workflows,
  control;
const report = { folder, checks: [], ownerApplicationsTouched: false };
try {
  await delay(600);
  await callApplicationBridge(root, { action: 'catalog_launch', executable: exe });
  const bridge = async (command, options) => {
    if (command.action !== 'computer_release' && command.action !== 'catalog_launch') {
      const state = await callApplicationBridge(root, { action: 'computer_state' });
      assert.equal(Number(state.processId), child.pid, 'Only the owned fixture may receive input.');
    }
    return callApplicationBridge(root, command, options);
  };
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => Boolean(turn),
    currentTurn: () => turn,
    registerEscape: () => true,
    unregisterEscape() {},
    showBorder: async () => {},
    hideBorder() {},
    bridge,
    pointerDuration: () => 180,
  });
  catalog = new DesktopCatalog({
    root,
    state: folder,
    fullAccess: () => true,
    bridge: (_root, command, options) => bridge(command, options),
  });
  workflows = new TaskWorkflows({
    root,
    data: folder,
    control,
    catalog,
    allowed: () => true,
    turn: (value) => (turn = value),
    spawnImpl: (file, args, options) => spawn(file, [...args, String(child.pid)], options),
  });
  await workflows.start();
  await control.begin('Owned recorder check');
  let view = await control.execute({ action: 'observe', vision: false });
  const target = view.targets.find((row) => row.untrustedLabel === 'Verification text');
  assert(target);
  await control.execute({
    action: 'click',
    observationId: view.observationId,
    targetId: target.targetId,
  });
  view = await control.execute({ action: 'observe', vision: false });
  await control.execute({
    action: 'press_keys',
    observationId: view.observationId,
    keys: ['CTRL', 'A'],
  });
  await delay(250);
  const recorded = await workflows.stopRecording();
  await control.stop();
  assert(
    recorded.some((step) => step.action === 'click' && step.selector.label === 'Verification text'),
  );
  assert(recorded.some((step) => step.action === 'keys' && step.keys.includes('CTRL')));
  assert(!recorded.some((step) => step.action === 'text'));
  report.checks.push(
    'Native hooks capture owned clicks/shortcuts as semantic selectors and no text',
  );
  const sel = (label, role) => ({ label, role: 'ControlType.' + role, automationId: '' });
  const base = { executable: exe, delayMs: 0 };
  const [workflow] = workflows.save({
    name: 'Owned combined workflow',
    steps: [
      { ...base, action: 'click', selector: sel('Verification text', 'Edit') },
      { ...base, action: 'text', selector: sel('Verification text', 'Edit'), text: '{{text}}' },
      { ...base, action: 'keys', keys: ['SHIFT', 'HOME'] },
      { ...base, action: 'keys', keys: ['CTRL', 'C'] },
      { ...base, action: 'click', selector: sel('Verification paste', 'Edit') },
      { ...base, action: 'keys', keys: ['CTRL', 'V'] },
      {
        ...base,
        action: 'drag',
        selector: sel('Clip source', 'Button'),
        to: sel('Timeline drop zone', 'Text'),
      },
      { ...base, action: 'click', selector: sel('Verification click', 'Button') },
    ],
  });
  const result = await workflows.run(workflow.id, { text: 'Capri workflow' });
  assert.equal(result.steps, 8);
  const events = readFileSync(log, 'utf8');
  for (const text of [
    'text:Capri workflow',
    'copy-selection:14:matches:True',
    'paste:Capri workflow',
    'drop',
    'click',
  ])
    assert(events.includes(text), text);
  assert.equal(control.session, null);
  report.checks.push(
    'Saved eight-step workflow performs text entry, shortcuts, real copy/paste, drag/drop and click',
  );
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  workflows?.close();
  await control?.stop();
  catalog?.close();
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Process -Id ' + child.pid + ').CloseMainWindow() | Out-Null',
      ],
      { windowsHide: true, timeout: 10000 },
    );
  } catch {}
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill();
  report.clipboardRestored = readFileSync(log, 'utf8').includes('clipboard-restored');
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  if (!report.failure) assert(report.clipboardRestored);
}
console.log(JSON.stringify(report));
