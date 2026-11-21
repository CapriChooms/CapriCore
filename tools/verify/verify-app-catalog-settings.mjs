// SPDX-License-Identifier: GPL-3.0-only
// Saved grants must be visible on the first visit, without adding an app again.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'app-catalog-settings-'));
const state = path.join(folder, 'desktop');
mkdirSync(state);
const app = {
  id: '99c9c52b-a34e-4c7e-b02b-90d190146511',
  name: 'Saved application',
  executable: path.join(folder, 'Saved application.exe'),
  launch: true,
  inspect: true,
  text: false,
};
// No executable is launched and no real application receives permissions.
const catalogFile = path.join(state, 'app-catalog.json');
writeFileSync(catalogFile, JSON.stringify({ schemaVersion: 1, apps: [app] }));
writeFileSync(
  path.join(state, 'applications.json'),
  JSON.stringify({ schemaVersion: 1, settings: { notepad: true, calculator: false } }),
);
const report = { folder, checks: [], errors: [] };
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;

async function tourTargets(settings) {
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  const opener = settings.locator('#settings-guide-open:enabled');
  await opener.waitFor();
  await opener.evaluate((button) => button.click());
  const guide = settings.locator('dialog.settings-guide[open][data-section="applications"]');
  await guide.waitFor();
  return guide.evaluate((dialog) => {
    const targets = [];
    const next = dialog.querySelector('#settings-guide-next');
    while (dialog.open) {
      const step = dialog.dataset.step;
      const target = document.querySelector('[data-settings-guide-highlight]');
      targets.push({
        id: target?.id,
        catalog: Boolean(target?.closest('#catalog-list')),
        permission: Boolean(
          target?.matches('#catalog-list input[type="checkbox"]') &&
            !dialog.querySelector('.guide-spotlight').hidden,
        ),
      });
      next.click();
      if (dialog.open && dialog.dataset.step === step)
        throw new Error('Application guide did not advance');
    }
    return targets;
  });
}

let application;
try {
  for (const attempt of [1, 2]) {
    application = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
      env,
      timeout: 60000,
    });
    application.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.body.dataset.phase === 'ready');
    const settings = await settingsView(application, 'applications');
    const cards = settings.locator('#catalog-list .action-entry');
    assert.equal(await cards.count(), 1, 'Saved applications must appear on first navigation');
    assert.equal(await cards.locator('strong').innerText(), app.name);
    const toggles = cards.locator('input');
    assert.equal(await toggles.nth(0).isChecked(), true);
    assert.equal(await toggles.nth(1).isChecked(), true);
    assert.equal(await toggles.nth(2).isChecked(), attempt === 2);
    assert.equal(await settings.locator('#application-notepad').isChecked(), true);
    assert.equal(await settings.locator('#application-calculator').isChecked(), false);
    if (attempt === 1) {
      await toggles.nth(2).check();
      await settings.waitForFunction(async () => (await window.capri.appCatalog())[0].text);
      assert.equal(JSON.parse(readFileSync(catalogFile, 'utf8')).apps[0].text, true);
      await settingsView(application, 'general');
      await settings.evaluate((id) => window.capri.updateCatalogApp({ id, launch: false }), app.id);
      await settingsView(application, 'applications');
      assert.equal(
        await cards.locator('input').nth(0).isChecked(),
        false,
        'Reopening refreshes grants',
      );
      await cards.locator('input').nth(0).check();
      await settings.waitForFunction(async () => (await window.capri.appCatalog())[0].launch);
    } else {
      const populated = await tourTargets(settings);
      await cards.getByRole('button', { name: 'Remove', exact: true }).click();
      await cards.waitFor({ state: 'detached' });
      const empty = await tourTargets(settings);
      assert.ok(!empty.some(({ catalog }) => catalog), 'The guide targeted an empty app list');
      assert.ok(
        empty.some(({ id }) => id === 'catalog-add'),
        'The guide still explains how to add an app',
      );
      assert.equal(populated.length, empty.length + 1);
      const permissions = populated.filter(({ catalog }) => catalog);
      assert.deepEqual(
        permissions.map(({ permission }) => permission),
        [true],
      );
      report.checks.push(
        'The guide highlights an actual permission and skips it when no apps remain',
      );
    }
    report.checks.push('Saved grants shown and retained: process ' + attempt);
    await application.close();
    application = null;
  }
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
