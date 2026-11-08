// SPDX-License-Identifier: GPL-3.0-only
// Owned synthetic workers only; no microphone, models or production services.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { ensureDesktopIdentity } from '../../packages/runtime/src/host/desktop-identity.mjs';

const parent = path.join(root, '.runtime/process-identity-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const server = createServer((_req, res) => res.end('{"data":[]}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: server.address().port,
  logPrefix: 'identity-verification',
});
initialize(rt);
let application;
try {
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: await ensureDesktopIdentity(createRequire(import.meta.url)('electron')),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  const report = await application.evaluate(async ({ BrowserWindow }, projectRoot) => {
    const { spawn } = process.getBuiltinModule('child_process');
    const path = process.getBuiltinModule('path');
    const win = BrowserWindow.getAllWindows()[0];
    // Verification normally disables focus (which also forces skipTaskbar on
    // Windows). This one fixture deliberately matches the production window.
    win.setFocusable(true);
    win.setSkipTaskbar(false);
    win.show();
    const workers = [];
    const node = spawn(process.env.CAPRI_NODE_PATH, ['-e', 'setInterval(() => {}, 1000)'], {
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    });
    workers.push(node);
    const python = path.join(projectRoot, '.runtime/asr-venv/Scripts/python.exe');
    const { existsSync } = process.getBuiltinModule('fs');
    if (existsSync(python))
      workers.push(
        spawn(python, ['-c', 'import time; time.sleep(90)'], {
          windowsHide: true,
          detached: false,
          stdio: 'ignore',
        }),
      );
    globalThis.identityFixtureWorkers = workers;
    return {
      executable: process.execPath,
      parentPid: process.pid,
      workerPids: workers.map((child) => child.pid),
      windowVisible: win.isVisible(),
      windowsVersion: process.getSystemVersion(),
    };
  }, root);
  assert.equal(path.basename(report.executable), 'Capri.exe');
  assert.equal(report.windowVisible, true);
  writeFileSync(
    path.join(root, 'logs/process-identity-verification.json'),
    JSON.stringify(
      {
        ...report,
        folder,
        passed: true,
        scope: 'process identity and metadata; Task Manager grouping is not asserted',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ...report, folder, passed: true }));
  if (process.argv.includes('--hold')) {
    const until = Date.now() + 90000;
    while (Date.now() < until && !existsSync(path.join(folder, 'stop'))) await delay(250);
  }
} finally {
  await application
    ?.evaluate(() => globalThis.identityFixtureWorkers?.forEach((child) => child.kill()))
    .catch(() => {});
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
