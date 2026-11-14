// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

// Real settings renderer + confirmation broker + Spotify transaction; only native
// compilation and desktop relaunch are fixtures. No models or Spotify are started.
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'spotify-settings-'));
const report = { folder, checks: [], errors: [] };
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
let app;
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  app.on('window', (page) => page.on('pageerror', (error) => report.errors.push(error.message)));
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const settings = await settingsView(app, 'spotify');
  await settings.evaluate(() => window.capri.closeSettings());
  await page.evaluate(() => {
    void window.capri.quit();
  });
  await page.locator('#confirmation-dialog[open]').waitFor({ timeout: 2500 });
  assert.equal(await settings.locator('#confirmation-dialog[open]').count(), 0);
  await page.locator('#confirmation-dialog [data-choice="cancel"]').click();
  await settingsView(app, 'spotify');
  report.checks.push('Hidden settings receives no duplicate confirmation from the companion');
  await app.evaluate(
    async ({ ipcMain, BrowserWindow }, { root, folder }) => {
      const { mkdirSync, copyFileSync, writeFileSync } = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const load = process
        .getBuiltinModule('node:module')
        .createRequire(path.join(root, 'package.json'));
      const module = (name) => load(path.join(root, name));
      const { Confirmations } = await module('apps/desktop/main/confirmations.mjs');
      const { SpotifySettings } = await module('apps/desktop/spotify-settings.mjs');
      const { writeJsonAtomic } = await module('packages/runtime/src/atomic-json.mjs');
      const { NATIVE_SOURCES, spotifySourceHash } = await module(
        'integrations/spotify/native-build.mjs',
      );
      const fixture = path.join(folder, 'spotify-fixture');
      const native = path.join(fixture, 'integrations/spotify/native');
      mkdirSync(native, { recursive: true });
      for (const file of [...NATIVE_SOURCES, 'ExportAutomation.cs'])
        copyFileSync(path.join(root, 'integrations/spotify/native', file), path.join(native, file));
      const rt = { configPath: path.join(fixture, 'config.json') };
      writeJsonAtomic(rt.configPath, { agents: { entries: { capri: {} } } });
      const view = BrowserWindow.getAllWindows().find((view) =>
        view.webContents.getURL().endsWith('/settings.html'),
      );
      const emit = (value) => view.webContents.send('capri:event', value);
      const steps = [];
      const broker = new Confirmations({ emit, show: () => view.focus() });
      const service = new SpotifySettings({
        root: fixture,
        rt,
        agentId: 'capri',
        node: process.execPath,
        emit,
        execute: async () => {
          steps.push('prepare');
          const sourceSha256 = spotifySourceHash(fixture),
            artifact = sourceSha256.slice(0, 16) + '/Capri.Spotify.exe';
          const build = path.join(fixture, '.runtime/spotify-bridge');
          mkdirSync(path.dirname(path.join(build, artifact)), { recursive: true });
          writeFileSync(path.join(build, artifact), 'Never executed');
          writeJsonAtomic(path.join(build, 'build.json'), { sourceSha256, artifact });
        },
      });
      globalThis.spotifyVerification = { broker, service, steps, failRestart: false };
      for (const channel of ['capri:spotify-access', 'capri:spotify-status', 'capri:confirmation'])
        ipcMain.removeHandler(channel);
      ipcMain.handle('capri:spotify-status', () => service.snapshot());
      ipcMain.handle('capri:confirmation', (_event, value) => broker.respond(value));
      ipcMain.handle('capri:spotify-access', async (_event, enabled) => {
        if (
          !(await broker.request({
            title: enabled ? 'Enable Spotify control?' : 'Disable Spotify control?',
            detail: 'Verification fixture',
            confirmLabel: 'Confirm',
          }))
        )
          return false;
        await service.setEnabled(enabled, {
          beforeCommit: async () => steps.push('stop'),
          restart: async () => {
            steps.push('restart');
            if (globalThis.spotifyVerification.failRestart) throw Error('Fixture restart failed');
          },
        });
        return true;
      });
      service.publish();
    },
    { root, folder },
  );
  const dialog = settings.locator('#confirmation-dialog[open]');
  const toggle = settings.locator('#spotify-access');
  const open = async () => {
    await toggle.click();
    await dialog.waitFor({ timeout: 2500 });
  };
  await open();
  await dialog.locator('[data-choice="cancel"]').click();
  await settings.waitForFunction(() => !document.getElementById('spotify-access').disabled);
  assert.deepEqual(await app.evaluate(() => globalThis.spotifyVerification.steps), []);
  report.checks.push('Spotify confirmation opens immediately; cancel never prepares or restarts');
  await open();
  await app.evaluate(() => globalThis.spotifyVerification.broker.cancel());
  await dialog.waitFor({ state: 'hidden', timeout: 2500 });
  await settings.waitForFunction(() => !document.getElementById('spotify-access').disabled);
  report.checks.push('Backend cancellation removes the dialog and permits retry');
  await open();
  await dialog.locator('[data-choice="confirm"]').click();
  await settings.waitForFunction(
    () => document.getElementById('spotify-status').textContent === 'Spotify control is enabled.',
  );
  assert.deepEqual(await app.evaluate(() => globalThis.spotifyVerification.steps), [
    'prepare',
    'stop',
    'restart',
  ]);
  report.checks.push(
    'Confirmed enable prepares the bridge, commits permission and queues restart once',
  );
  await app.evaluate(() => {
    globalThis.spotifyVerification.failRestart = true;
  });
  await open();
  await dialog.locator('[data-choice="confirm"]').click();
  await settings.waitForFunction(() =>
    document.getElementById('spotify-result').textContent.includes('Fixture restart failed'),
  );
  assert.equal(
    await settings.evaluate(() => window.capri.spotifyStatus().then((value) => value.enabled)),
    true,
  );
  await app.evaluate(() => {
    globalThis.spotifyVerification.failRestart = false;
  });
  await open();
  await dialog.locator('[data-choice="confirm"]').click();
  await settings.waitForFunction(
    () => document.getElementById('spotify-status').textContent === 'Spotify control is disabled.',
  );
  await settings.locator('[data-section="general"]').click();
  await settings.locator('#general-panel:not([hidden])').waitFor();
  report.checks.push(
    'Failed restart rolls back access; retry and settings navigation remain usable',
  );
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  if (app)
    await app.evaluate(() => globalThis.spotifyVerification?.broker.cancel()).catch(() => {});
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
