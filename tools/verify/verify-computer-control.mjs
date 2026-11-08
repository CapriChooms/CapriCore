// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
const parent = path.join(root, '.runtime/computer-control-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  log = path.join(folder, 'input.log'),
  executable = path.join(folder, 'Fixture.exe');
const framework = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319');
execFileSync(
  path.join(framework, 'csc.exe'),
  [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + executable,
    path.join(root, 'tools/verify/native/ComputerControlFixture.cs'),
  ],
  { windowsHide: true },
);
const child = spawn(executable, [log], { windowsHide: false, stdio: 'ignore' });
let owner;
const report = { passed: false, folder, ownerApplicationsTouched: false };
try {
  let state;
  await delay(500);
  await callApplicationBridge(root, { action: 'catalog_launch', executable });
  for (let i = 0; i < 200; i++) {
    await delay(250);
    state = await callApplicationBridge(root, { action: 'computer_state' });
    if (Number(state.processId) === child.pid) break;
  }
  assert.equal(
    Number(state.processId),
    child.pid,
    'Only the isolated fixture may receive test input.',
  );
  const ownerExecutable = path.join(folder, 'CapriOwnerFixture.exe');
  copyFileSync(executable, ownerExecutable);
  owner = spawn(ownerExecutable, [path.join(folder, 'owner.log')], {
    windowsHide: false,
    stdio: 'ignore',
  });
  await delay(500);
  await callApplicationBridge(root, { action: 'catalog_launch', executable: ownerExecutable });
  const focusedOwner = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(
    Number(focusedOwner.processId),
    owner.pid,
    'Only the isolated owner fixture may be skipped.',
  );
  state = await callApplicationBridge(root, {
    action: 'computer_state',
    ignoreProcessId: String(owner.pid),
  });
  assert.equal(
    Number(state.processId),
    child.pid,
    'Observe and focus the application behind the Capri owner process.',
  );
  owner.kill();
  owner = null;
  const target = {
    windowId: state.windowId,
    processId: state.processId,
    startedAtTicks: state.startedAtTicks,
  };
  const field = state.untrustedControls.find(
    (c) => c.editable && c.untrustedName === 'Verification text',
  );
  assert.ok(field);
  await callApplicationBridge(root, {
    action: 'computer_type',
    ...target,
    controlId: field.id,
    text: 'Capri input verified',
    mode: 'replace',
  });
  await callApplicationBridge(root, {
    action: 'computer_keys',
    ...target,
    keys: ['CTRL', 'A'],
    holdMs: 40,
  });
  const controller = new AbortController();
  const held = callApplicationBridge(
    root,
    { action: 'computer_keys', ...target, keys: ['W'], holdMs: 2000 },
    { signal: controller.signal },
  );
  // The helper must enter the hold before cancellation; inspect only fixture events.
  for (let i = 0; i < 30; i++) {
    await delay(25);
    if (readFileSync(log, 'utf8').includes('down:W')) break;
  }
  controller.abort(new Error('Fixture emergency cancellation'));
  await assert.rejects(held, /cancellation/);
  await callApplicationBridge(root, { action: 'computer_release', keys: ['W'] });
  const button = state.untrustedControls.find((c) => c.untrustedName === 'Verification click');
  assert.ok(button);
  await callApplicationBridge(root, {
    action: 'computer_pointer',
    ...target,
    controlId: button.id,
    x: 0,
    y: 0,
  });
  const hovered = await callApplicationBridge(root, { action: 'computer_state' });
  assert(hovered.untrustedControls.some((c) => c.id === button.id && c.hovered));
  assert(!readFileSync(log, 'utf8').includes('click'), 'Hover must not click');
  await callApplicationBridge(root, {
    action: 'computer_click',
    ...target,
    controlId: button.id,
    x: button.x,
    y: button.y,
    button: 'left',
  });
  await delay(150);
  const events = readFileSync(log, 'utf8');
  for (const text of ['text:Capri input verified', 'down:A', 'up:A', 'down:W', 'up:W', 'click'])
    assert.ok(events.includes(text), text);
  report.checks = [
    'UI Automation text entry',
    'Ctrl+A chord',
    'held W cancellation and key-up cleanup',
    'physical-coordinate mouse click',
    'native target hover without click',
    'foreground/PID fencing',
    'Capri owner window exclusion and focus handoff to the isolated application behind it',
  ];
  report.passed = true;
} finally {
  owner?.kill();
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
