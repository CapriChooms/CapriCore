// SPDX-License-Identifier: GPL-3.0-only
// Only a generated WinForms fixture receives focus/input. No owner app is controlled.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
const parent = path.join(root, '.runtime/issues-062/native-startup');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  exe = path.join(folder, 'OwnedFixture.exe'),
  log = path.join(folder, 'events.log');
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
const child = spawn(exe, [log], { windowsHide: false, stdio: 'ignore' });
let turn,
  unavailable = true,
  control,
  catalog;
const report = { checks: [], ownerApplicationsTouched: false, modelLoaded: false };
try {
  await delay(600);
  const bridge = async (command, options) => {
    try {
      if (command.action === 'computer_state' && unavailable)
        throw Object.assign(Error('Simulated unavailable foreground, matching issue #77.'), {
          code: 'COMPUTER_APPLICATION_UNAVAILABLE',
        });
      if (command.action === 'catalog_launch') {
        assert.equal(command.executable, exe);
        const result = await callApplicationBridge(root, command, options);
        unavailable = false;
        return result;
      }
      const state = await callApplicationBridge(root, { action: 'computer_state' });
      assert.equal(Number(state.processId), child.pid, 'Only the owned fixture may receive input.');
      return command.action === 'computer_state'
        ? state
        : await callApplicationBridge(root, command, options);
    } catch (error) {
      if (!(unavailable && error.code === 'COMPUTER_APPLICATION_UNAVAILABLE'))
        report.nativeFailure = {
          action: command.action,
          code: error.code ?? null,
          error: error.message.replaceAll(root, '<owned fixture root>').slice(0, 500),
        };
      throw error;
    }
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
  });
  catalog = new DesktopCatalog({
    root,
    state: folder,
    fullAccess: () => true,
    bridge: (_root, command, options) => bridge(command, options),
  });
  catalog.save([
    {
      id: randomUUID(),
      name: 'OwnedFixture',
      executable: exe,
      launch: true,
      inspect: true,
      text: true,
    },
  ]);
  const agent = new ComputerAgent({
    control,
    applications: catalog,
    plan: async ({ currentObservation: view }) => {
      const field = view.targets.find((item) => item.untrustedLabel === 'Verification text');
      assert(field, 'The target must have a real native observation after launch');
      return field.untrustedValue === 'Capri regression'
        ? {
            action: 'finish',
            summary: 'The owned draft is verified.',
            evidence: 'Capri regression',
          }
        : {
            action: 'enter_text',
            targetId: field.targetId,
            text: 'Capri regression',
            mode: 'replace',
            summary: '',
          };
    },
  });
  for (const goal of [
    'Open OwnedFixture.',
    'Abre OwnedFixture.',
    'Открой OwnedFixture.',
    'Open OwnedFixture, then type Capri regression.',
  ]) {
    turn = randomUUID();
    unavailable = true;
    const result = await agent.run(goal);
    assert.equal(
      result.status,
      'completed',
      JSON.stringify({ goal, result, diagnostics: agent.diagnostics() }),
    );
    assert.equal(result.verified, true);
    assert.equal(control.session, null);
    report.checks.push(goal);
  }
  assert(readFileSync(log, 'utf8').includes('text:Capri regression'));
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  await control?.stop();
  await catalog?.close();
  if (child.exitCode === null) child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, folder }));
