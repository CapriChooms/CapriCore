// SPDX-License-Identifier: GPL-3.0-only
// Real Settings/preload/CSS with synthetic music IPC. Never captures user audio.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { settingsView, saveSettings } from './settings-view.mjs';

const root = process.cwd(),
  parent = path.join(root, '.runtime/music-settings-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const report = { passed: false, folder, capturedSystemAudio: false, checks: [], errors: [] };
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
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
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
  const errors = (page) => page.on('pageerror', (error) => report.errors.push(error.message));
  application.on('window', errors);
  const owner = await application.firstWindow();
  errors(owner);
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const bootstrap = await owner.evaluate(() => window.capri.bootstrap());
  assert.equal(bootstrap.musicListening.enabled, false);
  assert.equal(bootstrap.musicListening.phase, 'off');
  assert.deepEqual(bootstrap.musicListening.settings, {
    enabled: false,
    notes: true,
    motion: true,
    autoBpm: true,
  });
  await application.evaluate(({ ipcMain, BrowserWindow }) => {
    const state = (globalThis.musicSettingsFixture = {
      phase: 'off',
      enabled: false,
      supported: true,
      hearingMusic: false,
      musicScore: 0,
      speechScore: 0,
      settings: { enabled: false, notes: true, motion: true, autoBpm: true },
      starts: 0,
      stops: 0,
      saves: 0,
      captures: 0,
    });
    const snapshot = () => ({
      phase: state.phase,
      enabled: state.enabled,
      supported: state.supported,
      hearingMusic: state.hearingMusic,
      musicScore: state.musicScore,
      speechScore: state.speechScore,
      settings: { ...state.settings },
    });
    const publish = () => {
      const value = snapshot();
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('capri:event', { type: 'music.status', ...value });
      return value;
    };
    const handle = (name, handler) => {
      ipcMain.removeHandler('capri:' + name);
      ipcMain.handle('capri:' + name, (_event, input) => handler(input));
    };
    handle('music-status', snapshot);
    // Keep preview state synthetic too: the real preview broadcaster owns a
    // different (deliberately inactive) music service in this isolated app.
    handle('settings-preview', () => true);
    handle('music-settings', (value) => {
      state.saves++;
      state.settings = { ...value };
      return publish();
    });
    handle('music-command', (action) => {
      if (action === 'start') {
        state.starts++;
        state.enabled = true;
        state.phase = 'listening';
        state.settings.enabled = true;
      } else {
        state.stops++;
        state.enabled = false;
        state.phase = 'off';
        state.hearingMusic = false;
      }
      return publish();
    });
    handle('music-audio-start', () => {
      state.captures++;
      throw Error('Real capture forbidden in Settings fixture');
    });
    globalThis.musicSettingsEmit = (value) => {
      Object.assign(state, value);
      return publish();
    };
  });
  let page = await settingsView(application, 'music');
  const panel = page.locator('#music-listening-panel');
  await panel.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#music-listening-start').isVisible(), true);
  assert.equal(await page.locator('#music-listening-stop').isVisible(), false);
  assert.equal(await page.locator('#music-listening-enabled').isChecked(), false);
  assert.match(await panel.textContent(), /No microphone is required/);
  report.checks.push(
    'actual isolated bootstrap stays off; the independent Music section opens with clear privacy help',
  );
  await page.locator('#music-listening-notes').uncheck();
  await page.locator('[data-section="general"]').click();
  await page.locator('[data-section="music"]').click();
  assert.equal(await page.locator('#music-listening-notes').isChecked(), false);
  assert.equal(await application.evaluate(() => globalThis.musicSettingsFixture.saves), 0);
  report.checks.push(
    'tab navigation preserves the unsaved music preference without an automatic save',
  );
  await page.locator('#music-listening-enabled').check();
  await page.waitForFunction(
    () => document.getElementById('music-listening-status').textContent === 'Listening',
  );
  assert.equal(await page.locator('#music-listening-enabled').isChecked(), true);
  assert.equal(await page.locator('#music-listening-notes').isChecked(), false);
  assert.equal(await page.locator('#music-listening-stop').isVisible(), true);
  await application.evaluate(() =>
    globalThis.musicSettingsEmit({ hearingMusic: true, musicScore: 0.95, speechScore: 0.04 }),
  );
  await page.waitForFunction(
    () => document.getElementById('music-listening-status').textContent === 'Music detected',
  );
  assert.equal(await page.locator('#music-listening-notes').isChecked(), false);
  report.checks.push(
    'explicit animation toggle starts listening; music events preserve dirty note preferences',
  );
  await saveSettings(page);
  await page.waitForTimeout(300);
  const saved = await application.evaluate(() => ({ ...globalThis.musicSettingsFixture }));
  assert.deepEqual(saved.settings, { enabled: true, notes: false, motion: true, autoBpm: true });
  assert.equal(saved.saves, 1);
  assert.equal(saved.starts, 1);
  assert.equal(saved.captures, 0);
  await page.screenshot({ path: path.join(folder, 'music-settings.png') });
  const layout = await panel.evaluate((element) => {
    const panel = element.getBoundingClientRect();
    return {
      overflow: element.scrollWidth > element.clientWidth + 1,
      controls: [...element.querySelectorAll('button,input')]
        .filter((control) => !control.hidden && control.getClientRects().length)
        .map((control) => {
          const rect = control.getBoundingClientRect();
          return {
            id: control.id,
            inside: rect.left >= panel.left && rect.right <= panel.right + 1,
            width: rect.width,
            height: rect.height,
          };
        }),
    };
  });
  assert.equal(layout.overflow, false);
  assert(layout.controls.every((control) => control.inside));
  report.checks.push(
    'close/save uses the existing draft barrier and all visible controls fit the real Settings card',
  );
  await page.locator('#music-listening-stop').click();
  await page.waitForFunction(
    () => document.getElementById('music-listening-status').textContent === 'Off',
  );
  assert.equal(await page.locator('#music-listening-enabled').isChecked(), true);
  await page.locator('#settings-window-close').click();
  await page
    .waitForFunction(
      () => document.body.dataset.phase !== 'ready' || document.visibilityState === 'hidden',
    )
    .catch(() => {});
  page = await settingsView(application);
  await page.waitForSelector('[data-section="music"][aria-current="page"]');
  assert.equal(await page.locator('#music-listening-start').isVisible(), true);
  assert.equal(await page.locator('#music-listening-enabled').isChecked(), true);
  await application.evaluate(() => globalThis.musicSettingsEmit({ supported: false }));
  await page.waitForFunction(() => document.getElementById('music-listening-start').disabled);
  assert.equal(await page.locator('#music-listening-status').textContent(), 'Unavailable');
  report.checks.push(
    'Stop/reopen keeps preferences without capture; unavailable runtime disables Start',
  );
  const final = await application.evaluate(() => globalThis.musicSettingsFixture);
  assert.equal(final.captures, 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
