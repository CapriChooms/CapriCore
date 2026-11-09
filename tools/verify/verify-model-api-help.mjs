// SPDX-License-Identifier: GPL-3.0-only
/** Owned native Settings, no remote requests, credentials, model loading or restarts. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/model-api-help-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `import { ModelDeviceService } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/model-device-service.mjs')).href)};
ModelDeviceService.prototype.inspect = async function () {
  const choices = () => [{id:'auto',name:'Automatic',available:true},{id:'cpu',name:'CPU',available:true}];
  return {current:this.current(),options:{language:choices(),voice:choices()}};
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});`,
);
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  TEMP: folder,
  TMP: folder,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const report = { passed: false, folder, checks: [], errors: [] };
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  const primary = await app.firstWindow();
  await primary.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ shell }) => {
    globalThis.openedModelFolders = [];
    shell.openPath = async (folder) => {
      globalThis.openedModelFolders.push(folder);
      return '';
    };
  });
  let page = await settingsView(app, 'models');
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(
    () => document.querySelector('#model-device-language').options.length > 0,
  );
  await page.locator('#models-folder').click();
  await page.waitForFunction(() => !document.getElementById('models-folder').disabled);
  assert.equal(
    await app.evaluate(() => globalThis.openedModelFolders.at(-1)),
    path.join(root, 'data/models'),
  );
  assert.equal(
    await page.evaluate(() =>
      window.capri.openModelsFolder('../workspace').then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  assert.equal(await app.evaluate(() => globalThis.openedModelFolders.length), 1);
  await page.evaluate(() => window.capri.openModelsFolder('huggingface'));
  assert.equal(
    await app.evaluate(() => globalThis.openedModelFolders.at(-1)),
    path.join(root, 'data/huggingface'),
  );
  report.checks.push('Settings opens both fixed model stores; arbitrary paths are rejected');
  await page.locator('#models-folder').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, 'models-en.png') });
  await page.locator('[data-section="api"]').click();
  await page.locator('#api-add').click();
  assert.equal(await page.locator('#inference-panel h2').innerText(), 'API connections');
  assert.equal(await page.locator('#api-guide').getAttribute('open'), '');
  assert.equal(await page.locator('#api-guide li').count(), 3);
  for (const field of ['name', 'url', 'model', 'key', 'context'])
    assert(await page.locator('#api-' + field).getAttribute('placeholder'), field);
  assert.equal(await page.locator('#api-model').inputValue(), '');
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.match(
    await page.locator('#api-model').getAttribute('placeholder'),
    /provider\/model-name/,
  );
  await page.selectOption('#api-provider', 'gemini');
  assert.match(await page.locator('#api-key').getAttribute('placeholder'), /AIza/);
  assert.match(await page.locator('#api-name').getAttribute('placeholder'), /Google Gemini/);
  assert.equal(await page.locator('#api-key').inputValue(), '');
  await page.selectOption('#api-provider', 'openrouter');
  await page.locator('#api-form').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(folder, 'api-en.png') });
  report.checks.push(
    'Guide and provider-specific examples are visible; examples never become input values',
  );
  await page.evaluate(async () => {
    const value = await window.capri.bootstrap();
    return window.capri.setLanguages(
      { ...value.languages, interface: 'ru' },
      value.settingsVersions.languages,
    );
  });
  await page.waitForFunction(() => document.documentElement.lang === 'ru');
  assert.equal(await page.locator('#inference-panel h2').innerText(), 'Подключения API');
  assert.match(await page.locator('#api-model').getAttribute('placeholder'), /^Пример:/);
  assert.equal(await page.locator('#api-guide summary').innerText(), 'Как подключить API');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#api-form').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(folder, 'api-ru.png') });
  report.checks.push(
    'Russian labels and examples update immediately; no horizontal window overflow',
  );
  await page.locator('[data-section="models"]').click();
  assert.equal(await page.locator('#models-folder').innerText(), 'Открыть папку моделей');
  await page.locator('#models-folder').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, 'models-ru.png') });
  await page.locator('[data-section="api"]').click();
  await page.locator('#api-form').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (item) => item.webContents.getURL() === 'capri://desktop/settings.html',
    );
    window.setTitle('Capri API preview (local)');
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (process.argv.includes('--preview')) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !existsSync(path.join(folder, 'close-preview')))
      await delay(250);
  }
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
