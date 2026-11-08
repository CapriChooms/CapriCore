// SPDX-License-Identifier: GPL-3.0-only
// Exercise the real confirmation and shutdown; intercept relaunch to avoid starting owner services.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import {
  root,
  nodePath,
  runtime,
  initialize,
  environment,
} from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/restart-verification');
mkdirSync(parent, { recursive: true });
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let application;
const errors = [],
  checks = [];
try {
  for (const mode of ['restart', 'quit']) {
    const folder = mkdtempSync(path.join(parent, mode + '-'));
    const rt = runtime({
      stateDir: path.join(folder, 'openclaw'),
      workspace: path.join(folder, 'workspace'),
      gatewayPort: port,
    });
    initialize(rt);
    mkdirSync(path.join(folder, 'desktop'), { recursive: true });
    const languages = path.join(folder, 'desktop/languages.json');
    writeFileSync(
      languages,
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          interface: mode === 'quit' ? 'ru' : 'en',
          conversation: 'en',
          recognition: 'en',
          speech: 'off',
          autoDetect: false,
        },
      }),
    );
    const before = readFileSync(languages, 'utf8');
    const receipt = path.join(folder, 'relaunch.json');
    const env = {
      ...environment(rt),
      CAPRI_DESKTOP_VERIFICATION_DIR: folder,
      CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
      CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      env,
      args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    });
    const main = await application.firstWindow();
    main.on('pageerror', (error) => errors.push(error.message));
    await main.waitForFunction(() => document.body.dataset.phase === 'ready');
    await application.evaluate(({ app, BrowserWindow }, receipt) => {
      const { writeFileSync } = process.getBuiltinModule('fs');
      app.relaunch = (options) => {
        writeFileSync(
          receipt,
          JSON.stringify({
            options,
            settingsClosed: !BrowserWindow.getAllWindows().some((window) =>
              window.webContents.getURL().endsWith('/settings.html'),
            ),
          }),
        );
      };
    }, receipt);
    const view = mode === 'quit' ? await settingsView(application, 'general') : main;
    if (view !== main) view.on('pageerror', (error) => errors.push(error.message));
    await main.locator('#quit').click({ force: true });
    const dialog = view.locator('#confirmation-dialog');
    await dialog.waitFor({ state: 'visible' });
    assert.deepEqual(
      await dialog.locator('button').evaluateAll((buttons) => buttons.map((b) => b.dataset.choice)),
      ['cancel', 'restart', 'confirm'],
    );
    assert.equal(
      await dialog.locator('[data-choice="restart"]').innerText(),
      mode === 'quit' ? 'Перезапустить' : 'Restart',
    );
    assert.equal(
      await dialog
        .locator('[data-choice="cancel"]')
        .evaluate((button) => button === document.activeElement),
      true,
    );
    await view.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(existsSync(receipt), false, 'Cancel must not queue a relaunch');
    assert.equal(await main.evaluate(() => Boolean(window.capri)), true);
    if (mode === 'restart') {
      // A relaunch failure must remain recoverable and must not leave shutdown locked.
      await application.evaluate(({ app }) => {
        globalThis.verifiedRelaunch = app.relaunch;
        app.relaunch = () => {
          throw new Error('Verification: relaunch failed');
        };
      });
      await main.locator('#quit').click({ force: true });
      await dialog.waitFor({ state: 'visible' });
      await dialog.locator('[data-choice="restart"]').click();
      await main.waitForFunction(() =>
        document.body.textContent.includes('Verification: relaunch failed'),
      );
      assert.equal(existsSync(receipt), false);
      await application.evaluate(({ app }) => {
        app.relaunch = globalThis.verifiedRelaunch;
      });
    }
    await main.locator('#quit').click({ force: true });
    await dialog.waitFor({ state: 'visible' });
    await dialog.screenshot({ path: path.join(folder, 'confirmation.png') });
    const closed = application.waitForEvent('close', { timeout: 30000 });
    await dialog.locator(`[data-choice="${mode === 'quit' ? 'confirm' : 'restart'}"]`).click();
    await closed;
    application = null;
    assert.equal(readFileSync(languages, 'utf8'), before, 'Keep personal language settings');
    if (mode === 'restart') {
      const result = JSON.parse(readFileSync(receipt, 'utf8'));
      assert.equal(result.settingsClosed, true);
      assert.equal(
        result.options.execPath,
        existsSync(path.join(root, 'Capri.exe')) ? path.join(root, 'Capri.exe') : nodePath,
      );
      assert.ok(result.options.args.every((arg) => !arg.includes('verification')));
    } else assert.equal(existsSync(receipt), false, 'Quit must not restart');
    checks.push(mode);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: ['cancel', 'relaunch failure recovery', ...checks],
      realRelaunchIntercepted: true,
    }),
  );
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
