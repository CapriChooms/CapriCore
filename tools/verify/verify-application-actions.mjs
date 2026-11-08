/** Real Calculator UI Automation, only when no Calculator window is already open. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import {
  ApplicationService,
  callApplicationBridge,
} from '../../integrations/desktop-actions/service.mjs';
const parent = path.join(root, '.runtime/application-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const permissionsFile = path.join(folder, 'permissions.json');
writeFileSync(
  permissionsFile,
  JSON.stringify({ schemaVersion: 1, settings: { notepad: false, calculator: true } }),
);
const service = new ApplicationService({
  root,
  permissionsFile,
  database: path.join(folder, 'operations.sqlite'),
});
let launched, note;
const report = { passed: false, folder, checks: [] };
try {
  const before = await service.execute('before', { action: 'status', app: 'calculator' });
  if (before.running)
    throw new Error(
      'Real Calculator verification skipped: an existing user window must be left untouched.',
    );
  launched = await service.execute('launch', { action: 'launch', app: 'calculator' });
  assert.equal(launched.running, true);
  report.checks.push('launched and verified supported Windows Calculator');
  const controls = await service.execute('controls', { action: 'controls', app: 'calculator' });
  assert.ok(controls.untrustedControls.some((c) => c.id === 'num7Button'));
  report.checks.push('found bounded accessible controls');
  const result = await service.execute('calculate', {
    action: 'calculate',
    app: 'calculator',
    expression: '17.5 * 4',
  });
  assert.match(result.untrustedResultLabel, /(?:^|\D)70(?:\D|$)/);
  report.result = result.untrustedResultLabel;
  report.checks.push('entered arithmetic using UI Automation and read actual displayed result');
  assert.deepEqual(
    await service.execute('calculate', {
      action: 'calculate',
      app: 'calculator',
      expression: '17.5 * 4',
    }),
    result,
  );
  report.checks.push('completed calculation retry did not change Calculator');
  if (!(await callApplicationBridge(root, { action: 'status', app: 'notepad' })).running) {
    writeFileSync(
      permissionsFile,
      JSON.stringify({ schemaVersion: 1, settings: { notepad: true, calculator: true } }),
    );
    note = await service.execute('notepad-launch', { action: 'launch', app: 'notepad' });
    assert.equal(note.running, true);
    assert.equal(
      (await service.execute('notepad-focus', { action: 'focus', app: 'notepad' })).running,
      true,
    );
    assert.ok(
      (await service.execute('notepad-controls', { action: 'controls', app: 'notepad' }))
        .untrustedControls.length > 0,
    );
    report.checks.push('opened, focused and inspected a fresh real Notepad window');
  } else report.checks.push('Notepad smoke skipped to preserve an existing user window');
  report.passed = true;
} finally {
  await service.close();
  for (const owned of [launched, note])
    if (owned?.processId && /^\d+$/.test(owned.startedAtTicks))
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$capriApp=Get-Process -Id ${Number(owned.processId)} -ErrorAction SilentlyContinue; if($capriApp -and $capriApp.StartTime.ToUniversalTime().Ticks -eq [long]'${owned.startedAtTicks}'){[void]$capriApp.CloseMainWindow(); if(-not $capriApp.WaitForExit(2000) -and $capriApp.ProcessName -eq 'CalculatorApp'){Stop-Process -Id $capriApp.Id}}`,
        ],
        { windowsHide: true },
      );
  writeFileSync(
    path.join(root, 'logs/application-actions-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
