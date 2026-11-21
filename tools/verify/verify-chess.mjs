// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempDisposableSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';
import { STOCKFISH_VERSION } from '../../apps/desktop/chess/engine-install.mjs';
import { settingsView } from './settings-view.mjs';

using verification = mkdtempDisposableSync(path.join(root, '.runtime/chess-desktop-verification-'));
const stage = verification.path;
const image = process.argv[2] ? readFileSync(process.argv[2]) : null;
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/v1/models') response.end('{"data":[]}');
  else response.writeHead(404).end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(stage, 'openclaw'),
  workspace: path.join(stage, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: stage,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const main = await app.firstWindow();
  const errors = [];
  main.on('pageerror', (error) => errors.push(error.message));
  await main.waitForFunction(() => document.body.dataset.phase === 'ready');
  assert.equal(
    await main.evaluate(async () => {
      try {
        await window.capri.chess('status');
        return false;
      } catch (error) {
        return error.message.includes('Settings frame required');
      }
    }),
    true,
  );
  if (image) {
    await app.evaluate(async ({ BrowserWindow }, image) => {
      const fixture = new BrowserWindow({
        width: 1440,
        height: 900,
        title: 'Chess recognition fixture',
        useContentSize: true,
        show: false,
        webPreferences: { sandbox: true },
      });
      await fixture.loadURL(
        'data:text/html,<title>Chess recognition fixture</title><body style="margin:0"><img style="width:100%;height:auto" src="data:image/png;base64,' +
          image +
          '" /></body>',
      );
      fixture.showInactive();
    }, image.toString('base64'));
  }
  const page = await settingsView(app, 'chess');
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => window.capri.setSkill({ id: 'capri.chess', enabled: true }));
  await page.locator('#chess-frame-editor summary').click();
  const outward = page.getByRole('switch', { name: 'Particles move outward' });
  assert.equal(await outward.isChecked(), true);
  for (const [field, expected] of Object.entries({ width: 8, opacity: 100, glow: 15, detail: 8 })) {
    assert.equal(await page.locator('#chess-frame-' + field).inputValue(), String(expected));
  }
  const checkDirection = async (enabled) => {
    await outward.setChecked(enabled);
    await page.waitForFunction(async (expected) => {
      const { frameStyle } = await window.capri.chess('status');
      return frameStyle.particlesOutward === expected;
    }, enabled);
    const { settings } = JSON.parse(
      readFileSync(path.join(stage, 'desktop', 'chess.json'), 'utf8'),
    );
    assert.equal(settings.frameStyle.particlesOutward, enabled);
  };
  await checkDirection(false);
  await checkDirection(true);
  await page.locator('#chess-frame-editor summary').click();
  console.log('PASS Chess frame particle direction switch is saved in both states');
  const download = page.locator('#chess-download');
  const remove = page.locator('#chess-remove');
  const installed = page.locator('#chess-engine-status').filter({ hasText: '· Installed' });
  assert.equal(await remove.isHidden(), true);
  await download.click();
  await installed.waitFor({ timeout: 120000 });
  assert.equal(await download.isHidden(), true);
  assert.equal(await remove.isVisible(), true);
  const executable = path.join(stage, 'chess', `stockfish-${STOCKFISH_VERSION}.exe`);
  const receipt = `${executable}.json`;
  const installedAt = statSync(receipt).mtimeMs;
  assert.equal(
    await page.evaluate(async () => (await window.capri.chess('install')).installed),
    true,
  );
  assert.equal(statSync(receipt).mtimeMs, installedAt);
  await settingsView(app, 'general');
  await settingsView(app, 'chess');
  await installed.waitFor();
  assert.equal(await remove.isVisible(), true);
  assert.equal(await download.isHidden(), true);
  console.log('PASS Stockfish download, installed state, reopening and duplicate install');
  await page.locator('#chess-input').fill('1. e4 e5 2. Nf3');
  await page.locator('#chess-import').click();
  await page.waitForFunction(() => document.querySelectorAll('#chess-board button').length === 64);
  await page.locator('#chess-analyse').click();
  await page.locator('#chess-result:not([hidden]):not([data-provisional])').waitFor();
  assert.match(await page.locator('#chess-result').textContent(), /d\d+/);
  await page.locator('#chess-board-arrow:not([hidden])').waitFor();
  console.log('PASS Chess settings, PGN replay, real Stockfish, score and board arrow');
  const autoMove = page.locator('#chess-auto-move');
  assert.equal(await autoMove.isChecked(), false);
  assert.equal(await page.locator('#chess-turn').inputValue(), 'b');
  await autoMove.check();
  await page.waitForFunction(() => !document.getElementById('chess-auto-move').disabled);
  assert.equal(
    await page.evaluate(async () => (await window.capri.chess('status')).autoMove),
    true,
  );
  await page.locator('#chess-analyse').click();
  await page.locator('#chess-result:not([hidden]):not([data-provisional])').waitFor();
  assert.equal(await page.locator('#chess-turn').inputValue(), 'b');
  assert.equal(await page.locator('#chess-board button[data-square="d7"]').textContent(), '♟');
  assert.equal(await page.locator('#chess-input').inputValue(), '1. e4 e5 2. Nf3');
  await autoMove.uncheck();
  await page.waitForFunction(() => !document.getElementById('chess-auto-move').disabled);
  await page.locator('#chess-analyse').click();
  await page.locator('#chess-result:not([hidden]):not([data-provisional])').waitFor();
  assert.equal(await page.locator('#chess-turn').inputValue(), 'b');
  console.log('PASS Auto move does not mutate imported positions');
  if (image) {
    const option = page
      .locator('#chess-display option')
      .filter({ hasText: 'Chess recognition fixture' });
    await option.waitFor({ state: 'attached' });
    await page.locator('#chess-display').selectOption(await option.getAttribute('value'));
    const settingsWindow = await app.browserWindow(page);
    const boundsBefore = await settingsWindow.evaluate((window) => window.getBounds());
    await page.locator('#chess-detect').click();
    await page.locator('#chess-preview:not([hidden])').waitFor();
    assert.match(await page.locator('#chess-board button[data-square="f3"]').textContent(), /♘/);
    assert.match(await page.locator('#chess-board button[data-square="c5"]').textContent(), /♝/);
    assert.equal(await page.locator('#chess-diagram').count(), 0);
    await page.waitForFunction(
      () => !document.querySelector('#chess-panel').hasAttribute('aria-busy'),
    );
    if (await page.locator('#chess-result').isHidden()) {
      await page.locator('#chess-turn').selectOption('w');
      await page.locator('#chess-analyse').click();
    }
    await page
      .locator('#chess-result:not([hidden]):not([data-provisional])')
      .waitFor({ state: 'attached' });
    assert.equal(await page.locator('#chess-board-arrow').getAttribute('hidden'), '');
    assert.equal(await page.locator('#chess-watch').count(), 0);
    assert.ok(app.windows().every((window) => !window.url().endsWith('/chess-overlay.html')));
    console.log('PASS Selected-window recognition and no arrow over an unsupported source');
    const previousTurn = await page.locator('#chess-turn').inputValue();
    await autoMove.check();
    await page.waitForFunction(() => !document.getElementById('chess-auto-move').disabled);
    const outline = page.locator('#chess-board-frame');
    await outline.check();
    await page.waitForFunction(() => !document.getElementById('chess-board-frame').disabled);
    assert.equal(
      await page.evaluate(async () => (await window.capri.chess('status')).boardFrame),
      true,
    );
    await page.locator('#chess-analyse').click();
    await page.waitForFunction(
      () => !document.querySelector('#chess-panel').hasAttribute('aria-busy'),
    );
    assert.equal(await page.locator('#chess-turn').inputValue(), previousTurn);
    assert.equal(await page.locator('#chess-board-lightning').count(), 0);
    assert.equal(await settingsWindow.evaluate((window) => window.isVisible()), true);
    assert.deepEqual(await settingsWindow.evaluate((window) => window.getBounds()), boundsBefore);
    console.log('PASS Settings stays visible and the captured preview stays read-only');
  }
  await page.waitForFunction(
    () => !document.querySelector('#chess-panel').hasAttribute('aria-busy'),
  );
  await remove.click();
  await page.waitForFunction(
    () => !document.querySelector('#chess-panel').hasAttribute('aria-busy'),
  );
  assert.equal(await download.isVisible(), true, await page.locator('#chess-status').textContent());
  assert.equal(await download.isEnabled(), true);
  assert.equal(await remove.isHidden(), true);
  assert.equal(await installed.count(), 0);
  assert.equal(existsSync(executable), false);
  assert.equal(existsSync(receipt), false);
  console.log('PASS Stockfish removal restores the download action');
  assert.deepEqual(errors, []);
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
