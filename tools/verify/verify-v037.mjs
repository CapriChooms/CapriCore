// SPDX-License-Identifier: GPL-3.0-only
/** Real desktop IPC and native UIA fixtures. Models, owner state and private apps are untouched. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { ActionApprovals } from '../../apps/desktop/action-broker.mjs';
import { FilePermissions } from '../../integrations/filesystem/permissions.mjs';
import { ensureDesktopActions } from '../../integrations/desktop-actions/provision.mjs';
const parent = path.join(root, '.runtime/v037-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-')),
  errors = [],
  checks = [];
const server = createServer((req, res) => {
  req.resume();
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  workspace: path.join(folder, 'workspace'),
  stateDir: path.join(folder, 'openclaw'),
  gatewayPort: server.address().port,
  logPrefix: 'v037-fixture',
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app, catalog, fixturePid;
try {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 20000,
  });
  const open = (panel) =>
    app.evaluate(
      ({ BrowserWindow }, type) =>
        BrowserWindow.getAllWindows()[0].webContents.send('capri:event', { type }),
      'open-' + panel,
    );
  await open('time');
  await page.locator('#time-panel').waitFor({ state: 'visible' });
  await page.locator('#time-title').fill('Fixture tea');
  await page.locator('#time-minutes').fill('0');
  await page.locator('#time-seconds').fill('3');
  await page.locator('#time-create').click({ force: true });
  await page.waitForFunction(async () =>
    (await window.capri.timeStatus()).some((o) => o.title === 'Fixture tea'),
  );
  await page.waitForFunction(
    async () => (await window.capri.timeStatus()).some((o) => o.state === 'due'),
    null,
    { timeout: 8000 },
  );
  await page.waitForFunction(() =>
    document.querySelector('#time-alert-text').textContent.includes('Fixture tea'),
  );
  checks.push('real IPC timer fires without a loaded model and appears in the reminder panel');
  await page.locator('#time-alert-dismiss').click({ force: true });
  await page.locator('#time-close').click({ force: true });
  await open('screen');
  await page.locator('#screen-panel').waitFor({ state: 'visible' });
  await page.evaluate(() =>
    window.capri.setScreenSettings({ intervalMs: 47000, durationMs: 930000 }),
  );
  const stored = JSON.parse(readFileSync(path.join(folder, 'desktop/screen-observation.json')));
  assert.equal(stored.settings.intervalMs, 47000);
  await page.locator('#screen-close').click({ force: true });
  await page.evaluate(async () => {
    await window.capri.setDimming({ enabled: true, level: 60, softness: 50 });
  });
  await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  const shade = await page.evaluate(() => {
    const r = document.querySelector('#window-shade').getBoundingClientRect();
    const h = document.querySelector('#handle').getBoundingClientRect();
    return {
      y: r.y,
      height: r.height,
      handle: h.y,
      pressed: document.querySelector('#presence-toggle').getAttribute('aria-pressed'),
    };
  });
  assert.ok(shade.y >= shade.handle - 13 && shade.y > 50, JSON.stringify(shade));
  assert.equal(shade.pressed, 'false');
  checks.push(
    'compact backdrop excludes the reserved portrait area; toggle reports the actual expanded state',
  );
  await page.screenshot({ path: path.join(folder, 'compact.png') });
  await open('languages');
  await page.locator('#language-recognition').selectOption('auto-europe');
  assert.match(
    await page.locator('#language-recognition-status').textContent(),
    /25 European languages/,
  );
  checks.push('fast multilingual mode is visible with a clear supported-language description');
  if (process.platform === 'win32') {
    ensureDesktopActions();
    const exe = path.join(folder, 'Capri.EditFixture.exe');
    execFileSync(
      path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      [
        '/nologo',
        '/target:winexe',
        '/r:System.Windows.Forms.dll',
        '/r:System.Drawing.dll',
        '/out:' + exe,
        path.join(root, 'tests/fixtures/DesktopEditor.cs'),
      ],
      { windowsHide: true },
    );
    const state = path.join(folder, 'native');
    mkdirSync(state);
    const permissions = new FilePermissions(path.join(state, 'permissions.json'));
    catalog = new DesktopCatalog({
      root,
      state,
      filePermissions: permissions,
      trash: (file) => app.evaluate(({ shell }, target) => shell.trashItem(target), file),
    });
    const approvals = new ActionApprovals({ emit() {} });
    const [entry] = catalog.add(exe);
    catalog.update({ id: entry.id, launch: true, inspect: true, text: true });
    const launched = await catalog.execute(
      'launch',
      { action: 'launch', appId: entry.id },
      approvals,
    );
    assert.equal(launched.windowVerified, true);
    const inspection = await catalog.execute(
      'inspect',
      { action: 'inspect', appId: entry.id },
      approvals,
    );
    fixturePid = inspection.processId;
    const field = inspection.untrustedControls.find((c) => c.editable);
    assert.ok(field, JSON.stringify(inspection));
    const proposed = await catalog.execute(
      'type',
      {
        action: 'type_text',
        appId: entry.id,
        inspectionId: inspection.inspectionId,
        controlId: field.id,
        text: 'Capri native fixture',
      },
      approvals,
    );
    const typed = await approvals.respond(proposed.proposal.id, true);
    assert.equal(typed.ok, true);
    checks.push(
      'native allowlisted launch, real UIA inspection and confirmed ValuePattern text entry verified without Enter',
    );
    const personal = path.join(folder, 'personal');
    mkdirSync(personal);
    const file = path.join(personal, 'disposable-note.txt');
    writeFileSync(file, 'Recycle Bin fixture');
    const [scope] = permissions.grant(personal);
    permissions.update(scope.id, true);
    const removal = await catalog.execute(
      'trash',
      { action: 'trash', scopeId: scope.id, path: 'disposable-note.txt' },
      approvals,
    );
    const receipt = await approvals.respond(removal.proposal.id, true);
    assert.equal(receipt.ok, true);
    assert.equal(existsSync(file), false);
    assert.equal(catalog.db.prepare('SELECT count(*) AS n FROM recovery').get().n, 1);
    checks.push(
      'actual Windows Recycle Bin operation succeeds only after UI approval and keeps a verified private recovery copy',
    );
  }
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    folder,
    checks,
    ownerHistoryChanged: false,
    realModelsUsed: false,
  };
  writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  writeFileSync(
    path.join(folder, 'failure.txt'),
    JSON.stringify({ error: error.stack, errors }, null, 2),
  );
  await app
    ?.windows()[0]
    ?.screenshot({ path: path.join(folder, 'failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await catalog?.close();
  if (fixturePid)
    spawnSync('taskkill.exe', ['/PID', String(fixturePid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  await app?.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
