// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

using fixture = mkdtempDisposableSync(path.join(root, '.runtime/computer-access-settings-'));
const state = path.join(fixture.path, 'desktop');
mkdirSync(state);
function writePreference(name, settings) {
  writeFileSync(path.join(state, name), JSON.stringify({ schemaVersion: 1, settings }));
}
writePreference('application-access.json', { enabled: false });
writePreference('languages.json', {
  interface: 'fr',
  conversation: 'fr',
  customConversation: '',
  recognition: 'follow',
  speech: 'off',
  autoDetect: false,
});

const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture.path,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
  });
  const main = await app.firstWindow();
  await main.waitForFunction(() => document.body.dataset.phase === 'ready');
  const settings = await settingsView(app, 'computer');
  const status = settings.locator('#computer-access-status');
  const resume = settings.locator('#computer-access-resume');
  const full = settings.locator('#computer-access-toggle');
  const dialog = settings.locator('#confirmation-dialog[open]');
  const access = () => settings.evaluate(() => window.capri.computerAccessStatus());
  assert.match(await status.innerText(), /L'accès aux applications est suspendu\./i);
  assert.equal(await full.isDisabled(), true);
  assert.match(
    await settings.evaluate(() =>
      window.capri.setComputerAccess(true).then(
        () => '',
        (err) => err.message,
      ),
    ),
    /application access is paused/i,
  );
  assert.equal(await dialog.count(), 0);
  console.log('PASS reproduced the French paused state and the host rejects direct full access');

  assert.equal(
    await resume.isVisible(),
    true,
    'Paused access needs a recovery action in Computer settings',
  );
  assert.match(await resume.innerText(), /Activer l'accès aux applications/i);
  await resume.click();
  await settings.waitForFunction(
    async () => (await window.capri.computerAccessStatus()).paused === false,
  );
  assert.equal((await access()).enabled, false);
  assert.equal(await dialog.count(), 0);
  await resume.waitFor({ state: 'hidden' });
  await full.click();
  await dialog.waitFor();
  assert.equal(await dialog.locator('[data-choice="confirm"]').isDisabled(), true);
  await dialog.locator('[data-choice="cancel"]').click();
  await dialog.waitFor({ state: 'hidden' });
  const after = await access();
  assert.equal(after.enabled, false);
  assert.equal(after.paused, false);
  console.log(
    'PASS in-tab recovery resumes application access and full control still requires separate consent',
  );

  await settings.evaluate(async () => {
    await window.capri.setSkill({ id: 'capri.applications', enabled: false });
    await window.capri.applicationAccess(false);
  });
  const applicationsEnabled = () =>
    settings.evaluate(
      async () => (await window.capri.bootstrap()).skills['capri.applications'].enabled,
    );
  assert.equal(await applicationsEnabled(), false);
  await resume.waitFor({ state: 'visible' });
  assert.equal(await full.isDisabled(), true);
  await resume.click();
  await settings.waitForFunction(
    async () => (await window.capri.computerAccessStatus()).paused === false,
  );
  assert.equal(await applicationsEnabled(), true);
  assert.equal((await access()).enabled, false);
  assert.equal(await dialog.count(), 0);
  assert.equal(
    requests.some((request) => request?.includes('/chat')),
    false,
  );
  console.log(
    'PASS the explicit recovery action re-enables the Applications skill without giving full access',
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
