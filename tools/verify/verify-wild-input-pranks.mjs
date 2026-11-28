// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

const parent = path.join(root, '.runtime/wild-prank-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const log = path.join(folder, 'input.log');
const executable = path.join(folder, 'Fixture.exe');
const framework = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'Microsoft.NET/Framework64/v4.0.30319',
);

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

const child = spawn(executable, [log], {
  windowsHide: false,
  stdio: 'ignore',
});

const readLog = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
const countMatches = (text, pattern) => (text.match(pattern) ?? []).length;

const report = { passed: false, folder, ownerApplicationsTouched: false };
try {
  await delay(500);
  await callApplicationBridge(root, { action: 'catalog_launch', executable });

  let prankState;
  for (let i = 0; i < 80; i++) {
    await delay(150);
    if (!readLog().includes('ready')) continue;
    prankState = await callApplicationBridge(root, { action: 'wild_prank_state' });
    if (Number(prankState.processId) === child.pid && prankState.editableFocus === true) break;
  }

  assert.equal(
    Number(prankState?.processId),
    child.pid,
    'Only the isolated fixture may receive wild prank input.',
  );
  assert.match(String(prankState.windowId), /^[1-9]\d*$/);
  assert.ok(
    prankState.displayBounds &&
      prankState.displayBounds.width > 0 &&
      prankState.displayBounds.height > 0,
  );
  assert.ok(
    prankState.cursor &&
      typeof prankState.cursor.x === 'number' &&
      typeof prankState.cursor.y === 'number',
  );
  assert.equal(
    prankState.editableFocus,
    true,
    'Fixture TextBox should report editableFocus: true.',
  );

  const computerState = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(Number(computerState.processId), child.pid);
  assert.equal(computerState.windowId, prankState.windowId);
  const button = computerState.untrustedControls.find(
    (c) => c.untrustedName === 'Verification click',
  );
  assert.ok(button, 'Verification click button must be present.');

  const target = {
    windowId: prankState.windowId,
    processId: prankState.processId,
    startedAtTicks: prankState.startedAtTicks,
  };

  const baselineLog = readLog();
  assert.equal(baselineLog.trim(), 'ready', 'Fixture log should only contain ready before pranks.');

  // Defense-in-depth rejection checks (disallowed keys and mouse_button with allowButtons: false).
  const rejectedPlans = [
    {
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['ALT', 'F4'], holdMs: 40 }],
    },
    {
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['CTRL', 'W'], holdMs: 40 }],
    },
    {
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['WIN'], holdMs: 40 }],
    },
    {
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['ENTER'], holdMs: 40 }],
    },
    {
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['DELETE'], holdMs: 40 }],
    },
    {
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['ESCAPE'], holdMs: 40 }],
    },
    {
      allowKeys: true,
      allowButtons: false,
      steps: [{ type: 'mouse_button', button: 'left', holdMs: 40 }],
    },
  ];
  for (const plan of rejectedPlans) {
    await assert.rejects(
      callApplicationBridge(root, { action: 'wild_prank_run', ...target, ...plan }),
      { code: 'COMPUTER_WILD_PRANK_INVALID', inputPerformed: false },
    );
  }
  await delay(100);
  assert.equal(readLog(), baselineLog, 'Rejected wild_prank_run calls must log zero input.');

  // Verify editableFocus protection stops key_press cleanly when allowButtons is false.
  const guardedResult = await callApplicationBridge(root, {
    action: 'wild_prank_run',
    ...target,
    allowKeys: true,
    allowButtons: false,
    steps: [{ type: 'key_press', keys: ['W'], holdMs: 80 }],
  });
  assert.equal(guardedResult.ok, true);
  assert.equal(guardedResult.completed, false);
  assert.equal(guardedResult.aborted, true);
  assert.equal(guardedResult.reason, 'editable_focus');
  assert.equal(guardedResult.stepsExecuted, 0);
  await delay(80);
  assert.equal(readLog(), baselineLog, 'editable_focus abort must not press keys.');

  // Valid multi-step wild_prank_run.
  const multiResult = await callApplicationBridge(root, {
    action: 'wild_prank_run',
    ...target,
    allowKeys: true,
    allowButtons: true,
    steps: [
      { type: 'mouse_flick', dx: 80, dy: -30, durationMs: 100 },
      { type: 'mouse_move', x: button.x, y: button.y, durationMs: 140, pull: true },
      { type: 'key_press', keys: ['W'], holdMs: 120 },
      { type: 'mouse_scroll', amount: 2 },
      { type: 'mouse_button', button: 'left', holdMs: 40, count: 1 },
    ],
  });
  assert.equal(multiResult.ok, true);
  assert.equal(multiResult.completed, true);
  assert.equal(multiResult.aborted, false);
  assert.equal(multiResult.reason, null);
  assert.equal(multiResult.stepsExecuted, 5);

  await delay(120);
  const afterMulti = readLog();
  assert.ok(afterMulti.includes('down:W'), 'Fixture must log down:W.');
  assert.ok(afterMulti.includes('up:W'), 'Fixture must log up:W.');
  assert.ok(afterMulti.includes('click'), 'Fixture must log click.');
  assert.equal(
    countMatches(afterMulti, /^down:W$/gm),
    countMatches(afterMulti, /^up:W$/gm),
    'Multi-step key_press must release W cleanly with zero stuck keys.',
  );

  // Mid-hold AbortController cancellation during key_press ['W'] (holdMs: 1800).
  const downBeforeAbort = countMatches(afterMulti, /^down:W$/gm);
  const upBeforeAbort = countMatches(afterMulti, /^up:W$/gm);
  const controller = new AbortController();
  const held = callApplicationBridge(
    root,
    {
      action: 'wild_prank_run',
      ...target,
      allowKeys: true,
      allowButtons: true,
      steps: [{ type: 'key_press', keys: ['W'], holdMs: 1800 }],
    },
    { signal: controller.signal },
  );

  let enteredHold = false;
  for (let i = 0; i < 60; i++) {
    await delay(25);
    if (countMatches(readLog(), /^down:W$/gm) > downBeforeAbort) {
      enteredHold = true;
      break;
    }
  }
  assert.equal(enteredHold, true, 'Fixture must receive down:W before mid-hold abort.');

  const abortStartedAt = Date.now();
  controller.abort(new Error('Wild prank mid-hold cancellation'));
  await assert.rejects(held, /cancellation/i);
  const abortElapsedMs = Date.now() - abortStartedAt;
  assert.ok(
    abortElapsedMs < 1200,
    `Mid-hold cancellation should abort promptly, took ${abortElapsedMs}ms.`,
  );

  let releasedAfterAbort = false;
  for (let i = 0; i < 20; i++) {
    if (countMatches(readLog(), /^up:W$/gm) > upBeforeAbort) {
      releasedAfterAbort = true;
      break;
    }
    await delay(25);
  }
  assert.equal(
    releasedAfterAbort,
    true,
    'Fixture must log up:W after mid-hold AbortController cancellation.',
  );

  report.abortElapsedMs = abortElapsedMs;
  report.checks = [
    'wild_prank_state reports matching PID, windowId, displayBounds, cursor, and editableFocus',
    'defense-in-depth preflight rejects ALT+F4, CTRL+W, WIN, ENTER, DELETE, ESCAPE, and mouse_button without allowButtons',
    'editableFocus guard stops key_press cleanly when allowButtons is false',
    'multi-step wild_prank_run executes mouse_flick, mouse_move pull, key_press hold, mouse_scroll, and mouse_button with zero stuck keys',
    'mid-hold AbortController cancellation aborts promptly and releases W cleanly via stdin stop cleanup',
  ];
  report.passed = true;
} finally {
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
