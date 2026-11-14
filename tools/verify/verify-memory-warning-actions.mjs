// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'memory-monitor-'));
const report = { folder, checks: [], errors: [] };
const entry = path.join(folder, 'test-main.mjs');
const source = (file) => JSON.stringify(pathToFileURL(path.join(root, file)).href);
writeFileSync(
  entry,
  `
import { app, BrowserWindow, Menu } from 'electron';
import { MemorySampler, memoryUsage } from ${source('packages/runtime/src/hardware/memory.mjs')};
import { CpuSampler } from ${source('apps/desktop/system-resources.mjs')};
import { ProcessLoadSampler } from ${source('apps/desktop/process-load.mjs')};
const visible = new WeakSet();
app.on('browser-window-created', (_, window) => window.webContents.setBackgroundThrottling(false));
BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive = function () { visible.add(this); };
BrowserWindow.prototype.hide = function () { visible.delete(this); };
BrowserWindow.prototype.isVisible = function () { return visible.has(this); };
const fixture = globalThis.monitorFixture = { at: 0, gpuFree: 4, lastFree: null, menu: null };
Menu.prototype.popup = function () { fixture.menu = this.items; };
MemorySampler.prototype.sample = async function () {
  const at = ++fixture.at;
  fixture.lastFree = fixture.gpuFree;
  return {
    sampledAt: at, gpuSampledAt: at,
    ram: memoryUsage(32e9, 1e9),
    gpus: [{ id: 'synthetic', name: 'Synthetic GPU', utilization: 60, temperatureCelsius: 45,
      ...memoryUsage(12e9, fixture.gpuFree * 12e7) }],
  };
};
CpuSampler.prototype.sample = async () => ({ utilization: 21, temperatureCelsius: 44, temperatureSampledAt: 1 });
ProcessLoadSampler.prototype.sample = async () => ({ cpuPercent: 1, ramBytes: 1e9, vramBytes: null });
await import(${source('apps/desktop/main.mjs')});
`,
);
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.showInactive();
    window.webContents.setBackgroundThrottling(false);
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(
    () => document.querySelector('[data-memory="RAM"]').getAttribute('role') === 'meter',
  );

  const vramWarning = page.locator('[data-warning-device="VRAM"]');
  const ramWarning = page.locator('[data-warning-device="RAM"]');
  await vramWarning.waitFor();
  await ramWarning.waitFor();
  for (const warning of [ramWarning, vramWarning]) {
    assert.equal(await warning.locator('.resource-warning-actions button').count(), 3);
    const fits = await warning.evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      return [...row.querySelectorAll('button')].every((button) => {
        const box = button.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right && box.bottom <= bounds.bottom;
      });
    });
    assert(fits, 'All warning buttons fit inside the card');
  }
  await page.screenshot({ path: path.join(folder, 'memory-warning-actions.png') });
  for (const [shortcut, section, selector] of [
    ['local-model', 'models', '#models-choice'],
    ['model-devices', 'models', '#model-device-language'],
    ['api', 'api', '#inference-panel'],
  ]) {
    const opened = application.windows().find((view) => view.url().endsWith('/settings.html'));
    const opening = opened
      ? Promise.resolve(opened)
      : application.waitForEvent('window', { timeout: 15000 });
    await vramWarning.locator('[data-resource-action="' + shortcut + '"]').click();
    const settings = await opening;
    await settings.waitForURL('**/settings.html');
    await settings.locator('[data-section="' + section + '"][aria-current="page"]').waitFor();
    await settings.waitForFunction((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect && rect.y >= 0 && rect.y < innerHeight;
    }, selector);
    await settings.screenshot({ path: path.join(folder, shortcut + '-shortcut.png') });
    await settings.locator('#settings-window-close').click();
    assert.equal(await vramWarning.isVisible(), true, 'Navigation does not dismiss the warning');
  }
  report.checks.push(
    'All three actions open the intended Settings section and scroll to its control.',
  );
  await vramWarning.locator('.resource-warning-dismiss').click();
  await vramWarning.waitFor({ state: 'detached' });
  assert.equal(await ramWarning.isVisible(), true);
  await ramWarning.locator('.resource-warning-dismiss').click();
  await ramWarning.waitFor({ state: 'detached' });
  report.checks.push(
    'RAM and VRAM retain independent dismiss controls; buttons fit inside their warning cards.',
  );
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
