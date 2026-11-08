// SPDX-License-Identifier: GPL-3.0-only
// All notes are synthetic and live in an isolated verification workspace.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { LANGUAGE_DEFAULTS } from '../../apps/desktop/renderer/language-settings.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'saved-memory-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});`,
);
let requests = 0;
const server = createServer((request, response) => {
  if (request.method !== 'GET') requests++;
  response.setHeader('Content-Type', 'application/json');
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
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(
  path.join(folder, 'desktop/languages.json'),
  JSON.stringify({ schemaVersion: 1, settings: { ...LANGUAGE_DEFAULTS, interface: 'ru' } }),
);
writeFileSync(
  path.join(rt.workspace, 'USER.md'),
  '# User\n\n- Preferred test language: Russian.\n',
);
writeFileSync(
  path.join(rt.workspace, 'MEMORY.md'),
  '# Memory\n\n- The sample project is a garden sensor.\n- Для тестового проекта важны короткие и понятные ответы.\n',
);
const notes = path.join(rt.workspace, 'memory/capri-owner-notes.md');
const markup = '<img src=x onerror="window.memoryExecuted=true"> is plain saved text.';
const original =
  '# Explicit owner notes\n\n- 2026-11-05 "My sample plant is a fern"\n- 2026-11-05 ' +
  JSON.stringify(markup) +
  '\n';
writeFileSync(notes, original);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 30000,
  });
  const owner = await app.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  const settings = await settingsView(app, 'dialogue');
  assert.equal(await settings.evaluate(() => document.documentElement.lang), 'ru');
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  settings.on('pageerror', (error) => errors.push(error.message));
  assert.equal(await settings.locator('#saved-memory-view').isHidden(), true);
  await settings.locator('#memory-view').click();
  await settings.waitForFunction(
    () => document.querySelectorAll('#saved-memory-list > li').length === 5,
  );
  assert.match(await settings.locator('#saved-memory-status').innerText(), /5/);
  assert.equal(await settings.locator('#saved-memory-list img').count(), 0);
  assert.equal(await settings.evaluate(() => window.memoryExecuted), undefined);
  assert.ok((await settings.locator('#saved-memory-list').innerText()).includes(markup));
  assert.equal((await settings.locator('#saved-memory-list').innerText()).includes(folder), false);
  assert.equal(
    JSON.stringify(await owner.evaluate(() => window.capri.bootstrap())).includes(
      'My sample plant',
    ),
    false,
  );
  await settings
    .locator('#memory-view')
    .evaluate((node) => node.closest('[data-companion-group]').scrollIntoView({ block: 'start' }));
  await settings.screenshot({ path: path.join(folder, 'saved-memories-ru.png') });
  const search = settings.locator('#saved-memory-search');
  await search.fill('fern');
  assert.equal(await settings.locator('#saved-memory-list > li').count(), 1);
  await search.fill('несуществующая запись');
  assert.equal(await settings.locator('#saved-memory-list > li').count(), 0);
  assert.ok((await settings.locator('#saved-memory-status').innerText()).length > 10);
  await search.fill('');
  writeFileSync(notes, original + '- 2026-11-05 "My sample plant needs indirect light"\n');
  await settings.locator('#saved-memory-refresh').click();
  await settings.waitForFunction(
    () => document.querySelectorAll('#saved-memory-list > li').length === 6,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL() === 'capri://desktop/settings.html')
      .setSize(520, 680),
  );
  await settings
    .locator('#memory-view')
    .evaluate((node) => node.closest('[data-companion-group]').scrollIntoView({ block: 'start' }));
  await settings.screenshot({ path: path.join(folder, 'saved-memories-narrow.png') });
  const layout = await settings
    .locator('#saved-memory-view')
    .evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(
    layout.scroll <= layout.width + 1,
    'Memory viewer must not overflow in a narrow Settings window',
  );
  await settings.locator('[data-section="general"]').click();
  assert.equal(
    await settings.locator('#saved-memory-list > li').count(),
    0,
    'Leaving the tab releases private text',
  );
  await settings.locator('[data-section="dialogue"]').click();
  assert.equal(await settings.locator('#saved-memory-view').isHidden(), true);
  writeFileSync(path.join(rt.workspace, 'USER.md'), '');
  writeFileSync(path.join(rt.workspace, 'MEMORY.md'), '');
  writeFileSync(notes, '');
  await settings.locator('#memory-view').click();
  await settings.waitForFunction(
    () => document.getElementById('saved-memory-view').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await settings.locator('#saved-memory-list > li').count(), 0);
  await settings
    .locator('#saved-memory-view')
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await settings.screenshot({ path: path.join(folder, 'saved-memories-empty.png') });
  await assert.rejects(
    owner.evaluate(() => window.capri.readSavedMemory()),
    /Memory controls/,
  );
  assert.equal(requests, 0, 'Viewing and filtering memory must never call the model');
  assert.deepEqual(errors, []);
  console.log(
    'PASS real Settings: private memory read, literal markup, search, refresh, empty state, narrow layout and tab cleanup.',
  );
  console.log('Screenshots: ' + folder);
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
