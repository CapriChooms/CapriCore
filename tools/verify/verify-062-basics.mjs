// SPDX-License-Identifier: GPL-3.0-only
// Owned windows and synthetic files only; no physical microphone, model or desktop capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';
const parent = path.join(root, '.runtime/0.6.2/visual');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  TEMP: parent,
  TMP: parent,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
const report = { checks: [], errors: [], folder };
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await page.locator('[data-quick="applications"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-quick="applications"]').getAttribute('aria-pressed') ===
      'false',
  );
  assert.equal(
    application.windows().filter((page) => page.url().includes('settings.html')).length,
    0,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(folder, 'desktop/application-access.json'), 'utf8')).settings
      .enabled,
    false,
  );
  await page.locator('[data-quick="applications"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-quick="applications"]').getAttribute('aria-pressed') === 'true',
  );
  report.checks.push('Toolbar toggles actual access without opening Settings');
  await page.evaluate(() => window.capri.windowAction('hide'));
  let chip;
  for (let attempt = 0; attempt < 50; attempt++) {
    chip = application.windows().find((view) => view.url().includes('minimized-chip.html'));
    if (chip) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(chip);
  await chip.locator('button').click();
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible');
  report.checks.push('Static restore chip returns the owned companion window');
  await page.evaluate(() => window.capri.windowAction('focus-mode', true));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (view) => view.webContents.getURL().includes('minimized-chip.html') && view.isVisible(),
      ),
    ),
    false,
  );
  await page.evaluate(() => window.capri.windowAction('focus-mode', false));
  report.checks.push('Focus mode remains fully hidden without a restore chip');
  const settings = await settingsView(application, 'knowledge');
  await settings
    .locator('#knowledge-panel')
    .screenshot({ path: path.join(folder, 'knowledge.png') });
  await settings.locator('#private-password').fill('visual-test-password');
  await settings.locator('#private-unlock').click();
  await settings.locator('#private-open').waitFor({ state: 'visible' });
  await settings.locator('#private-note').fill('Synthetic private cake: vanilla.');
  await settings.locator('#private-save').click();
  await settings.locator('#private-notes li').waitFor();
  assert(
    !readFileSync(path.join(folder, 'desktop/private-memory.enc.json'), 'utf8').includes('vanilla'),
  );
  await settings.locator('#private-lock').click();
  await settings.locator('#private-open').waitFor({ state: 'hidden' });
  assert.equal(await settings.locator('#private-notes').innerText(), '');
  report.checks.push('Private memory controls create, encrypt, save and clear on lock');
  writeFileSync(
    path.join(folder, 'brain/Recipe.txt'),
    'A synthetic cloudberry cake needs 210 grams of flour.',
  );
  await settings.locator('#brain-refresh').click();
  await settings.waitForFunction(async () => {
    const value = await window.capri.brainAction({ action: 'status' });
    return !value.busy && value.indexed === 1;
  });
  await settings.locator('#brain-query').fill('cloudberry cake');
  await settings.locator('#brain-search').click();
  const knowledgeResult = await settings.evaluate(async () => {
    try {
      return {
        state: await window.capri.brainAction({ action: 'status' }),
        direct: await window.capri.brainAction({ action: 'search', query: 'cloudberry cake' }),
        ui: document.querySelector('#brain-results').textContent,
        notice: document.querySelector('#settings-notice').textContent,
      };
    } catch (error) {
      return {
        error: error.message,
        notice: document.querySelector('#settings-notice').textContent,
      };
    }
  });
  assert(
    knowledgeResult.direct?.some((row) => row.content.includes('210 grams')),
    JSON.stringify(knowledgeResult),
  );
  await settings.waitForFunction(() =>
    document.querySelector('#brain-results').textContent.includes('210 grams'),
  );
  report.checks.push('Brain worker indexes a synthetic recipe and displays its source');
  await settingsView(application, 'dialogue');
  await settings.locator('#memory-view').click();
  await settings.locator('#saved-memory-new').fill('Synthetic favourite cake is cloudberry.');
  await settings.locator('#saved-memory-add').click();
  await settings.waitForFunction(() =>
    document.querySelector('#saved-memory-receipt').textContent.includes('verified'),
  );
  await settingsView(application, 'applications');
  await settings
    .locator('#applications-panel')
    .screenshot({ path: path.join(folder, 'applications.png') });
  report.checks.push('Direct memory save confirms a real write');
  await settingsView(application, 'workflows');
  await settings.locator('#workflow-record').click();
  await settings.waitForFunction(() => !document.querySelector('#workflow-stop').disabled);
  let indicator;
  for (let attempt = 0; attempt < 60; attempt++) {
    indicator = application
      .windows()
      .find((view) => view.url().includes('recording-indicator.html'));
    if (indicator) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(indicator, 'Recording needs a visible independent stop control');
  await indicator.locator('b').click();
  await settings.waitForFunction(() => !document.querySelector('#workflow-record').disabled);
  await settings
    .locator('#workflows-panel')
    .screenshot({ path: path.join(folder, 'workflows.png') });
  report.checks.push('Task training starts a hidden recorder and stops from its visible indicator');
  await settings.locator('#workflow-record').click();
  await settings.waitForFunction(() => !document.querySelector('#workflow-stop').disabled);
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL().includes('recording-indicator.html'))
      .close();
  });
  await settings.waitForFunction(() => !document.querySelector('#workflow-record').disabled);
  report.checks.push('Closing the recording indicator stops recording safely');
  await settingsView(application, 'user-tools');
  await settings.locator('#user-tools-example').click();
  await settings.locator('#user-tools-list article').waitFor();
  const tool = settings.locator('#user-tools-list article').first();
  await tool.locator('button').first().click();
  await settings.waitForFunction(
    () =>
      document.querySelector('#user-tools-list article button').getAttribute('aria-pressed') ===
      'true',
  );
  await settings
    .locator('#user-tools-list article textarea')
    .fill('{"text":"Synthetic visual tool test"}');
  await settings.locator('#user-tools-list article button').last().click();
  await settings.waitForFunction(() =>
    document
      .querySelector('#user-tools-list pre')
      .textContent.includes('Synthetic visual tool test'),
  );
  await settings
    .locator('#user-tools-panel')
    .screenshot({ path: path.join(folder, 'user-tools.png') });
  report.checks.push('User tools UI creates, enables and runs the isolated example');
  await settings
    .locator('#user-tools-panel')
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settings.screenshot({ path: path.join(folder, 'user-tools-viewport.png') });
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
