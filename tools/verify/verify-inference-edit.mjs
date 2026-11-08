// SPDX-License-Identifier: GPL-3.0-only
/** Owned settings UI and isolated encrypted fixtures; no provider or restart. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';
const parent = path.join(root, '.runtime/inference-edit-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `import { InferenceApi } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/inference-api.mjs')).href)};
globalThis.ApiEditClass = InferenceApi;
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
  const owner = await app.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  const fixture = await app.evaluate(
    async ({ ipcMain }, { module, folder }) => {
      const InferenceApi = globalThis.ApiEditClass;
      const storage = {
        available: async () => true,
        encrypt: async (s) => Buffer.from(s).reverse(),
        decrypt: async (b) => Buffer.from(b).reverse().toString(),
      };
      let service = new InferenceApi({ root: folder, storage });
      const settings = {
        enabled: true,
        baseUrl: 'https://one.example/v1',
        model: 'first-model',
        vision: false,
        tools: true,
        contextTokens: 32768,
      };
      const key = 'fixture-key-for-edit-test';
      const activeId = await service.saveProfile({ name: 'Active preview', settings, key });
      const editId = await service.saveProfile({
        name: 'Second preview',
        settings: {
          ...settings,
          baseUrl: 'https://two.example/v1',
          model: 'second-model',
          vision: true,
          tools: false,
          contextTokens: 65536,
        },
        key,
      });
      await service.selectProfile(activeId);
      service = new InferenceApi({ root: folder, storage });
      globalThis.apiEditFixture = {
        service,
        editId,
        activeId,
        saves: 0,
        cancellations: 0,
        original: JSON.stringify(service.profile(editId).credential),
      };
      for (const channel of ['capri:inference-api-status', 'capri:inference-api-save'])
        ipcMain.removeHandler(channel);
      ipcMain.handle('capri:inference-api-status', () => service.status());
      ipcMain.handle('capri:inference-api-save', async (_event, value) => {
        if (value.id === activeId) {
          globalThis.apiEditFixture.cancellations++;
          return false;
        }
        globalThis.apiEditFixture.saves++;
        return service.saveProfile(value);
      });
      return { editId, activeId };
    },
    {
      module: pathToFileURL(path.join(root, 'apps/desktop/inference-api.mjs')).href,
      folder: path.join(folder, 'profile-fixture'),
    },
  );
  const page = await settingsView(app, 'api');
  page.on('pageerror', (error) => report.errors.push(error.message));
  const card = (name) =>
    page.locator('.api-connection').filter({ has: page.getByText(name, { exact: true }) });
  await card('Second preview').getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('#api-name').inputValue(), 'Second preview');
  assert.equal(await page.locator('#api-model').inputValue(), 'second-model');
  assert.equal(await page.locator('#api-context').inputValue(), '65536');
  assert.equal(await page.locator('#api-vision').isChecked(), true);
  assert.equal(await page.locator('#api-tools').isChecked(), false);
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.match(await page.locator('#api-key').getAttribute('placeholder'), /Encrypted/);
  await page
    .locator('#api-form')
    .evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(folder, 'editing.png') });
  await page.locator('#api-name').fill('Edited preview');
  await page.locator('#api-model').fill('updated-model');
  await page.locator('#api-context').fill('98304');
  await page.locator('#api-save').click();
  await page.locator('#api-form').waitFor({ state: 'hidden' });
  const saved = await app.evaluate(() => {
    const { service, editId, original } = globalThis.apiEditFixture;
    const p = service.profile(editId);
    return {
      count: service.readProfiles().length,
      active: service.activeProfileId(),
      id: p.id,
      name: p.name,
      settings: p.settings,
      kept: JSON.stringify(p.credential) === original,
    };
  });
  assert.equal(saved.count, 2);
  assert.equal(saved.id, fixture.editId);
  assert.equal(saved.active, fixture.activeId);
  assert.equal(saved.kept, true);
  assert.equal(saved.name, 'Edited preview');
  assert.equal(saved.settings.model, 'updated-model');
  assert.equal(saved.settings.contextTokens, 98304);
  assert.equal(
    await card('Edited preview').getByRole('button', { name: 'Edit', exact: true }).isEnabled(),
    true,
  );
  report.checks.push(
    'Saved fields populate; same id/count, encrypted key and active selection survive edits',
  );
  await card('Edited preview').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#api-url').fill('https://changed.example/v1');
  await page.locator('#api-save').click();
  await page
    .getByText('Enter a new API key when changing the provider address.', { exact: true })
    .first()
    .waitFor();
  assert.equal(await app.evaluate(() => globalThis.apiEditFixture.saves), 1);
  await page.locator('#api-key').fill('replacement-fixture-key');
  await page.locator('#api-save').click();
  await page.locator('#api-form').waitFor({ state: 'hidden' });
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.apiEditFixture.service.profile(globalThis.apiEditFixture.editId).settings
          .baseUrl,
    ),
    'https://changed.example/v1',
  );
  report.checks.push('Provider address change is blocked until a replacement key is supplied');
  await card('Active preview').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#api-model').fill('cancelled-model');
  await page.locator('#api-save').click();
  await page.waitForFunction(() => !document.getElementById('api-save').disabled);
  assert.equal(await app.evaluate(() => globalThis.apiEditFixture.cancellations), 1);
  assert.equal(await page.locator('#api-form').isVisible(), true);
  assert.equal(await page.locator('#api-model').inputValue(), 'cancelled-model');
  await page.locator('#api-cancel').click();
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.apiEditFixture.service.profile(globalThis.apiEditFixture.activeId).settings
          .model,
    ),
    'first-model',
  );
  report.checks.push('Cancelling active apply keeps the form draft and original active connection');
  await card('Edited preview').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#api-add').click();
  assert.equal(await page.locator('#api-form').isVisible(), true);
  assert.equal(await page.locator('#api-name').inputValue(), '');
  assert.equal(await page.locator('#api-key').inputValue(), '');
  await page.locator('#api-cancel').click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/settings.html'))
      .setContentSize(480, 620),
  );
  await page.screenshot({ path: path.join(folder, 'connections-narrow.png') });
  assert(await page.locator('#companion').evaluate((n) => n.scrollWidth <= n.clientWidth + 2));
  const publicStatus = await app.evaluate(() => globalThis.apiEditFixture.service.status());
  assert(!JSON.stringify(publicStatus).includes('fixture-key'));
  assert(!JSON.stringify(publicStatus).includes('ciphertext'));
  assert.equal(await page.locator('#api-key').inputValue(), '');
  assert.deepEqual(report.errors, []);
  report.checks.push(
    'Add/cancel remain separate, narrow layout fits, saved secrets never enter UI status',
  );
  report.passed = true;
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
