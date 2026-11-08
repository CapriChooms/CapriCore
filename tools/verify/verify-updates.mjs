// SPDX-License-Identifier: GPL-3.0-only
// Real Electron UI and IPC; isolated profile, synthetic GitHub bytes. No update is executed.
import { saveSettings } from './settings-view.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
const parent = path.join(root, '.runtime/update-ui-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
  logPrefix: 'update-verification',
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
const fixtureToken = 'ghp_' + 'f'.repeat(40);
const fixtureInstaller = randomBytes(20000);
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(
    async ({ BrowserWindow }, { digest, token, fixture }) => {
      const window = BrowserWindow.getAllWindows().find(
        (item) => item.webContents.getURL() === 'capri://desktop/index.html',
      );
      window.webContents.setBackgroundThrottling(false);
      window.showInactive();
      const bytes = Buffer.from(fixture, 'base64');
      const original = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        const address = String(url);
        const authorization = new Headers(options.headers).get('authorization');
        if (authorization && authorization !== 'Bearer ' + token)
          throw Error('Unexpected fixture credential');
        if (
          address.startsWith('https://api.github.com/repos/CapriChooms/CapriCore/releases/assets/')
        ) {
          let at = 0;
          return new Response(
            new ReadableStream({
              async pull(controller) {
                await new Promise((resolve) => setTimeout(resolve, 70));
                if (at >= bytes.length) {
                  controller.close();
                  return;
                }
                controller.enqueue(bytes.subarray(at, at + 1000));
                at += 1000;
              },
            }),
            { headers: { 'content-length': String(bytes.length) } },
          );
        }
        if (address.startsWith('https://api.github.com/repos/CapriChooms/CapriCore/releases?'))
          return new Response(
            JSON.stringify([
              {
                tag_name: 'v99.0.0',
                prerelease: true,
                draft: false,
                assets: [
                  {
                    id: 123,
                    name: 'CapriSetup-99.0.0.exe',
                    state: 'uploaded',
                    size: bytes.length,
                    digest: 'sha256:' + digest,
                  },
                ],
              },
            ]),
          );
        return original(url, options);
      };
    },
    {
      digest: createHash('sha256').update(fixtureInstaller).digest('hex'),
      token: fixtureToken,
      fixture: fixtureInstaller.toString('base64'),
    },
  );
  await page.evaluate(() => window.capri.openSettings('updates'));
  const settings = application
    .windows()
    .find((candidate) => candidate.url().endsWith('/settings.html'));
  assert(settings, 'Settings window was not opened.');
  settings.on('pageerror', (error) => errors.push(error.message));
  await settings.locator('#updates-panel').waitFor({ state: 'visible' });
  await settings.locator('#updates-check').click();
  await settings.waitForFunction(
    async () => (await window.capri.updateStatus()).phase === 'current',
  );
  assert.equal((await settings.evaluate(() => window.capri.githubStatus())).connected, false);
  // Auth IPC is deliberately disabled in verification. Seed only this isolated
  // profile with a synthetic Windows-encrypted credential.
  const ciphertext = await application.evaluate(
    async ({ safeStorage }, token) =>
      (await safeStorage.encryptStringAsync(token)).toString('base64'),
    fixtureToken,
  );
  const secrets = path.join(folder, 'data', 'secrets');
  mkdirSync(secrets, { recursive: true });
  writeFileSync(
    path.join(secrets, 'github-updates.json'),
    JSON.stringify({ schemaVersion: 1, ciphertext }),
  );
  await settings.locator('#updates-check').click();
  await settings.waitForFunction(
    async () => (await window.capri.updateStatus()).phase === 'current',
  );
  assert.equal((await settings.evaluate(() => window.capri.githubStatus())).connected, true);
  await settings.locator('#updates-experimental').check();
  assert.equal((await settings.evaluate(() => window.capri.updateStatus())).experimental, false);
  await settings.locator('#updates-check').click();
  await settings.locator('#updates-download').waitFor({ state: 'visible' });
  await saveSettings(settings);
  await settings.waitForFunction(async () => (await window.capri.updateStatus()).experimental);
  await settings.locator('#updates-download').click();
  await settings.locator('#updates-progress').waitFor({ state: 'visible' });
  await settings.screenshot({ path: path.join(folder, 'downloading.png') });
  await settings.locator('#updates-install').waitFor({ state: 'visible' });
  assert.equal((await settings.evaluate(() => window.capri.updateStatus())).phase, 'ready');
  assert.equal(await settings.locator('#updates-release').textContent(), 'v99.0.0');
  assert.equal(await settings.locator('#updates-install').textContent(), 'Open installer');
  assert.equal(
    await settings.evaluate(() =>
      window.capri.installUpdate().then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  await settings.screenshot({ path: path.join(folder, 'ready-en.png') });
  await settings.locator('[data-section="languages"]').click();
  await settings.locator('#language-interface').selectOption('ru');
  await saveSettings(settings);
  await settings.waitForFunction(() => document.documentElement.lang === 'ru');
  await settings.locator('[data-section="updates"]').click();
  await settings.waitForFunction(() =>
    document.getElementById('updates-status').textContent.includes('готово'),
  );
  await settings.screenshot({ path: path.join(folder, 'ready-ru.png') });
  assert.equal(await settings.locator('#updates-experimental').isChecked(), true);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'public update checks without a GitHub token',
        'optional Windows-encrypted GitHub credential remains supported',
        'stable and experimental channel selection',
        'verified download over real IPC',
        'progress display',
        'safe development-checkout mode',
        'Russian interface',
        'persistent experimental setting',
        'installer execution disabled in verification',
      ],
      screenshots: folder,
      ownerDataAccessed: false,
    }),
  );
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
