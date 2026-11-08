// SPDX-License-Identifier: GPL-3.0-only
// Real public desktop startup/IPC with synthetic GitHub responses and optional encrypted access.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/startup-update-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
  logPrefix: 'startup-update-fixture',
});
initialize(rt);
const token = 'ghp_' + 'f'.repeat(40);
const installer = randomBytes(1024);
const tag = 'v99.0.0';
const release = {
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: [
    {
      id: 123,
      name: 'CapriSetup-99.0.0.exe',
      state: 'uploaded',
      size: installer.length,
      digest: 'sha256:' + createHash('sha256').update(installer).digest('hex'),
    },
  ],
};
const entry = path.join(folder, 'entry.mjs');
writeFileSync(
  entry,
  `
const original = globalThis.fetch;
globalThis.updateFixtureRequests = { checks: 0, downloads: 0 };
globalThis.fetch = async (value, options = {}) => {
  const url = new URL(String(value));
  if (url.origin === 'https://api.github.com') {
    const authorization = new Headers(options.headers).get('authorization');
    if (authorization && authorization !== 'Bearer ' + ${JSON.stringify(token)})
      throw Error('Unexpected fixture credential');
    if (url.pathname.endsWith('/releases')) {
      globalThis.updateFixtureRequests.checks++;
      if (process.env.CAPRI_UPDATE_FIXTURE === 'failure') throw Error('Synthetic network failure');
      if (process.env.CAPRI_UPDATE_FIXTURE === 'remove-pending')
        await new Promise((resolve) => { globalThis.finishUpdateFixtureRequest = resolve; });
      return new Response(JSON.stringify(process.env.CAPRI_UPDATE_FIXTURE === 'current' ? [] : [${JSON.stringify(release)}]), { headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/assets/123')) {
      globalThis.updateFixtureRequests.downloads++;
      const bytes = Buffer.from(${JSON.stringify(installer.toString('base64'))}, 'base64');
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    }
    throw Error('Unexpected fixture GitHub request');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    throw Error('External networking is disabled in this fixture');
  return original(value, options);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
let application;
const errors = [];
async function close() {
  if (!application) return;
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await application.close().catch(() => {});
  application = null;
}
async function launch(scenario, enabled = true) {
  await close();
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_UPDATE_CHECK: enabled ? '1' : '0',
    CAPRI_UPDATE_FIXTURE: scenario,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().endsWith('/index.html'),
    );
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
  });
  return page;
}
const requests = () => application.evaluate(() => globalThis.updateFixtureRequests);
const checks = [];
try {
  let page = await launch('available');
  await page.locator('#update-notification').waitFor({ state: 'visible' });
  assert.deepEqual(await requests(), { checks: 1, downloads: 0 });
  assert.equal((await page.evaluate(() => window.capri.updateStatus())).phase, 'available');
  assert.equal((await page.evaluate(() => window.capri.githubStatus())).connected, false);
  checks.push('no token: public release check shows an available update without downloading');

  const ciphertext = await application.evaluate(
    async ({ safeStorage }, value) =>
      (await safeStorage.encryptStringAsync(value)).toString('base64'),
    token,
  );
  const secrets = path.join(folder, 'data/secrets');
  mkdirSync(secrets, { recursive: true });
  writeFileSync(
    path.join(secrets, 'github-updates.json'),
    JSON.stringify({ schemaVersion: 1, ciphertext }),
  );

  page = await launch('current');
  await page.waitForTimeout(300);
  assert.deepEqual(await requests(), { checks: 1, downloads: 0 });
  assert.equal(await page.locator('#update-notification').isVisible(), false);
  assert.notEqual((await page.evaluate(() => window.capri.updateStatus())).phase, 'error');
  checks.push('no newer release: silent');

  page = await launch('failure');
  await page.waitForTimeout(300);
  assert.deepEqual(await requests(), { checks: 1, downloads: 0 });
  assert.equal(await page.locator('#update-notification').isVisible(), false);
  assert.notEqual((await page.evaluate(() => window.capri.updateStatus())).phase, 'error');
  checks.push('network failure: silent');

  page = await launch('available');
  const banner = page.locator('#update-notification');
  await banner.waitFor({ state: 'visible' });
  assert.match(await banner.textContent(), /v99\.0\.0/);
  assert.deepEqual(await requests(), { checks: 1, downloads: 0 });
  await page.screenshot({ path: path.join(folder, 'update-en.png') });
  const languages = await page.evaluate(async () => (await window.capri.bootstrap()).languages);
  await page.evaluate(
    (value) => window.capri.setLanguages({ ...value, interface: 'ru' }),
    languages,
  );
  await page.waitForFunction(() => document.documentElement.lang === 'ru');
  assert.match(await banner.textContent(), /Доступно новое обновление v99\.0\.0/);
  await page.screenshot({ path: path.join(folder, 'update-ru.png') });
  checks.push('available release: one localized, accessible desktop card');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.capri.windowAction('portrait'));
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  async function assertCardFits() {
    const layout = await page.evaluate(() => {
      const card = document.getElementById('update-notification');
      return {
        width: innerWidth,
        height: innerHeight,
        overflow: card.scrollWidth > card.clientWidth,
        rects: [card, ...card.querySelectorAll('button')].map((element) => {
          const { x, y, right, bottom } = element.getBoundingClientRect();
          return { x, y, right, bottom };
        }),
      };
    });
    assert.equal(layout.overflow, false);
    for (const rect of layout.rects) {
      assert(rect.x >= -1 && rect.y >= -1);
      assert(rect.right <= layout.width + 1 && rect.bottom <= layout.height + 1);
    }
  }
  await assertCardFits();
  await page.screenshot({ path: path.join(folder, 'update-ru-compact.png') });
  await page.evaluate(
    (value) => window.capri.setLanguages({ ...value, interface: 'ar' }),
    languages,
  );
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await assertCardFits();
  await page.screenshot({ path: path.join(folder, 'update-ar-compact.png') });
  await page.evaluate(
    (value) => window.capri.setLanguages({ ...value, interface: 'ru' }),
    languages,
  );
  await page.waitForFunction(() => document.documentElement.lang === 'ru');
  checks.push('compact layout, RTL and reduced motion keep all actions within the window');

  await banner.getByRole('button', { name: 'Напомнить позже', exact: true }).click();
  await banner.waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.capri.updateStatus())).notification, null);
  assert.deepEqual(await requests(), { checks: 1, downloads: 0 });
  checks.push('remind later hides the notice without downloading');

  page = await launch('available');
  await page.locator('#update-notification').waitFor({ state: 'visible' });
  checks.push('next real app launch reminds again');
  const settingsOpened = application.waitForEvent('window', {
    predicate: (candidate) => candidate !== page,
    timeout: 15000,
  });
  await page
    .locator('#update-notification')
    .getByRole('button', { name: 'Обновить', exact: true })
    .click();
  await page.waitForFunction(async () => (await window.capri.updateStatus()).phase === 'ready');
  const settings = await settingsOpened;
  await settings.waitForURL('capri://desktop/settings.html');
  await settings.locator('#updates-install').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#update-notification').isVisible(), false);
  assert.deepEqual(await requests(), { checks: 1, downloads: 1 });
  assert.equal((await page.evaluate(() => window.capri.updateStatus())).phase, 'ready');
  checks.push(
    'update button opens Settings and downloads verified bytes without executing installer',
  );
  page = await launch('remove-pending');
  await application.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.finishUpdateFixtureRequest) {
      if (Date.now() > deadline) throw Error('Startup request did not begin');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  await page.evaluate(() => window.capri.removeGitHub());
  await application.evaluate(() => globalThis.finishUpdateFixtureRequest());
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.capri.githubStatus())).connected, false);
  assert.equal(await page.locator('#update-notification').isVisible(), false);
  assert.equal((await page.evaluate(() => window.capri.updateStatus())).notification, null);
  checks.push('removing the token cancels an in-flight startup notice');
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    checks,
    ownerDataAccessed: false,
    installerExecuted: false,
    screenshots: folder,
  };
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
