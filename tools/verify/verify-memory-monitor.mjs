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
const fixture = globalThis.monitorFixture = { at: 0, gpuFree: 4, lastFree: null, menu: null, cpuTemperature: 44 };
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
CpuSampler.prototype.sample = async () => ({ utilization: 21, temperatureCelsius: fixture.cpuTemperature, temperatureSampledAt: 1 });
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
  const fit = async () => {
    const rect = await page.locator('#memory-hud').boundingBox();
    const body = await page.locator('body').boundingBox();
    const input = await page.locator('.composer').boundingBox();
    assert(rect && rect.width > 28);
    assert(rect.x >= 0 && rect.x + rect.width <= body.width + 1);
    assert(rect.y + rect.height <= body.height + 1, 'Memory monitor must fit inside window');
    assert(rect.y + rect.height <= input.y + 1, 'Memory monitor must stay above input');
    const contents = await page.locator('#memory-hud').evaluate((el) =>
      [...el.querySelectorAll('.memory-gauge')]
        .filter((child) => child.getClientRects().length)
        .map((child) => {
          const b = child.getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            scroll: child.scrollWidth,
            width: child.clientWidth,
          };
        }),
    );
    assert(
      contents.every(
        (c) =>
          c.left >= rect.x - 3 && c.right <= rect.x + rect.width + 3 && c.scroll <= c.width + 1,
      ),
      JSON.stringify(contents),
    );
  };
  assert.equal(await page.locator('[data-memory="RAM"]').isHidden(), true);
  const contextButton = page.locator('#handle #inference-label + #context-hud');
  assert.equal(await contextButton.isVisible(), true);
  const assertHeaderContextAndChartLayout = () =>
    page.evaluate(() => {
      const charts = document.getElementById('process-graphs-hud').getBoundingClientRect();
      const display = document.getElementById('monitor-display').getBoundingClientRect();
      const telemetry = document.querySelector('.dock-telemetry').getBoundingClientRect();
      const composer = document.querySelector('.composer').getBoundingClientRect();
      const context = document.getElementById('context-hud').getBoundingClientRect();
      const identity = document.querySelector('#handle .identity').getBoundingClientRect();
      return {
        contextFits: context.right <= identity.right + 1,
        displayBesideCharts: display.x >= charts.right - 1,
        displayFits: display.top >= charts.top && display.bottom <= charts.bottom,
        chartsFit:
          charts.top >= telemetry.top - 1 &&
          charts.bottom <= telemetry.bottom + 1 &&
          telemetry.bottom <= composer.top + 1,
        charts: charts.toJSON(),
        display: display.toJSON(),
        telemetry: telemetry.toJSON(),
        contextRight: context.right,
        identityRight: identity.right,
      };
    });
  const layout = await assertHeaderContextAndChartLayout();
  assert.ok(
    layout.contextFits && layout.displayBesideCharts && layout.displayFits && layout.chartsFit,
    JSON.stringify(layout),
  );
  const vramWarning = page.locator('[data-warning-device="VRAM"]');
  const ramWarning = page.locator('[data-warning-device="RAM"]');
  await vramWarning.waitFor();
  await ramWarning.waitFor();
  const sampleIndex = () => application.evaluate(() => globalThis.monitorFixture.at);
  const waitSample = async (before) => {
    for (let count = 0; count < 120; count++) {
      if ((await sampleIndex()) > before) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail('Timed out waiting for synthetic monitor sample');
  };
  await vramWarning.locator('.resource-warning-dismiss').click();
  await vramWarning.waitFor({ state: 'detached' });
  await waitSample(await sampleIndex());
  assert.equal(await vramWarning.count(), 0);
  assert.equal(await ramWarning.isVisible(), true);
  await application.evaluate(() => {
    globalThis.monitorFixture.gpuFree = 20;
  });
  await waitSample(await sampleIndex());
  await page.waitForFunction(
    () => document.querySelector('[data-metric="VRAM"]').dataset.warning === 'false',
  );
  await application.evaluate(() => {
    globalThis.monitorFixture.gpuFree = 3;
  });
  await vramWarning.waitFor();
  await vramWarning.locator('.resource-warning-dismiss').click();
  await ramWarning.locator('.resource-warning-dismiss').click();
  report.checks.push('Separate RAM/VRAM dismiss buttons; warning reappears only after recovery');
  const monitor = page.locator('#monitor-display');
  const ramCurve = page.locator('[data-metric="RAM"] path');
  const segmentCount = async () => (await ramCurve.getAttribute('d')).match(/L/g)?.length ?? 0;
  const beforeCollapse = await segmentCount();
  await monitor.locator('svg').click();
  await page.locator('#process-graphs-hud').waitFor({ state: 'hidden' });
  assert.equal(await monitor.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('[data-memory="RAM"]').isVisible(), true);
  await waitSample(await sampleIndex());
  await monitor.locator('[data-monitor-menu]').click();
  const menu = await application.evaluate(() =>
    globalThis.monitorFixture.menu.map(({ label, checked }) => ({ label, checked })),
  );
  assert.deepEqual(menu, [
    { label: 'Circles', checked: true },
    { label: 'Bars', checked: false },
    { label: 'Graphs', checked: false },
  ]);
  await application.evaluate(() => globalThis.monitorFixture.menu[1].click());
  await page.waitForFunction(() => document.querySelector('#memory-hud').dataset.style === 'bars');
  await monitor.press('ArrowDown');
  await application.evaluate(() => globalThis.monitorFixture.menu[2].click());
  await page.locator('#process-graphs-hud').waitFor({ state: 'visible' });
  assert.equal(await monitor.getAttribute('aria-pressed'), 'true');
  assert.ok(
    (await segmentCount()) > beforeCollapse,
    'Samples while collapsed must extend the curve',
  );
  await monitor.locator('svg').click();
  await page.locator('#process-graphs-hud').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#memory-hud').getAttribute('data-style'), 'bars');
  report.checks.push(
    'One-click graph toggle, three native styles, keyboard menu and preserved fallback',
  );
  await page.screenshot({ path: path.join(folder, 'portrait-bars.png') });
  report.checks.push('Enabled by default, live RAM, portrait layout');
  assert.equal(await page.locator('#memory-hud .memory-gauge').count(), 4);
  assert.equal(await contextButton.locator('strong').textContent(), '—');
  assert.match(await contextButton.getAttribute('title'), /tokens/);
  const settingsOpened = application.waitForEvent('window', { timeout: 15000 });
  await contextButton.click();
  const settings = await settingsOpened;
  await settings.waitForURL('**/settings.html');
  const contextFocused = async () => {
    await settings.waitForFunction(() => document.activeElement?.id === 'models-context');
    const rect = await settings.locator('#models-context').boundingBox();
    const body = await settings.locator('body').boundingBox();
    assert(
      rect && rect.y > 0 && rect.y + rect.height <= body.height,
      'Context selector is scrolled into view',
    );
  };
  await contextFocused();
  await settings.screenshot({ path: path.join(folder, 'context-shortcut.png') });
  await settings.locator('#settings-window-close').click();
  report.checks.push(
    'CTX opens a new settings window directly at context; unavailable usage stays unknown',
  );
  await page.evaluate(() => window.capri.openSettings('appearance'));
  await settings.locator('#memory-style').waitFor();
  await settings.locator('#memory-style').selectOption('rings');
  const interval = settings.locator('#memory-interval');
  assert.deepEqual(
    await interval
      .locator('option')
      .evaluateAll((options) => options.map((option) => Number(option.value))),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
  await interval.selectOption('2');
  await page.waitForFunction(() => document.querySelector('#memory-hud').dataset.style === 'rings');
  await fit();
  await settings.screenshot({ path: path.join(folder, 'settings.png') });
  await settings.locator('#settings-window-close').click();
  await settings.locator('#settings-apply').click();
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).companion.memoryIntervalSeconds,
    2,
  );
  await page.evaluate(() => window.capri.windowAction('portrait'));
  await page.waitForTimeout(700);
  await fit();
  await page.screenshot({ path: path.join(folder, 'compact-rings.png') });
  report.checks.push('Rings and refresh rate saved through Settings; compact layout');
  // The compact presence header deliberately hides the CTX shortcut.
  await page.evaluate(() => window.capri.windowAction('portrait', true));
  await contextButton.waitFor({ state: 'visible' });
  await contextButton.focus();
  await contextButton.press('Enter');
  await contextFocused();
  await settings.locator('#settings-window-close').click();
  report.checks.push('Keyboard activation navigates reused settings; rings stay clickable');
  await page.evaluate(() => window.capri.windowAction('portrait', false));
  await page.evaluate(() => window.capri.openSettings('appearance'));
  await settings.locator('#memory-style').selectOption('bars');
  await page.waitForFunction(() => document.querySelector('#memory-hud').dataset.style === 'bars');
  await fit();
  report.checks.push('All four default resource bars fit in the compact instrument rail');
  const fieldVisible = await page.locator('#message').isVisible();
  await settings.locator('#memory-monitor').uncheck();
  assert.equal(await settings.locator('#memory-style').isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('#memory-hud').hidden);
  assert.equal(await contextButton.isHidden(), true);
  assert.equal(await page.locator('#message').isVisible(), fieldVisible);
  assert.equal(await page.evaluate(() => window.capri.memoryStatus()), null);
  report.checks.push('Disabled monitor stops sampling and preserves composer visibility');
  await settings.locator('#memory-monitor').check();
  await page.waitForFunction(() => !document.querySelector('#memory-hud').hidden);
  const metric = (group, id) =>
    settings.locator(`[data-resource-display="${group}"][value="${id}"]`);
  await settings.locator('#process-graphs').check();
  const graphCount = settings.locator('#resource-graph-count');
  assert.equal(await graphCount.textContent(), '4/4');
  assert.equal(await metric('graphMetrics', 'disk').isDisabled(), true);
  await metric('graphMetrics', 'disk').press('Space');
  assert.equal(await metric('graphMetrics', 'disk').isChecked(), false);
  assert.equal(await graphCount.getAttribute('data-limit-hit'), '');
  assert.equal(await graphCount.textContent(), '4/4');
  await metric('graphMetrics', 'gpu').uncheck();
  assert.equal(await graphCount.textContent(), '3/4');
  await metric('graphMetrics', 'disk').check();
  await metric('graphMetrics', 'cpu').uncheck();
  await metric('graphMetrics', 'cpuTemperature').check();
  const graphs = page.locator('#process-graphs-hud');
  await graphs
    .locator('[data-resource-metric="cpuTemperature"] strong')
    .filter({ hasText: '44 °C' })
    .waitFor();
  await application.evaluate(() => {
    globalThis.monitorFixture.cpuTemperature = null;
  });
  const cpuCard = graphs.locator('[data-resource-metric="cpuTemperature"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-resource-metric="cpuTemperature"]')
      ?.title.includes('127.0.0.1:8085'),
  );
  assert.equal(await cpuCard.locator('.process-graph-reading').textContent(), 'Unavailable');
  await application.evaluate(() => {
    globalThis.monitorFixture.cpuTemperature = 44;
  });
  await page.waitForFunction(
    () =>
      document.querySelector('#process-graphs-hud [data-resource-metric="disk"]')?.dataset
        .available === 'true',
  );
  assert.equal(await graphs.locator('.process-graph').count(), 4);
  const plot = graphs.locator('[data-resource-metric="ram"]');
  const measurePlot = () =>
    plot.evaluate((card) => {
      const rect = card.querySelector('svg').getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        seconds: Number(
          card.querySelector('.process-graph-time > span').textContent.replace(/[^\d]/g, ''),
        ),
      };
    });
  const fourGraphs = await measurePlot();
  for (const id of ['vram', 'cpuTemperature', 'disk']) await metric('graphMetrics', id).uncheck();
  await page.waitForFunction(
    () => document.querySelectorAll('#process-graphs-hud .process-graph').length === 1,
  );
  assert.equal(await graphCount.textContent(), '1/4');
  const singleGraph = await measurePlot();
  assert.ok(singleGraph.width > fourGraphs.width * 3);
  assert.equal(singleGraph.height, fourGraphs.height);
  for (const graph of [fourGraphs, singleGraph])
    assert.equal(graph.seconds, Math.round(graph.width));
  for (const id of ['vram', 'cpuTemperature', 'disk']) await metric('graphMetrics', id).check();
  report.checks.push(
    'The graph limit shakes at four and wider charts show longer history at the same height',
  );
  await settings.locator('#process-graphs').uncheck();
  await metric('meterMetrics', 'vram').uncheck();
  await metric('meterMetrics', 'capriRam').check();
  const gauges = page.locator('#memory-hud');
  await gauges
    .locator('[data-resource-metric="capriRam"] strong')
    .filter({ hasText: '0.9 GiB' })
    .waitFor();
  assert.equal(await gauges.locator('.memory-gauge:visible').count(), 4);
  await fit();
  await settings.locator('#settings-window-close').click();
  await settings.locator('#settings-apply').click();
  const { graphMetrics, meterMetrics } = (await page.evaluate(() => window.capri.bootstrap()))
    .companion;
  assert.deepEqual(new Set(graphMetrics), new Set(['ram', 'vram', 'cpuTemperature', 'disk']));
  assert.deepEqual(new Set(meterMetrics), new Set(['cpu', 'gpu', 'ram', 'capriRam']));
  report.checks.push(
    'Independent four-item selections persist; disk, temperatures and Capri RAM display real values',
  );
  await page.evaluate(() => window.capri.hide());
  assert.equal(await page.evaluate(() => window.capri.memoryStatus()), null);
  report.checks.push('Hidden companion does not probe hardware');
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
