// SPDX-License-Identifier: GPL-3.0-only
// Hold content hydration and the first three compositor captures. One click
// must still show the loading shell, recover, and present the populated form.
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
    await application.evaluate(({ app, nativeImage }) => {
      app.on('browser-window-created', (_event, view) => {
        if (view.getTitle() !== 'Capri Settings') return;
        const capture = view.webContents.capturePage.bind(view.webContents);
        view.qaCaptureAttempts = 0;
        view.webContents.capturePage = (...args) => {
          view.qaCaptureAttempts++;
          return view.qaCaptureAttempts <= 3
            ? Promise.resolve(nativeImage.createEmpty())
            : capture(...args);
        };
      });
    });
    await page.context().addInitScript(() => {
      if (!location.pathname.endsWith('/settings.html') || window.qaSettingsFrames) return;
      const frame = window.requestAnimationFrame.bind(window),
        cancel = window.cancelAnimationFrame.bind(window),
        queued = new Map();
      let nextFrame = -1;
      window.qaSettingsFrames = { queued: 0, released: false, fired: 0 };
      window.requestAnimationFrame = (callback) => {
        window.qaSettingsFrames.queued++;
        const id = nextFrame--;
        queued.set(id, { callback });
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (id >= 0) return cancel(id);
        const entry = queued.get(id);
        if (entry?.nativeId !== undefined) cancel(entry.nativeId);
        queued.delete(id);
      };
      window.releaseSettingsFrames = () => {
        window.qaSettingsFrames.released = true;
        window.requestAnimationFrame = frame;
        for (const [id, entry] of queued)
          entry.nativeId = frame((time) => {
            queued.delete(id);
            window.qaSettingsFrames.fired++;
            entry.callback(time);
          });
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
    await application.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/settings.html'),
      );
      for (let attempt = 0; attempt < 200; attempt++) {
        if (view.isVisible() && view.getOpacity() === 1) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error('Loading placeholders did not appear after one request');
    });
    assert.equal(await visible(), true);
    assert.equal(
      await settings.evaluate(() => document.body.hasAttribute('data-settings-loading')),
      true,
    );
    assert.equal(await settings.locator('#settings-loading').isVisible(), true);
    assert.equal(await settings.locator('#settings-layout').isVisible(), false);
    assert.equal(
      await settings
        .locator('#settings-loading')
        .evaluate((node) => getComputedStyle(node, '::after').animationName),
      'settings-placeholder-sweep',
    );
    await settings.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await settings
        .locator('#settings-loading')
        .evaluate((node) => getComputedStyle(node, '::after').animationName),
      'none',
    );
    await settings.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(
      await application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().endsWith('/settings.html'),
          ).qaCaptureAttempts,
      ),
      4,
    );
    await settings.screenshot({ path: path.join(folder, section + '-loading.png') });
    if (section === 'general') {
      await settings.locator('#settings-window-close').click();
      assert.equal(await visible(), false, 'Loading Settings can be dismissed before hydration');
    }
    await settings.evaluate(() => window.releaseSettingsFrames());
    if (section === 'general') {
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(await visible(), false, 'Late hydration cannot resurrect dismissed Settings');
      await page.evaluate(() => window.capri.openSettings());
    }
    await settings
      .waitForFunction(() => !document.body.hasAttribute('data-settings-loading'), null, {
        timeout: 10000,
        polling: 50,
      })
      .catch(async (error) => {
        report.hydration = await settings.evaluate(() => ({
          fonts: document.fonts.status,
          busy: document.getElementById('companion').getAttribute('aria-busy'),
          section: document.querySelector('#settings-navigation [aria-current="page"]')?.dataset
            .section,
          notice: document.getElementById('settings-notice').textContent,
          pendingFonts: [...document.fonts]
            .filter((font) => font.status !== 'loaded')
            .map((font) => ({ family: font.family, status: font.status })),
          visibility: document.visibilityState,
          frames: window.qaSettingsFrames,
        }));
        report.native = await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => ({
            title: w.getTitle(),
            visible: w.isVisible(),
            opacity: w.getOpacity(),
            throttled: w.webContents.getBackgroundThrottling(),
          })),
        );
        throw error;
      });
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
    report.checks.push(
      'One request, loading placeholders, three failed captures, hydrated content, reopen and tray: ' +
        section,
    );
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
