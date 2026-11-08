// SPDX-License-Identifier: GPL-3.0-only
// Real app/watchdog/indicator, isolated settings and an owned WinForms fixture.
// Cancel during a delay, then optionally complete harmless input in the owned fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';
const sourceRoot = path.resolve(process.argv[2] ?? root);
const parent = path.join(sourceRoot, '.runtime/workflow-lifecycle');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  exe = path.join(folder, 'OwnedWorkflow.exe'),
  events = path.join(folder, 'events.log'),
  stop = path.join(folder, 'stop');
mkdirSync(path.join(folder, 'desktop'));
writeFileSync(
  path.join(folder, 'desktop/full-computer-access.json'),
  JSON.stringify({ schemaVersion: 1, settings: { enabled: true, drives: ['E:\\'] } }),
);
const cs = path.join(folder, 'OwnedWorkflow.cs');
const literal = (value) => '@"' + value.replaceAll('"', '""') + '"';
writeFileSync(
  cs,
  `using System;using System.IO;using System.Windows.Forms;
class OwnedWorkflow{[STAThread]static void Main(){var form=new Form{Text="Capri workflow verification",Width=300,Height=140,KeyPreview=true};form.Shown+=(s,e)=>File.AppendAllText(${literal(events)},"ready\\n");form.KeyDown+=(s,e)=>File.AppendAllText(${literal(events)},"INPUT\\n");var timer=new Timer{Interval=150};timer.Tick+=(s,e)=>{if(File.Exists(${literal(stop)}))form.Close();};timer.Start();Application.Run(form);}}
`,
);
execFileSync(
  path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/target:winexe',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + exe,
    cs,
  ],
  { windowsHide: true, env: { ...process.env, TEMP: folder, TMP: folder } },
);
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let app, settings, pending;
const report = { passed: false, physicalInput: false, modelStarted: false };
try {
  const env = {
    ...process.env,
    TEMP: folder,
    TMP: folder,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_ASR: '0',
    CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(sourceRoot, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  settings = await settingsView(app, 'workflows');
  assert.equal(Boolean((await page.evaluate(() => window.capri.bootstrap())).activeTurnId), false);
  const rows = await settings.evaluate(
    (executable) =>
      window.capri.workflowAction({
        action: 'save',
        workflow: {
          name: 'Owned lifecycle regression',
          steps: [{ executable, action: 'keys', keys: ['F24'], delayMs: 3000 }],
        },
      }),
    exe,
  );
  pending = settings.evaluate(
    (id) =>
      window.capri.workflowAction({ action: 'run', id }).then(
        (value) => ({ value }),
        (error) => ({ error: error.message }),
      ),
    rows[0].id,
  );
  let visible = false;
  for (let i = 0; i < 80; i++) {
    visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (win) => win.webContents.getURL().includes('control-overlay.html') && win.isVisible(),
      ),
    );
    if (visible) break;
    const state = await settings.evaluate(() => window.capri.workflowAction({ action: 'status' }));
    if (!state.status.playing) {
      report.runResult = await pending;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(
    visible,
    'The real workflow must show its control indicator: ' + JSON.stringify(report.runResult),
  );
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const state = await settings.evaluate(() => window.capri.workflowAction({ action: 'status' }));
  if (!state.status.playing) report.runResult = await pending;
  assert(
    state.status.playing,
    'The main watchdog must retain a workflow without an active chat: ' +
      JSON.stringify(report.runResult),
  );
  await settings.evaluate(() => window.capri.workflowAction({ action: 'stop' }));
  const result = await pending;
  assert(result.error, 'Owner cancellation must stop playback before its input step');
  assert(
    !/indicator did not become visible/.test(result.error),
    'Cancellation is not an indicator timeout',
  );
  await page.waitForFunction(async () => !(await window.capri.bootstrap()).computerControl?.active);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (win) => win.webContents.getURL().includes('control-overlay.html') && win.isVisible(),
      ),
    ),
    false,
  );
  assert(!existsSync(events) || !readFileSync(events, 'utf8').includes('INPUT'));
  if (process.argv.includes('--complete')) {
    const completedRows = await settings.evaluate(
      (executable) =>
        window.capri.workflowAction({
          action: 'save',
          workflow: {
            name: 'Owned completed workflow',
            steps: Array.from({ length: 3 }, () => ({
              executable,
              action: 'keys',
              keys: ['F24'],
              delayMs: 600,
            })),
          },
        }),
      exe,
    );
    const completed = await settings.evaluate(
      (id) => window.capri.workflowAction({ action: 'run', id }),
      completedRows.find((row) => row.name === 'Owned completed workflow').id,
    );
    assert.equal(completed.ok, true);
    assert.equal(completed.steps, 3);
    assert.equal(readFileSync(events, 'utf8').match(/INPUT/g)?.length, 3);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (win) => win.webContents.getURL().includes('control-overlay.html') && win.isVisible(),
        ),
      ),
      false,
    );
    report.completedSteps = 3;
    report.physicalInput = true;
    report.inputTarget = 'owned verification fixture only';
  }
  report.passed = true;
  report.retainedWithoutChat = true;
  report.cancelledCleanly = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await settings?.evaluate(() => window.capri.workflowAction({ action: 'stop' })).catch(() => {});
  if (pending) await pending.catch(() => {});
  writeFileSync(stop, 'stop');
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, folder }));
