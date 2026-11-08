// SPDX-License-Identifier: GPL-3.0-only
// Deliberately hold the renderer's first UI frames: native ready-to-show is not
// proof that the dynamically built settings category has been painted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'settings-first-open-'));
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
let application;
try {
  for (const section of ['general', 'model-context']) {
    application = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
      env,
      timeout: 60000,
    });
    application.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.body.dataset.phase === 'ready');
    await page.context().addInitScript(() => {
      if (!location.pathname.endsWith('/settings.html')) return;
      const frame = window.requestAnimationFrame.bind(window),
        queued = [];
      window.requestAnimationFrame = (callback) => {
        queued.push(callback);
        return 0;
      };
      window.releaseSettingsFrames = () => {
        window.requestAnimationFrame = frame;
        for (const callback of queued.splice(0)) frame(callback);
      };
    });
    const opened = application.waitForEvent('window');
    await page.evaluate((section) => window.capri.openSettings(section), section);
    const settings = await opened;
    await settings.waitForFunction(
      () => document.querySelector('#settings-navigation [aria-current="page"]'),
      null,
      { polling: 50 },
    );
    const visible = () =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/settings.html'))
          .isVisible(),
      );
    assert.equal(await visible(), false, 'Unpainted forms must not expose a blank native window');
    await settings.evaluate(() => window.releaseSettingsFrames());
    await application.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/settings.html'),
      );
      if (!view.isVisible())
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Settings frame never presented')), 10000);
          view.once('show', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
    });
    assert.equal(await visible(), true);
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/settings.html'))
          .webContents.getBackgroundThrottling(),
      ),
      false,
    );
    const expected = section === 'model-context' ? 'models' : section;
    assert.equal(
      await settings
        .locator('#settings-navigation [aria-current="page"]')
        .getAttribute('data-section'),
      expected,
    );
    if (section === 'model-context')
      assert.equal(await settings.evaluate(() => document.activeElement.id), 'models-context');
    await settings.screenshot({ path: path.join(folder, section + '.png') });
    await settings.locator('#settings-window-close').click();
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/settings.html'))
          .webContents.getBackgroundThrottling(),
      ),
      true,
    );
    await page.evaluate(() => window.capri.openSettings('general'));
    assert.equal(await visible(), true);
    await page.evaluate(() => window.capri.hide());
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/index.html'))
        .showInactive(),
    );
    assert.equal(await visible(), false, 'Tray restore must not resurrect settings');
    report.checks.push('Fresh process, delayed frames, reopen and tray: ' + section);
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
