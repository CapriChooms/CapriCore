// SPDX-License-Identifier: GPL-3.0-only
/** Native UI and Windows credential fixture; no real GitHub token, GPU models or owner history. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { GitHubAccess, credentialStorage } from '../../apps/desktop/github-access.mjs';
import { saveSettings, settingsView } from './settings-view.mjs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
const parent = path.join(root, '.runtime/v036-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-')),
  errors = [],
  checks = [];
const server = createServer((req, res) => {
  req.resume();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port,
  rt = runtime({
    workspace: path.join(folder, 'workspace'),
    stateDir: path.join(folder, 'openclaw'),
    gatewayPort: port,
    logPrefix: 'v036-verification',
  });
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await page.locator('#presence-toggle').click({ force: true });
  const controls = await settingsView(application, 'dialogue');
  controls.on('pageerror', (error) => errors.push(error.message));
  const original = readFileSync(path.join(rt.workspace, 'PERSONALITY.md'), 'utf8');
  for (const style of ['romantic', 'business', 'wild', 'neutral']) {
    await controls.locator('#communication-style').selectOption(style);
    await saveSettings(controls);
    await controls.waitForFunction(
      async (style) => (await window.capri.getPersonality()).communicationStyle === style,
      style,
    );
  }
  assert.equal(readFileSync(path.join(rt.workspace, 'PERSONALITY.md'), 'utf8'), original);
  checks.push('all four styles save through real IPC without rewriting Personality');
  const hover = async (selector) => {
    const button = controls.locator(selector);
    await button.scrollIntoViewIfNeeded();
    await controls.mouse.move(1, 1);
    const before = await button.evaluate((node) => ({
      filter: getComputedStyle(node).filter,
      outline: getComputedStyle(node).outlineStyle,
    }));
    await button.hover({ force: true });
    await controls.waitForTimeout(180);
    const after = await button.evaluate((node) => ({
      filter: getComputedStyle(node).filter,
      outline: getComputedStyle(node).outlineStyle,
    }));
    assert.notDeepEqual(after, before, 'Missing hover feedback: ' + selector);
  };
  await controls.locator('#personality-text').fill('Synthetic draft for hover verification.');
  await controls.locator('#settings-window-close').click();
  await hover('#settings-apply');
  await controls.locator('#settings-discard').click();
  await controls.locator('#settings-draft-actions').waitFor({ state: 'hidden' });
  await settingsView(application, 'updates');
  await controls.locator('#updates-panel').waitFor({ state: 'visible' });
  await hover('#updates-check');
  await controls.locator('#updates-access-details > summary').click({ force: true });
  await hover('#updates-connect');
  assert.equal(await controls.locator('#updates-token').getAttribute('type'), 'password');
  checks.push(
    'settings/update/auth controls have visible hover feedback and token entry is masked',
  );
  const nativeStorage = {
    isAsyncEncryptionAvailable: () =>
      application.evaluate(({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable()),
    encryptStringAsync: async (value) =>
      Buffer.from(
        await application.evaluate(
          async ({ safeStorage }, text) =>
            (await safeStorage.encryptStringAsync(text)).toString('base64'),
          value,
        ),
        'base64',
      ),
    decryptStringAsync: (value) =>
      application.evaluate(
        ({ safeStorage }, encoded) =>
          safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64')),
        value.toString('base64'),
      ),
  };
  const access = new GitHubAccess({
    root: path.join(folder, 'auth-fixture'),
    storage: credentialStorage(nativeStorage),
    verify: async () => [],
  });
  const fixtureToken = 'github_pat_' + 'fixture'.repeat(8),
    authStatus = await access.connect(fixtureToken);
  const encrypted = {
    connected: authStatus.connected,
    notPlaintext: !readFileSync(access.file, 'utf8').includes(fixtureToken),
    roundTrip: (await access.credential()) === fixtureToken,
  };
  await access.remove();
  encrypted.removed = !existsSync(access.file);
  assert.deepEqual(encrypted, {
    connected: true,
    notPlaintext: true,
    roundTrip: true,
    removed: true,
  });
  checks.push(
    'real Electron 45 Windows encrypted storage persists and decrypts a fixture token; no real credential used',
  );
  await controls.locator('#updates-panel').evaluate((node) => node.remove());
  await controls.evaluate(async () => {
    const { UpdatesPanel } = await import('./updates-panel.mjs');
    const record = { checks: 0, saved: false };
    const status = { phase: 'idle', current: 'v0.3.6', mode: 'managed', experimental: false };
    const panel = new UpdatesPanel({
      api: {
        updateStatus: async () => status,
        githubStatus: async () => ({ connected: false, secureStorage: true }),
        connectGitHub: async (value) => {
          if (record.deny)
            throw new Error(
              'GitHub access is unavailable for this private repository. Connect GitHub in Updates and check your Capri invitation and token approval.',
            );
          record.saved = value.startsWith('github_pat_');
          await new Promise((resolve) => (record.releaseConnect = resolve));
          return { connected: true, secureStorage: true };
        },
        checkUpdates: async () => {
          record.checks++;
          return { ...status, phase: 'current' };
        },
        removeGitHub: async () => ({ connected: false, secureStorage: true }),
        openGitHubTokenPage: async (kind) => {
          record.tokenKind = kind;
          return true;
        },
      },
      ui: { text: (key) => key, apply: () => {}, language: 'en' },
      onOpen: async () => true,
      onError: (error) => {
        throw new Error(error);
      },
    });
    window.v036Updates = { panel, record };
    await panel.open(true);
  });
  await controls.locator('#updates-access-details > summary').click({ force: true });
  await controls.locator('#updates-token').fill('github_pat_' + 'fixture'.repeat(7));
  await controls.locator('#updates-connect').click({ force: true });
  await controls.waitForFunction(() => Boolean(window.v036Updates.record.releaseConnect));
  for (const id of ['check', 'experimental', 'connect', 'forget', 'token'])
    assert.equal(await controls.locator('#updates-' + id).isDisabled(), true);
  await controls.evaluate(() => window.v036Updates.record.releaseConnect());
  await controls.waitForFunction(() => window.v036Updates.record.checks === 1);
  await controls.waitForFunction(() => !document.getElementById('updates-check').disabled);
  assert.equal(await controls.locator('#updates-token').inputValue(), '');
  assert.equal(await controls.evaluate(() => window.v036Updates.record.saved), true);
  await controls.locator('#updates-access-details > summary').click({ force: true });
  await controls.locator('#updates-token').fill('github_pat_' + 'fixture'.repeat(7));
  await controls.evaluate(() => window.v036Updates.panel.open(false));
  assert.equal(await controls.locator('#updates-token').inputValue(), '');
  checks.push('connect saves then checks updates and clears token input on submit or close');
  await controls.evaluate(async () => {
    window.v036Updates.record.deny = true;
    await window.v036Updates.panel.open(true);
    document.getElementById('updates-access-details').open = true;
  });
  await controls.locator('#updates-token').fill('github_pat_' + 'fixture'.repeat(7));
  await controls.locator('#updates-connect').click({ force: true });
  await controls.waitForFunction(() => !window.v036Updates.panel.accessBusy);
  assert.equal(await controls.locator('#updates-access-help').evaluate((node) => node.open), true);
  assert.equal(await controls.locator('#updates-token').inputValue(), '');
  await controls.locator('#updates-classic-token-page').click({ force: true });
  assert.equal(await controls.evaluate(() => window.v036Updates.record.tokenKind), 'classic');
  assert.equal(await controls.evaluate(() => window.capri.openGitHubTokenPage('classic')), true);
  await assert.rejects(
    controls.evaluate(() => window.capri.openGitHubTokenPage('https://untrusted.test')),
  );
  checks.push(
    'denied access reveals outside-collaborator help and a fixed classic-token choice; no real token or browser navigation',
  );
  await controls.evaluate(() => window.capri.closeSettings());
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', {
        type: 'backend',
        phase: 'offline',
        message: 'Disconnected fixture',
      }),
  );
  await page.waitForFunction(
    () =>
      document.body.dataset.sleeping === 'true' &&
      document.getElementById('sprite').dataset.frame === 'idle-blink_closed',
  );
  assert.equal(await page.locator('#sleep-indicator').isVisible(), true);
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).power.phase,
    'awake',
    'Resting artwork must not fake model unload',
  );
  await page.waitForFunction(() =>
    /^[zZ]{3}\.{1,3}$/.test(document.getElementById('sleep-indicator').textContent),
  );
  await page.screenshot({ path: path.join(folder, 'disconnected.png') });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', {
        type: 'backend',
        phase: 'ready',
        message: 'Connected fixture',
      }),
  );
  await page.waitForFunction(() => document.body.dataset.sleeping === 'false');
  assert.equal(await page.locator('#sleep-indicator').isVisible(), false);
  checks.push(
    'disconnect shows closed eyes and Zzz, reconnect restores normal visuals without changing power state',
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    folder,
    checks,
    realGitHubAccess: false,
    ownerHistoryChanged: false,
  };
  writeFileSync(path.join(folder, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  writeFileSync(path.join(folder, 'failure.txt'), error.stack);
  await application
    ?.windows()[0]
    ?.screenshot({ path: path.join(folder, 'failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await application?.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
