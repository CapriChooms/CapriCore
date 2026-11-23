// SPDX-License-Identifier: GPL-3.0-only
// Exercises the actual Settings renderer/IPC, without models or owner data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'developer-')),
  logs = path.join(folder, 'logs');
mkdirSync(logs);
const id = randomUUID(),
  requestId = randomUUID(),
  start = Date.now() - 5000;
const record = (stage, ms, source = 'desktop', extra = {}) => ({
  event: 'response-timing',
  traceId: id,
  source,
  stage,
  time: new Date(start + ms).toISOString(),
  elapsedMs: ms,
  ...extra,
});
writeFileSync(
  path.join(logs, 'response-desktop.jsonl'),
  [
    record('received', 0),
    record('chat_started', 5),
    record('model_start', 10),
    record('model_ready', 100),
    record('routing_start', 100),
    record('routing_ready', 150),
    record('intent_start', 150),
    record('intent_ready', 300),
    record('context_start', 300),
    record('context_ready', 310),
    record('gateway_dispatch', 315),
    record('gateway_first_token', 1700),
    record('first_delta', 1710),
    record('first_paint', 1720, 'renderer'),
    record('completed', 4400),
  ]
    .map(JSON.stringify)
    .join('\n') + '\n',
);
writeFileSync(
  path.join(logs, 'response-provider.jsonl'),
  [
    record('provider_request', 340, 'provider', {
      requestId,
      modelId: 'capri-qwen3.5:4b',
      inputCharacters: 16000,
    }),
    record('provider_first_token', 1650, 'provider', { requestId }),
    record('provider_first_content', 1650, 'provider', { requestId }),
    record('provider_finished', 4200, 'provider', {
      requestId,
      loadMs: 5,
      promptEvalMs: 1300,
      evalMs: 2500,
      promptTokens: 6000,
      outputTokens: 160,
    }),
  ]
    .map(JSON.stringify)
    .join('\n') + '\n',
);
const voiceLog = path.join(logs, 'voice.stderr.log');
writeFileSync(
  voiceLog,
  'Authorization: Bearer sk-NOT-A-REAL-KEY\nPrivate fixture conversation\n' +
    JSON.stringify({
      event: 'failure',
      stage: 'starting',
      code: 'CUDA_OUT_OF_MEMORY',
      password: 'NEVER_SHOW_ME',
    }) +
    '\n',
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
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const page = await application.firstWindow();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  const denied = await page.evaluate(async () => {
    try {
      await window.capri.developerDiagnostics();
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(denied, true);
  report.checks.push('Diagnostic IPC is restricted to Settings');
  const view = await settingsView(application, 'developer');
  await view.waitForFunction(() => document.getElementById('developer-turn').options.length > 0);
  assert.equal(await view.locator('#developer-metrics strong').count(), 4);
  assert.equal(await view.locator('.developer-call').count(), 1);
  assert((await view.locator('#developer-metrics').innerText()).includes('1,710'));
  assert((await view.locator('.developer-call').innerText()).includes('64'));
  report.checks.push('Correlated stage timings and provider throughput');
  assert.equal(await view.locator('#developer-events tbody tr').count(), 0);
  await view.locator('.developer-events summary').click();
  assert.equal(await view.locator('#developer-events tbody tr').count(), 19);
  await view.locator('.developer-events summary').click();
  report.checks.push('Timing events are populated only when expanded');
  const snapshot = await view.evaluate(() => window.capri.developerDiagnostics());
  await view
    .locator('#developer-log')
    .selectOption(snapshot.logs.find((x) => x.name === 'voice.stderr.log').id);
  await view.waitForFunction(() =>
    document.getElementById('developer-log-content').textContent.includes('CUDA_OUT_OF_MEMORY'),
  );
  assert(
    !/NEVER_SHOW_ME|Private fixture conversation|NOT-A-REAL-KEY/.test(
      await view.locator('#developer-log-content').innerText(),
    ),
  );
  appendFileSync(voiceLog, '\n{"event":"failure","code":"EPIPE"}\n');
  await view.waitForFunction(() =>
    document.getElementById('developer-log-content').textContent.includes('EPIPE'),
  );
  await view.locator('#developer-live').uncheck();
  appendFileSync(voiceLog, '\n{"event":"failure","code":"EACCES"}\n');
  await view.waitForTimeout(3500);
  assert(!(await view.locator('#developer-log-content').innerText()).includes('EACCES'));
  await view.locator('#developer-refresh').click();
  await view.waitForFunction(() =>
    document.getElementById('developer-log-content').textContent.includes('EACCES'),
  );
  report.checks.push('Live logs, pause, manual refresh and private text exclusion');
  const invalid = await view.evaluate(async () => {
    try {
      await window.capri.developerLog('../config/core.local.json');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(invalid, true);
  for (const locale of process.argv.includes('--en-only') ? ['en'] : ['en', 'ru']) {
    await view.evaluate(async (locale) => {
      const snapshot = await window.capri.bootstrap();
      await window.capri.setLanguages(
        { ...snapshot.languages, interface: locale },
        snapshot.settingsVersions.languages,
      );
    }, locale);
    await view.waitForFunction((locale) => document.documentElement.lang === locale, locale);
    await view.waitForTimeout(150);
    if (locale === 'ru')
      assert.equal(await view.locator('#developer-panel h2').innerText(), 'Для разработчиков');
    for (const width of [680, 940]) {
      await application.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().endsWith('/settings.html'))
            .setSize(width, 780),
        width,
      );
      await view.locator('#companion').evaluate((node) => (node.scrollTop = 0));
      await view.waitForTimeout(150);
      assert.equal(
        await view.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await view.screenshot({ path: path.join(folder, locale + '-' + width + '-timings.png') });
      await view.locator('#developer-logs-title').scrollIntoViewIfNeeded();
      await view.screenshot({ path: path.join(folder, locale + '-' + width + '-logs.png') });
    }
  }
  report.checks.push(
    process.argv.includes('--en-only')
      ? 'English narrow/wide layouts'
      : 'English/Russian narrow/wide layouts',
  );
  await view.locator('#settings-window-close').click();
  const reopened = await settingsView(application, 'developer');
  await reopened.waitForFunction(
    () => document.getElementById('developer-turn').options.length > 0,
  );
  await reopened.locator('[data-section="general"]').click();
  assert.equal(await reopened.locator('#developer-panel').isVisible(), false);
  report.checks.push('Reopening and navigation away');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
