import { saveSettings, settingsView } from './settings-view.mjs';
/** Native folder picker boundary and real private settings; isolated fake Gateway. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/file-access-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const selected = path.join(folder, 'Selected folder');
mkdirSync(selected);
let application;
const server = createServer((req, res) => res.end('{"data":[]}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port,
  rt = runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    gatewayPort: port,
  });
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url),
  errors = [];
try {
  application = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const primaryPage = await application.firstWindow();
  let page = primaryPage;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow, dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    const win = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    win.webContents.setBackgroundThrottling(false);
    win.webContents.send('capri:event', { type: 'open-file-access' });
  }, selected);
  page = await settingsView(application, 'files');
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('#file-access-panel:not([hidden])');
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).fileAccess.scopes.length, 0);
  await page.locator('#file-access-add').click({ force: true });
  await page.waitForSelector('.file-scope');
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).fileAccess.scopes[0].write,
    false,
  );
  await page.locator('.file-scope input').check({ force: true });
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).fileAccess.scopes[0].write,
  );
  const saved = JSON.parse(
    readFileSync(path.join(folder, 'desktop/file-permissions.json'), 'utf8'),
  );
  assert.equal(saved.scopes[0].root, selected);
  await page.locator('.file-scope button').click({ force: true });
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).fileAccess.scopes.length === 0,
  );
  assert.equal(
    readFileSync(path.join(folder, 'desktop/file-permissions.json'), 'utf8').includes(selected),
    false,
  );
  assert.deepEqual((await page.evaluate(() => window.capri.bootstrap())).applications, {
    notepad: false,
    calculator: false,
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', { type: 'open-applications' }),
  );
  await page.waitForSelector('#applications-panel:not([hidden])');
  assert.equal(await page.locator('#file-access-panel').isHidden(), true);
  await page.locator('#application-calculator').check({ force: true });
  await page.waitForFunction(async () => (await window.capri.bootstrap()).applications.calculator);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(folder, 'desktop/applications.json'), 'utf8')).settings,
    { notepad: false, calculator: true },
  );
  await page.locator('#application-calculator').uncheck({ force: true });
  await page.waitForFunction(async () => !(await window.capri.bootstrap()).applications.calculator);
  await assert.rejects(
    page.evaluate(() =>
      window.capri.setApplications({ notepad: true, calculator: true, other: true }),
    ),
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).initiative.level, 'off');
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).awareness.active, false);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', { type: 'open-initiative' }),
  );
  await page.waitForSelector('#initiative-panel:not([hidden])');
  await page.locator('#initiative-level').selectOption('occasional');
  await saveSettings(page);
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).initiative.level === 'occasional',
  );
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).awareness.active,
    false,
    'UI verification must not observe real desktop activity',
  );
  await page.locator('#initiative-level').selectOption('off');
  await saveSettings(page);
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).initiative.level === 'off',
  );
  await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    ).webContents;
    const id = '00000000-0000-4000-8000-000000000010',
      message = {
        id: 'owned-initiative-fixture',
        turnId: id,
        role: 'assistant',
        text: 'There you are.',
        status: 'complete',
        createdAt: new Date().toISOString(),
        origin: { kind: 'initiative' },
      };
    contents.send('capri:event', {
      type: 'turn.started',
      turnId: id,
      source: 'initiative',
      assistant: { ...message, text: '', status: 'streaming' },
    });
    contents.send('capri:event', { type: 'turn.delta', turnId: id, text: message.text });
    contents.send('capri:event', { type: 'turn.completed', turnId: id, assistant: message });
  });
  page = primaryPage;
  await page.waitForFunction(
    () => document.getElementById('last-input').textContent === 'A thought of her own.',
  );
  assert.equal(await page.locator('#subtitle-text').textContent(), 'There you are.');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(folder, 'file-access.png') });
  writeFileSync(
    path.join(root, 'logs/file-access-verification.json'),
    JSON.stringify(
      {
        passed: true,
        realNativePickerMocked: true,
        realSettings: true,
        defaultReadOnly: true,
        revocation: true,
        applicationGrants: true,
        folder,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, folder }));
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
