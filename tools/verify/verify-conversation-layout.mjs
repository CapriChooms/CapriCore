// SPDX-License-Identifier: GPL-3.0-only
// Native verification window and synthetic transcript only. No models, capture or owner history.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/conversation-layout-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const state = path.join(folder, 'desktop');
mkdirSync(state, { recursive: true });
writeFileSync(
  path.join(state, 'transcript.json'),
  JSON.stringify({
    schemaVersion: 1,
    messages: Array.from({ length: 20 }, (_, index) => ({
      id: 'layout-message-' + index,
      turnId: 'layout-turn-' + index,
      role: index % 2 ? 'assistant' : 'user',
      text:
        'Synthetic conversation message ' +
        (index + 1) +
        '. ' +
        'The city lights stretch across the quiet room. This sample keeps several lines of readable text in the conversation drawer. ' +
        'Scroll through these generated messages to check the toolbar, heading and composer.',
      createdAt: '2026-11-06T09:00:00.000Z',
      status: 'complete',
    })),
  }),
);
writeFileSync(
  path.join(state, 'companion.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: { floatEnabled: false, glitchEnabled: false, teleportSound: 'off', wakeSound: 'off' },
  }),
);
const entry = path.join(folder, 'fixture-main.mjs');
writeFileSync(
  entry,
  `
import { app, session } from 'electron';
globalThis.conversationBlockedRequests = [];
const fetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(input.url ?? input);
  if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {
    globalThis.conversationBlockedRequests.push(url.origin);
    throw new Error('External network is disabled in conversation verification.');
  }
  return fetch(input, ...args);
};
app.once('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const blocked = ['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1';
    if (blocked) globalThis.conversationBlockedRequests.push(url.origin);
    callback({ cancel: blocked });
  });
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
const unexpectedRequests = [];
const server = createServer((request, response) => {
  if (request.url === '/v1/models') {
    response.setHeader('content-type', 'application/json');
    response.end('{"data":[]}');
    return;
  }
  unexpectedRequests.push(request.url);
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = initialize(
  runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    gatewayPort: server.address().port,
  }),
);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const report = {
  passed: false,
  folder,
  checks: [],
  layouts: [],
  screenshots: [],
  skippedSizes: [],
  errors: [],
  models: false,
  microphone: false,
  systemAudio: false,
  externalNetwork: false,
  ownerHistory: false,
};
let application;
let page;
const paint = () =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
const presence = async (mode) => {
  if ((await page.getAttribute('body', 'data-presence')) !== mode)
    await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction((mode) => document.body.dataset.presence === mode, mode);
  await paint();
};
const layout = () =>
  page.evaluate(() => {
    const rect = (element) => {
      const { x, y, top, right, bottom, left, width, height } = element.getBoundingClientRect();
      return { x, y, top, right, bottom, left, width, height };
    };
    const element = (selector) => rect(document.querySelector(selector));
    const messages = document.getElementById('messages');
    const close = document.getElementById('history-close');
    const closeBox = rect(close);
    const closeHit = document.elementFromPoint(
      closeBox.x + closeBox.width / 2,
      closeBox.y + closeBox.height / 2,
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      presence: document.body.dataset.presence,
      detached: document.body.dataset.avatarDetach,
      handle: element('#handle'),
      quick: element('#quick-actions'),
      history: element('#history-panel'),
      heading: element('.history-heading'),
      messages: element('#messages'),
      composer: element('#input-dock'),
      buttons: [...document.querySelectorAll('#handle button, #quick-actions button')]
        .filter(
          (button) =>
            button.getClientRects().length && getComputedStyle(button).visibility === 'visible',
        )
        .map((button) => ({ id: button.id, ...rect(button) })),
      closeClickable: close === closeHit || close.contains(closeHit),
      scroll: {
        top: messages.scrollTop,
        height: messages.scrollHeight,
        client: messages.clientHeight,
      },
    };
  });
function assertHistory(value, name) {
  const { history, heading, messages, composer, viewport } = value;
  for (const item of [value.handle, value.quick, ...value.buttons]) {
    assert(item.bottom <= history.top + 1, name + ' toolbar stays above Conversation');
  }
  assert(history.left >= -1 && history.right <= viewport.width + 1, name + ' horizontal bounds');
  assert(history.top >= 0 && history.bottom <= viewport.height + 1, name + ' vertical bounds');
  assert(history.bottom <= composer.top + 1, name + ' Conversation stays above composer');
  assert(messages.top >= heading.bottom - 1, name + ' heading stays outside the message scroller');
  assert(
    messages.bottom <= history.bottom + 1,
    name + ' message scroller stays inside Conversation',
  );
  assert(messages.height > 20 && value.scroll.client > 20, name + ' readable scroller height');
  assert(value.scroll.height > value.scroll.client + 10, name + ' synthetic messages overflow');
  assert(value.closeClickable, name + ' close button is unobstructed');
}
async function scenario({ name, width, height, fromCore = false, screenshot, close = 'button' }) {
  const content = await application.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().endsWith('/index.html'),
      );
      window.setBounds({ ...window.getBounds(), ...size }, false);
      return window.getContentBounds();
    },
    { width, height },
  );
  await page.waitForFunction(
    ({ width, height }) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1,
    content,
  );
  if (Math.abs(content.width - width) > 1 || Math.abs(content.height - height) > 1) {
    report.skippedSizes.push({ requested: { width, height }, actual: content });
    return;
  }
  await presence('portrait');
  await paint();
  const before = await layout();
  if (fromCore) await presence('core');
  await page.locator('#history-toggle').click({ force: true });
  await page.locator('#history-panel').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await paint();
  assert.equal(await page.locator('#history-toggle').getAttribute('aria-expanded'), 'true');
  await page.locator('#messages').evaluate((element) => element.scrollTo(0, 0));
  await paint();
  const first = await layout();
  assertHistory(first, name);
  assert.equal(first.detached, before.detached, name + ' preserves avatar attachment');
  assert.equal(first.scroll.top, 0);
  await page.locator('#messages').evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await paint();
  const last = await layout();
  assertHistory(last, name);
  assert(
    Math.abs(last.scroll.top + last.scroll.client - last.scroll.height) <= 1,
    name + ' scroll reaches last message',
  );
  report.layouts.push({ name, first, last });
  if (screenshot) {
    const file = path.join(folder, screenshot + '.png');
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  }
  if (close === 'escape') await page.keyboard.press('Escape');
  else await page.locator('#history-close').click();
  await page.locator('#history-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#history-toggle').getAttribute('aria-expanded'), 'false');
  await paint();
  const after = await layout();
  assert.equal(after.detached, before.detached, name + ' closing preserves avatar attachment');
  for (const section of ['handle', 'quick', 'composer'])
    for (const dimension of ['x', 'y', 'width', 'height'])
      assert(
        Math.abs(before[section][dimension] - after[section][dimension]) <= 1,
        name + ' closing restores ' + section + ' ' + dimension,
      );
  report.checks.push(
    name + ' toolbar ordering, scrolling, close hit target and layout restoration',
  );
}
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () => document.body.dataset.phase === 'ready' && document.body.dataset.initialized === 'true',
    null,
    { timeout: 30000 },
  );
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/index.html'),
    );
    owner.webContents.setAudioMuted(true);
    owner.webContents.setBackgroundThrottling(false);
    owner.showInactive();
  });
  await paint();
  assert.equal(await page.locator('#messages .message').count(), 20);
  await scenario({
    name: 'portrait',
    width: 480,
    height: 660,
    screenshot: 'conversation-portrait',
  });
  await scenario({
    name: 'narrow',
    width: 320,
    height: 480,
    screenshot: 'conversation-narrow',
    close: 'escape',
  });
  await scenario({ name: 'small', width: 320, height: 360 });
  await scenario({
    name: 'opened from core',
    width: 480,
    height: 660,
    fromCore: true,
    screenshot: 'conversation-from-core',
    close: 'escape',
  });
  await page.locator('#avatar-detach').click({ force: true });
  await page.waitForFunction(
    () =>
      document.body.dataset.avatarDetach === 'detached' &&
      document.body.dataset.avatarDock === 'compact',
  );
  await scenario({
    name: 'detached compact',
    width: 480,
    height: 660,
    screenshot: 'conversation-detached',
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(unexpectedRequests, []);
  report.blockedRequests = await application.evaluate(() => globalThis.conversationBlockedRequests);
  assert.deepEqual(report.blockedRequests, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    passed: report.passed,
    folder,
    checks: report.checks,
    screenshots: report.screenshots,
    skippedSizes: report.skippedSizes,
    errors: report.errors,
  }),
);
