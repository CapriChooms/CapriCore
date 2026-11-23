// SPDX-License-Identifier: GPL-3.0-only
// Real OS copy/paste, smooth motion and drag/drop. Clipboard restoration is owned
// by the fixture process; no clipboard content is returned or saved.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
const root = process.cwd(),
  parent = path.join(root, '.runtime/input-workflow-verification');
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
const child = spawn(executable, [log, '--clipboard'], { stdio: 'ignore', windowsHide: false });
let control;
const report = {
  passed: false,
  ownerApplicationsTouched: false,
  clipboardContentExported: false,
  checks: [],
};
try {
  await delay(500);
  await callApplicationBridge(root, { action: 'catalog_launch', executable });
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => true,
    unregisterEscape() {},
    showBorder: async () => {},
    hideBorder() {},
    pointerDuration: () => 600,
    bridge: async (args, options) => {
      if (args.action === 'computer_release') return callApplicationBridge(root, args, options);
      const state = await callApplicationBridge(root, { action: 'computer_state' });
      assert.equal(
        Number(state.processId),
        child.pid,
        'Input may reach only the generated fixture.',
      );
      return args.action === 'computer_state' ? state : callApplicationBridge(root, args, options);
    },
    capture: async () => {
      throw Error('Only accessible controls are needed.');
    },
  });
  await control.begin(
    'Verify typing, copying, pasting, smooth pointer motion and dragging a test clip.',
  );
  let view = await control.execute({ action: 'observe', vision: false });
  const find = (label) => {
    const target = view.targets.find((t) => t.untrustedLabel === label);
    assert(target, label);
    return target.targetId;
  };
  const observe = async () => {
    view = await control.execute({ action: 'observe', vision: false });
  };
  await control.execute({
    action: 'enter_text',
    targetId: find('Verification text'),
    text: 'Capri workflow',
  });
  await observe();
  await control.execute({
    action: 'enter_text',
    targetId: find('Verification text'),
    text: ' appended',
    mode: 'append',
  });
  await observe();
  assert.equal(
    view.targets.find((t) => t.untrustedLabel === 'Verification text').untrustedValue,
    'Capri workflow appended',
  );
  await control.execute({
    action: 'enter_text',
    targetId: find('Verification text'),
    text: 'Capri workflow',
  });
  await observe();
  assert.equal(
    view.targets.find((t) => t.untrustedLabel === 'Verification text').untrustedValue,
    'Capri workflow',
  );
  report.checks.push('replace and append preserve exact intended text');
  // The legacy single-line Win32 EDIT fixture has no Ctrl+A handler. Select
  // from the end with Shift+Home; browser shortcuts are checked separately.
  await control.execute({
    action: 'press_keys',
    observationId: view.observationId,
    keys: ['SHIFT', 'HOME'],
  });
  await observe();
  await control.execute({
    action: 'press_keys',
    observationId: view.observationId,
    keys: ['CTRL', 'C'],
  });
  await observe();
  await control.execute({ action: 'click', targetId: find('Verification paste') });
  await observe();
  await control.execute({
    action: 'press_keys',
    observationId: view.observationId,
    keys: ['CTRL', 'V'],
  });
  await observe();
  assert.equal(
    view.targets.find((t) => t.untrustedLabel === 'Verification paste').untrustedValue,
    'Capri workflow',
  );
  report.checks.push('real keyboard copy and paste into another field');
  await control.execute({
    action: 'drag',
    targetId: find('Clip source'),
    toTargetId: find('Timeline drop zone'),
    modifiers: ['CTRL'],
  });
  await observe();
  assert(view.targets.some((t) => t.untrustedLabel === 'Clip placed'));
  report.checks.push('real drag and drop with mouse-up cleanup');
  for (const args of [
    { button: 'left', clickCount: 2 },
    { button: 'right' },
    { button: 'middle' },
  ]) {
    await observe();
    await control.execute({ action: 'click', targetId: find('Double click target'), ...args });
    if (args.button === 'right') {
      await observe();
      await control.execute({ action: 'click', targetId: find('Insert verification clip') });
    }
  }
  const pointerEvents = readFileSync(log, 'utf8');
  for (const marker of [
    'double-click',
    'right-click',
    'middle-click',
    'drag-ctrl:True',
    'menu-action',
  ])
    assert(pointerEvents.includes(marker), marker);
  report.checks.push(
    'double-click, right and middle buttons; owned context-menu selection; Ctrl-drag with modifier release',
  );
  await observe();
  await control.execute({ action: 'move_pointer', targetId: find('Verification click') });
  const events = readFileSync(log, 'utf8').split('\n');
  assert(events.includes('drop'));
  assert(new Set(events.filter((line) => line.startsWith('move:'))).size >= 5);
  report.checks.push('multiple real intermediate pointer positions');
  report.passed = true;
} finally {
  await control?.stop();
  // Graceful Close runs FormClosed and restores the fixture's in-memory snapshot.
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-Process -Id ' + child.pid + ').CloseMainWindow() | Out-Null',
      ],
      { windowsHide: true, timeout: 3000 },
    );
  } catch {}
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill();
  report.clipboardRestored = readFileSync(log, 'utf8').includes('clipboard-restored');
  if (!report.clipboardRestored) report.passed = false;
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, folder }));
  assert(report.clipboardRestored, 'The fixture must restore its in-memory clipboard backup.');
}
