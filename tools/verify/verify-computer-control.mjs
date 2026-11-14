// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { captureActiveDisplay } from '../../apps/desktop/native-screenshot.mjs';
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
const child = spawn(executable, [log, '--pointer-regression'], {
  windowsHide: false,
  stdio: 'ignore',
});
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
  assert.notEqual(
    Number(state.processId),
    owner.pid,
    'The ignored owner cannot become an input target.',
  );
  owner.kill();
  owner = null;
  if (Number(state.processId) !== child.pid) {
    // The OS can place another normal window ahead of the fixture. Re-focus
    // only our fixture and verify its PID again before sending any test input.
    await callApplicationBridge(root, { action: 'catalog_launch', executable });
    state = await callApplicationBridge(root, { action: 'computer_state' });
  }
  assert.equal(
    Number(state.processId),
    child.pid,
    'Only the isolated fixture may receive test input.',
  );
  const target = {
    windowId: state.windowId,
    processId: state.processId,
    startedAtTicks: state.startedAtTicks,
  };
  const display = await captureActiveDisplay(root, {
    displayWindow: state.windowId,
    withGeometry: true,
  });
  assert.deepEqual(display.bounds, state.displayBounds);
  assert.ok(display.bounds.width > state.width && display.bounds.height > state.height);
  assert.ok(
    state.desktopSurfaces.some(
      (surface) =>
        surface.kind === 'taskbar' &&
        surface.x >= display.bounds.x &&
        surface.y >= display.bounds.y &&
        surface.x + surface.width <= display.bounds.x + display.bounds.width &&
        surface.y + surface.height <= display.bounds.y + display.bounds.height,
    ),
  );
  await assert.rejects(
    captureActiveDisplay(root, { displayWindow: '1', withGeometry: true }),
    /could not capture/,
  );
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
  assert.equal(button.clickKind, 'control');
  const heading = state.untrustedControls.find((c) => c.untrustedName === 'Timeline drop zone');
  assert.equal(heading?.clickKind, 'text');
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
  const click = (name, clickCount = 1) => {
    const item = state.untrustedControls.find((control) => control.untrustedName === name);
    assert.ok(item, name);
    return callApplicationBridge(root, {
      ...target,
      action: 'computer_click',
      controlId: item.id,
      x: item.x,
      y: item.y,
      button: 'left',
      clickCount,
    });
  };
  await click('Relocating target');
  await assert.rejects(click('Covered target'), {
    code: 'COMPUTER_TARGET_COVERED',
    inputPerformed: false,
  });
  await assert.rejects(
    click('Changes after click', 2),
    (error) => error.inputPerformed !== false && /second click was skipped/i.test(error.message),
  );
  await delay(150);
  const events = readFileSync(log, 'utf8');
  for (const text of ['text:Capri input verified', 'down:A', 'up:A', 'down:W', 'up:W', 'click'])
    assert.ok(events.includes(text), text);
  assert.equal((events.match(/^relocated-click$/gm) ?? []).length, 1);
  assert.equal((events.match(/^rename-click$/gm) ?? []).length, 1);
  assert.doesNotMatch(events, /^cover(?:ed)?-click$/m);
  report.checks = [
    'UI Automation text entry',
    'Ctrl+A chord',
    'held W cancellation and key-up cleanup',
    'physical-coordinate mouse click',
    'native accessibility distinguishes an actual button from a plain label',
    'a control that moves on hover is found and clicked once',
    'covered controls and changed second clicks stay blocked',
    'native target hover without click',
    'foreground/PID fencing',
    'whole display capture includes the taskbar and rejects a stale foreground handle',
    'Capri owner window exclusion and focus handoff to the isolated application behind it',
  ];
  report.passed = true;
} finally {
  owner?.kill();
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
