// SPDX-License-Identifier: GPL-3.0-only
// Real Electron quick menu; isolated data, no loaded models or external API calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { LANGUAGE_DEFAULTS } from '../../apps/desktop/renderer/language-settings.mjs';
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'local-load-')),
  report = { passed: false, errors: [], checks: [] };
if (process.argv.includes('--russian')) {
  mkdirSync(path.join(folder, 'desktop'), { recursive: true });
  writeFileSync(
    path.join(folder, 'desktop/languages.json'),
    JSON.stringify({ schemaVersion: 1, settings: { ...LANGUAGE_DEFAULTS, interface: 'ru' } }),
  );
}
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/index.html'))
      .showInactive(),
  );
  const badge = page.locator('#inference-label'),
    menu = page.locator('#inference-picker');
  await badge.click();
  await page.locator('#local-load-enabled').waitFor();
  const enabled = page.locator('#local-load-enabled'),
    range = page.locator('#local-load-percent');
  assert.equal(await enabled.isChecked(), true);
  assert.equal(await range.inputValue(), '85');
  await range.evaluate((input) => {
    input.value = '60';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    async () => (await window.capri.inferenceApiStatus()).localLoad.percent === 60,
  );
  await page.screenshot({ path: path.join(folder, 'local-load-menu.png') });
  await page.keyboard.press('Escape');
  await badge.click();
  assert.equal(await range.inputValue(), '60');
  await enabled.uncheck();
  assert.equal(await range.isDisabled(), true);
  await page.waitForFunction(
    async () => !(await window.capri.inferenceApiStatus()).localLoad.enabled,
  );
  await enabled.check();
  await range.focus();
  await range.press('ArrowLeft');
  assert.equal(await range.inputValue(), '55');
  assert.equal(await menu.isVisible(), true);
  await range.press('Home');
  assert.equal(await range.inputValue(), '10');
  await range.press('End');
  assert.equal(await range.inputValue(), '100');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    async () => (await window.capri.inferenceApiStatus()).localLoad.percent === 100,
  );
  await badge.click();
  assert.equal(await range.inputValue(), '100');
  assert.equal(await enabled.isChecked(), true);
  const rect = await menu.boundingBox();
  assert(rect.x >= 0 && rect.y >= 0);
  assert.deepEqual(report.errors, []);
  report.checks.push(
    '85% default, persisted live updates, on/off and keyboard slider controls work in the Local menu.',
  );
  report.passed = true;
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, folder }));
