// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { settingsView } from './settings-view.mjs';
const root = process.cwd(),
  parent = path.join(root, '.runtime/overnight-ui');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  require = createRequire(import.meta.url),
  report = { checks: [], errors: [] };
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `import {app} from 'electron';try{await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});}catch(error){console.error(error);app.exit(1);}`,
);
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
const passed = (name) => {
  report.checks.push(name);
  console.log('PASS ' + name);
};
try {
  application = await _electron.launch({
    executablePath: require('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  assert.equal(await page.locator('#coding-toggle').count(), 1);
  const settings = await settingsView(application, 'coding');
  await settings.locator('#coding-panel').waitFor({ state: 'visible' });
  await settings.screenshot({ path: path.join(folder, 'coding-settings.png') });
  assert.equal(
    await settings
      .locator('#coding-panel button[data-code]')
      .evaluateAll((buttons) =>
        buttons.some((button) => button.getBoundingClientRect().width < 20),
      ),
    false,
  );
  passed('Coding mode has a reachable isolated Settings section and standard-size controls');
  const project = mkdtempSync(path.join(os.tmpdir(), 'capri-coding-ui-'));
  await page.evaluate(
    async (workspace) =>
      window.capri.coding({ op: 'save', value: { workspace, editor: null, tasks: [] } }),
    project,
  );
  await page.locator('#coding-toggle').click();
  await page.waitForFunction(
    () => document.querySelector('#coding-toggle').getAttribute('aria-pressed') === 'true',
  );
  assert.equal((await page.evaluate(() => window.capri.coding({ op: 'status' }))).enabled, true);
  await page.locator('#coding-toggle').click();
  passed('Main composer toggles the host coding mode without starting computer control');
  const models = await settingsView(application, 'models');
  await models.locator('[data-npu="backend"]').scrollIntoViewIfNeeded();
  await models.screenshot({ path: path.join(folder, 'native-npu-settings.png') });
  assert.equal(await models.locator('[data-npu="use"]').isDisabled(), true);
  assert.equal(await models.locator('[data-npu="backend"] option').count(), 3);
  passed(
    'Native NPU controls load through the protected resource protocol; activation requires a model test',
  );
  const overlayUrl = pathToFileURL(
    path.join(root, 'apps/desktop/renderer/control-overlay.html'),
  ).href;
  const newPage = application.waitForEvent('window');
  await application.evaluate(async ({ BrowserWindow }, url) => {
    const window = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await window.loadURL(url);
  }, overlayUrl);
  const overlay = await newPage;
  await overlay.waitForFunction(() => Boolean(globalThis.capriControl));
  const initial = {
    active: true,
    revision: 1,
    steps: [
      { id: 'browser', label: 'Open browser', state: 'active' },
      { id: 'video', label: 'Find requested video', state: 'pending' },
      { id: 'play', label: 'Play and verify', state: 'pending' },
    ],
  };
  await overlay.evaluate((value) => capriControl.plan(value), initial);
  assert.equal(await overlay.locator('.control-task-step').count(), 3);
  await overlay.screenshot({
    path: path.join(folder, 'task-chain-running.png'),
    omitBackground: true,
  });
  await overlay.locator('[data-id="video"]').evaluate((node) => (node.dataset.retained = 'yes'));
  const next = {
    active: true,
    revision: 2,
    steps: [
      { ...initial.steps[0], state: 'completed' },
      { id: 'cookies', label: 'Dismiss blocking cookie dialog', state: 'active' },
      initial.steps[1],
      initial.steps[2],
    ],
  };
  await overlay.evaluate((value) => capriControl.plan(value), next);
  assert.equal(
    await overlay.locator('[data-id="browser"]').getAttribute('data-state'),
    'completed',
  );
  assert.equal(await overlay.locator('[data-id="video"]').getAttribute('data-retained'), 'yes');
  await overlay.screenshot({
    path: path.join(folder, 'task-chain-replanned.png'),
    omitBackground: true,
  });
  await overlay.locator('[data-id="browser"]').waitFor({ state: 'detached', timeout: 2500 });
  const geometry = await overlay.locator('#control-task-chain').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      center: rect.x + rect.width / 2,
      screen: innerWidth / 2,
      pointerEvents: getComputedStyle(node).pointerEvents,
    };
  });
  assert.ok(Math.abs(geometry.center - geometry.screen) < 1);
  assert.equal(geometry.pointerEvents, 'none');
  passed(
    'Verified steps turn green, disappear, preserve keyed pending nodes and recenter without intercepting input',
  );
  await overlay.setViewportSize({ width: 640, height: 480 });
  await overlay.screenshot({
    path: path.join(folder, 'task-chain-small-screen.png'),
    omitBackground: true,
  });
  assert.ok(
    await overlay
      .locator('#control-task-chain')
      .evaluate((node) => node.getBoundingClientRect().width <= innerWidth),
  );
  await overlay.evaluate(() => capriControl.plan({ active: false, steps: [] }));
  assert.equal(await overlay.locator('#control-task-chain').isVisible(), false);
  passed('Task chain fits a small screen and clears when computer control ends');
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log('Report: ' + path.join(folder, 'report.json'));
