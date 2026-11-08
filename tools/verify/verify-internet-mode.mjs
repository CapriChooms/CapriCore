// SPDX-License-Identifier: GPL-3.0-only
// Isolated production Electron renderers, synthetic web events, no search or
// model requests, no OS pointer movement, and no owner profile or application.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { uiText } from '../../apps/desktop/renderer/interface-translations.mjs';

const parent = path.join(root, '.runtime/internet-mode-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
const moduleUrl = (file) => JSON.stringify(pathToFileURL(path.join(root, file)).href);
writeFileSync(
  entry,
  `
import {app,screen} from 'electron';
import {AvatarComposer} from ${moduleUrl('apps/desktop/main/avatar-composer.mjs')};
import {AvatarDetach} from ${moduleUrl('apps/desktop/main/avatar-detach.mjs')};
import {WebSearch} from ${moduleUrl('apps/desktop/web-search.mjs')};
globalThis.internetFixtureSearchAttempts=0;
WebSearch.prototype.search=async()=>{globalThis.internetFixtureSearchAttempts++;return {status:'unavailable',sources:[]};};
for(const name of ['sendState','sync']) {
 const original=AvatarComposer.prototype[name];
 AvatarComposer.prototype[name]=function(...args){globalThis.internetFixtureComposer=this;return original.apply(this,args);};
}
const leave=AvatarDetach.prototype.leave;
AvatarDetach.prototype.leave=function(...args){globalThis.internetFixtureDetach=this;return leave.apply(this,args);};
app.once('ready',()=>{
 const cursor=screen.getCursorScreenPoint.bind(screen);
 screen.getCursorScreenPoint=()=>{
  const bounds=globalThis.internetFixtureComposer?.bounds;
  return globalThis.internetFixtureNear && bounds ? {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2} : cursor();
 };
});
await import(${moduleUrl('apps/desktop/main.mjs')});
`,
);
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(
  path.join(folder, 'desktop/languages.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: {
      interface: 'ru',
      conversation: 'en',
      recognition: 'follow',
      speech: 'en',
      autoDetect: false,
      customConversation: '',
    },
  }),
);
const report = {
  passed: false,
  folder,
  checks: [],
  errors: [],
  screenshots: [],
  externalSearches: 0,
  modelRequests: 0,
  physicalPointerMoved: false,
  ownerDataUsed: false,
};
const server = createServer((req, res) => {
  if (req.url !== '/v1/models') report.modelRequests++;
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  TEMP: folder,
  TMP: folder,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
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
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const owner = BrowserWindow.getAllWindows().find(
      (view) => view.webContents.getURL() === 'capri://desktop/index.html',
    );
    owner.webContents.send('capri:event', { type: 'startup-intro.skip' });
    owner.setMinimumSize(280, 400);
    owner.showInactive();
    globalThis.internetFixtureOwner = owner;
    globalThis.internetFixtureSourceCalls = [];
    ipcMain.removeHandler('capri:web-source-open');
    ipcMain.handle('capri:web-source-open', (event, value) => {
      if (event.sender !== owner.webContents) throw Error('Unexpected source sender.');
      globalThis.internetFixtureSourceCalls.push(value);
      return true;
    });
  });
  const globe = page.locator('#internet-toggle');
  await globe.waitFor({ state: 'visible' });
  assert.equal(await globe.getAttribute('aria-pressed'), 'false');
  assert.equal(await globe.getAttribute('aria-label'), uiText('Internet mode: Off', 'ru'));
  assert(
    (await globe.getAttribute('title')).includes(
      uiText(
        'Search the web for the current request only. Chat history, screenshots and files are not sent automatically.',
        'ru',
      ),
    ),
  );
  await globe.click();
  await page.waitForFunction(
    () => document.getElementById('internet-toggle').getAttribute('aria-pressed') === 'true',
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).internet.enabled, true);
  await page.waitForTimeout(200);
  report.globeStyle = await globe.evaluate((node) => {
    const rules = [];
    const walk = (entries, sheet) => {
      for (const rule of entries) {
        if (rule.cssRules) walk(rule.cssRules, sheet);
        if (!rule.selectorText || !rule.style?.color) continue;
        try {
          if (node.matches(rule.selectorText))
            rules.push({
              sheet,
              selector: rule.selectorText,
              color: rule.style.color,
              priority: rule.style.getPropertyPriority('color'),
            });
        } catch {}
      }
    };
    for (const sheet of document.styleSheets)
      try {
        walk(sheet.cssRules, sheet.href);
      } catch {}
    return {
      pressed: node.getAttribute('aria-pressed'),
      style: node.getAttribute('style'),
      color: getComputedStyle(node).color,
      visibility: document.visibilityState,
      rules,
    };
  });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.getElementById('internet-toggle')).color === 'rgb(255, 237, 82)',
    null,
    { timeout: 1500 },
  );
  assert.equal(await globe.evaluate((node) => getComputedStyle(node).color), 'rgb(255, 237, 82)');
  report.checks.push(
    'main globe is localized, defaults off, and turns yellow after the real host toggle',
  );
  for (const width of [490, 320]) {
    await application.evaluate(
      ({}, width) => globalThis.internetFixtureOwner.setContentSize(width, 760),
      width,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    const geometry = await page.locator('.composer').evaluate((node) => {
      const host = node.getBoundingClientRect();
      return [...node.querySelectorAll('button,textarea')]
        .filter((item) => getComputedStyle(item).display !== 'none')
        .map((item) => {
          const rect = item.getBoundingClientRect();
          return {
            id: item.id,
            inside: rect.left >= host.left - 1 && rect.right <= host.right + 1,
          };
        });
    });
    assert(
      geometry.every((item) => item.inside),
      'Main composer controls must fit at width ' + width,
    );
    const file = path.join(folder, `main-${width}.png`);
    await page.locator('.composer').screenshot({ path: file });
    report.screenshots.push(file);
    if (width === 320) {
      const empty = await page.locator('#message').evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        whiteSpace: getComputedStyle(node).whiteSpace,
      }));
      assert.equal(empty.whiteSpace, 'pre', 'Narrow empty placeholder should stay on one line.');
      await page
        .locator('#message')
        .fill(
          'A long synthetic typed line that must still wrap naturally in a narrow composer.\nA second synthetic line.',
        );
      const typed = await page.locator('#message').evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        whiteSpace: getComputedStyle(node).whiteSpace,
        value: node.value,
      }));
      assert.equal(typed.whiteSpace, 'pre-wrap', 'Typed text must retain normal wrapping.');
      assert(
        typed.height > empty.height && typed.value.includes('\n'),
        'Typed multiline input should still grow.',
      );
      await page.locator('#message').fill('');
      report.checks.push(
        'narrow empty placeholder stays single-line while typed multiline text wraps and grows',
      );
    }
  }
  await application.evaluate(() => {
    globalThis.internetFixtureNear = true;
    globalThis.internetFixtureOwner.setContentSize(490, 760);
  });
  await page.waitForFunction(() => !document.getElementById('avatar-detach').disabled, null, {
    timeout: 20000,
  });
  await page.locator('#avatar-detach').click();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await application.evaluate(() => globalThis.internetFixtureDetach?.available === true))
      break;
    await page.waitForTimeout(100);
  }
  assert(await application.evaluate(() => globalThis.internetFixtureDetach?.available === true));
  await application.evaluate(() => globalThis.internetFixtureComposer.setMode('text'));
  let mini;
  for (let attempt = 0; attempt < 100 && !mini; attempt++) {
    mini = application.windows().find((view) => view.url().includes('avatar-composer.html'));
    if (!mini) await page.waitForTimeout(100);
  }
  assert(mini, 'The production mini composer must open.');
  await mini.waitForFunction(
    () => document.getElementById('mini-composer').dataset.visible === 'true',
  );
  await mini.waitForFunction(
    () => document.getElementById('internet-toggle').getAttribute('aria-pressed') === 'true',
  );
  assert.equal(
    await mini.locator('#internet-toggle').getAttribute('aria-label'),
    uiText('Internet mode: On', 'ru'),
  );
  await mini.waitForFunction(
    () =>
      getComputedStyle(document.getElementById('internet-toggle')).color === 'rgb(255, 237, 82)',
    null,
    { timeout: 1500 },
  );
  assert.equal(
    await mini.locator('#internet-toggle').evaluate((node) => getComputedStyle(node).color),
    'rgb(255, 237, 82)',
  );
  await mini.locator('#internet-toggle').click();
  await page.waitForFunction(
    () => document.getElementById('internet-toggle').getAttribute('aria-pressed') === 'false',
  );
  await mini.waitForFunction(
    () => document.getElementById('internet-toggle').getAttribute('aria-pressed') === 'false',
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).internet.enabled, false);
  await mini.locator('#internet-toggle').click();
  await page.waitForFunction(
    () => document.getElementById('internet-toggle').getAttribute('aria-pressed') === 'true',
  );
  report.checks.push(
    'expanded production mini globe and main globe stay synchronized through actual IPC',
  );
  const turnId = 'internet-ui-synthetic-turn';
  const assistant = {
    id: 'internet-ui-assistant',
    role: 'assistant',
    turnId,
    text: '',
    status: 'streaming',
  };
  const emit = (event) =>
    application.evaluate(
      ({}, event) => globalThis.internetFixtureOwner.webContents.send('capri:event', event),
      event,
    );
  await emit({ type: 'turn.started', turnId, silent: true, source: 'text', assistant });
  await emit({ type: 'turn.web-search', turnId, phase: 'searching' });
  await page.waitForFunction(
    (text) => document.getElementById('internet-status').textContent === text,
    uiText('Searching the web…', 'ru'),
  );
  await mini.waitForFunction(
    (text) => document.getElementById('composer-status').textContent === text,
    uiText('Searching the web…', 'ru'),
  );
  assert.equal(await globe.isDisabled(), true);
  assert.equal(await mini.locator('#internet-toggle').isDisabled(), true);
  const sources = [
    { title: 'Synthetic source <img src=x>', url: 'https://example.com/research' },
    { title: 'Blocked unsafe source', url: 'javascript:alert(1)' },
  ];
  await emit({ type: 'turn.web-search', turnId, phase: 'ready', sources });
  await application.evaluate(() => globalThis.internetFixtureOwner.showInactive());
  await page.locator('#history-toggle').evaluate((button) => {
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
  });
  await page.locator('.message-source-heading').waitFor();
  assert.equal(await page.locator('.message-source-heading').innerText(), uiText('Sources', 'ru'));
  assert.equal(await page.locator('.message-web-sources button').count(), 1);
  assert.equal(await page.locator('.message-web-sources img,.message-web-sources a').count(), 0);
  await page.locator('.message-web-sources button').click();
  assert.deepEqual(await application.evaluate(() => globalThis.internetFixtureSourceCalls), [
    { turnId, index: 0 },
  ]);
  for (const message of [
    'Web search found no results.',
    'Web search was skipped because the request may contain private credentials.',
  ]) {
    await emit({ type: 'turn.web-search', turnId, phase: 'unavailable', message });
    await page.waitForFunction(
      (text) => document.getElementById('internet-status').textContent === text,
      uiText(message, 'ru'),
    );
    await mini.waitForFunction(
      (text) => document.getElementById('composer-status').textContent === text,
      uiText(message, 'ru'),
    );
  }
  await emit({
    type: 'turn.completed',
    turnId,
    assistant: {
      ...assistant,
      text: 'Synthetic answer [1].',
      status: 'completed',
      webSources: sources,
    },
  });
  await page.waitForFunction(() => document.getElementById('internet-status').hidden);
  await mini.waitForFunction(() => !document.getElementById('internet-toggle').disabled);
  assert.equal(await globe.getAttribute('aria-pressed'), 'true');
  report.checks.push(
    'localized current-turn status reaches both bars, busy disables both, and source titles render as plain text with bounded host intents',
  );
  const miniFile = path.join(folder, 'mini-expanded.png');
  await mini.locator('#mini-composer').screenshot({ path: miniFile });
  report.screenshots.push(miniFile);
  const sourcesFile = path.join(folder, 'sources.png');
  await page.locator('.message-web-sources').screenshot({ path: sourcesFile });
  report.screenshots.push(sourcesFile);
  assert.equal(report.modelRequests, 0);
  assert.equal(await application.evaluate(() => globalThis.internetFixtureSearchAttempts), 0);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.message).slice(0, 1800);
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
