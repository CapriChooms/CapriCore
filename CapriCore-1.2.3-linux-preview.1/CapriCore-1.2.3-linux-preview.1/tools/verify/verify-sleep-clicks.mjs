// SPDX-License-Identifier: GPL-3.0-only
/** Isolated real Electron regression; models, audio and personal profiles are not used. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { avatarBodyPartAt } from '../../apps/desktop/avatar-body-regions.mjs';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, 'sleep-clicks-'));
mkdirSync(path.join(fixture, 'desktop'));
writeFileSync(
  path.join(fixture, 'desktop/companion.json'),
  JSON.stringify({ schemaVersion: 1, settings: { glitchEnabled: false } }),
);
const entry = path.join(fixture, 'test-main.mjs');
writeFileSync(
  entry,
  [
    'import { AvatarDetach } from ' +
      JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main/avatar-detach.mjs')).href) +
      ';',
    'const leave = AvatarDetach.prototype.leave;',
    'AvatarDetach.prototype.leave = function (...args) {',
    '  globalThis.sleepClickAvatar = this;',
    '  return leave.apply(this, args);',
    '};',
    'const originalFetch = globalThis.fetch;',
    'globalThis.fetch = (input, options) => {',
    "  if (new URL(input).pathname === '/api/chat')",
    "    input = 'http://127.0.0.1:' + process.env.CAPRI_DESKTOP_VERIFICATION_PORT + '/api/chat';",
    '  return originalFetch(input, options);',
    '};',
    'await import(' +
      JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href) +
      ');',
  ].join('\n'),
);
const requests = [];
const reply = 'Hey! I was asleep. Quit poking me awake.';
let modelChecks = 0;
const gateway = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    modelChecks++;
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
  }
  if (request.method !== 'POST' || request.url !== '/api/chat')
    return response.writeHead(404).end();
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  response
    .writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ message: { content: reply } }));
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  stateDir: path.join(fixture, 'openclaw'),
  workspace: path.join(fixture, 'workspace'),
  gatewayPort: gateway.address().port,
  logPrefix: 'sleep-click-verification',
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(gateway.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const ownerUrl = 'capri://desktop/index.html';
const overlayUrl = 'capri://desktop/avatar-detach.html';
const errors = [];
let app;
let page;

async function waitFor(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(message);
}
async function snapshot() {
  return page.evaluate(() => window.capri.bootstrap());
}
async function sleep() {
  await page.evaluate(() =>
    window.capri.send({ id: crypto.randomUUID(), text: 'Capri, you can sleep.' }),
  );
  await waitFor(async () => (await snapshot()).power.phase === 'asleep', 'Capri did not sleep');
}
async function points(view, selector, attached) {
  const samples = await view.evaluate(
    async ({ selector, attached }) => {
      const { CRT_CURVATURE, screenSample } = await import('./screen-geometry.mjs');
      const image = document.querySelector(selector);
      await image.decode();
      const region = document.querySelector('#sprite-region');
      const rect = image.getBoundingClientRect();
      let lens;
      if (attached && document.body.dataset.crt === 'webgl') {
        const frame = document.querySelector('#portrait-panel').getBoundingClientRect();
        lens = {
          x: frame.x + 12,
          y: frame.y + 14,
          width: frame.width - 24,
          height: frame.height - 44,
          curve: CRT_CURVATURE,
        };
      }
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const result = [];
      for (let v = 0.16; v < 0.93; v += 0.012)
        for (let u = 0.15; u < 0.85; u += 0.012) {
          const point = {
            x: Math.round(rect.x + rect.width * u),
            y: Math.round(rect.y + rect.height * v),
          };
          if (attached && !region.contains(document.elementFromPoint(point.x, point.y))) continue;
          const projected = screenSample(point, lens);
          const sx = (projected.x - rect.x) / rect.width;
          const sy = (projected.y - rect.y) / rect.height;
          const opaque = [-0.006, 0, 0.006].every((dy) =>
            [-0.006, 0, 0.006].every(
              (dx) =>
                alpha[
                  (Math.floor((sy + dy) * canvas.height) * canvas.width +
                    Math.floor((sx + dx) * canvas.width)) *
                    4 +
                    3
                ] >= 230,
            ),
          );
          if (opaque) result.push({ point, u: sx, v: sy });
        }
      return result;
    },
    { selector, attached },
  );
  const result = {};
  for (const { point, u, v } of samples) {
    const part = avatarBodyPartAt(u, v, () => true);
    if (part === 'head' && v < 0.28 && u > 0.42 && u < 0.61) result.head ??= point;
    if (['torso', 'left-arm', 'right-arm', 'left-hand', 'right-hand'].includes(part))
      result.body ??= point;
  }
  assert.ok(result.head && result.body, 'Both head and body have stable opaque click targets');
  return result;
}
async function trackHearts(view) {
  await view.evaluate(() => {
    window.sleepClickHearts = 0;
    new MutationObserver((events) => {
      for (const event of events)
        for (const node of event.addedNodes)
          if (
            node.nodeType === 1 &&
            (node.matches('.avatar-headpat-hearts') || node.querySelector('.avatar-headpat-hearts'))
          )
            window.sleepClickHearts++;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
async function assertNoHearts(view) {
  assert.equal(await view.locator('.avatar-headpat-hearts').count(), 0);
  assert.equal(await view.evaluate(() => window.sleepClickHearts), 0);
}
async function desktopTap(point) {
  await app.evaluate(({ BrowserWindow }, point) => {
    const view = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/avatar-detach.html',
    );
    for (const type of ['mouseDown', 'mouseUp'])
      view.webContents.emit('before-mouse-event', {}, { ...point, type, button: 'left' });
  }, point);
}
async function assertAwakened(expected) {
  await waitFor(
    async () => {
      const state = await snapshot();
      const last = state.messages.at(-1);
      return (
        state.power.phase === 'awake' &&
        last?.origin?.kind === 'avatar-click' &&
        last.origin.awakened === true &&
        last.text === reply &&
        requests.length === expected
      );
    },
    'Ten sleeping taps did not wake Capri and deliver the verified annoyed reaction',
    20000,
  );
  const request = requests.at(-1);
  assert.deepEqual(request.tools, []);
  assert.equal(request.messages.length, 2, 'Only the gesture cue is sent, never private history');
  assert.match(
    request.messages.map((item) => item.content).join('\n'),
    /w(?:oke|oken|aking)|awaken/i,
  );
  assert.match(request.messages[0].content, /annoy|irritat|groggy/i);
}

try {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/index.html',
    );
    owner.showInactive();
    owner.webContents.setAudioMuted(true);
  });
  const presence = page.locator('#presence-toggle');
  if ((await presence.getAttribute('aria-pressed')) !== 'true')
    await presence.click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await sleep();
  await page.waitForFunction(
    () => document.getElementById('sprite').dataset.frame === 'idle-blink_closed',
  );
  await trackHearts(page);
  let target = await points(page, '#sprite', true);
  await page.mouse.move(target.head.x, target.head.y);
  await page.mouse.down();
  await page.mouse.move(target.head.x + 22, target.head.y + 14, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.equal((await snapshot()).power.phase, 'asleep', 'Dragging must not wake Capri');
  assert.equal(requests.length, 0);
  target = await points(page, '#sprite', true);
  for (let i = 0; i < 9; i++) {
    await page.mouse.click(target.head.x, target.head.y);
    await assertNoHearts(page);
  }
  await page.waitForTimeout(550);
  assert.equal((await snapshot()).power.phase, 'asleep', 'Nine taps must leave models unloaded');
  assert.equal(requests.length, 0);
  await page.mouse.click(target.body.x, target.body.y);
  await assertAwakened(1);
  await assertNoHearts(page);
  assert.equal(await page.locator('#subtitle-text').textContent(), reply);

  await page.waitForFunction(() => !document.getElementById('avatar-detach').disabled);
  await page.locator('#avatar-detach').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
  const overlay = app.windows().find((item) => item.url() === overlayUrl);
  assert.ok(overlay);
  overlay.on('pageerror', (error) => errors.push(error.message));
  await sleep();
  await overlay.waitForFunction(
    () => document.querySelector('#parked-avatar img').naturalWidth > 0,
  );
  await trackHearts(overlay);
  target = await points(overlay, '#parked-avatar img', false);
  await desktopTap(target.head);
  await assertNoHearts(overlay);
  await page.locator('#hide').click({ force: true });
  for (let i = 1; i < 9; i++) await desktopTap(target.head);
  await page.waitForTimeout(550);
  assert.equal((await snapshot()).power.phase, 'asleep');
  assert.equal(requests.length, 1);
  await assertNoHearts(overlay);
  await desktopTap(target.body);
  await assertAwakened(2);
  await overlay.waitForFunction(
    (text) => document.getElementById('avatar-reply-text').textContent === text,
    reply,
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
        .isVisible(),
    ),
    false,
    'Waking from taps must preserve avatar-only mode',
  );
  assert.equal((await snapshot()).windowSettings.avatarOnly, true);
  await assertNoHearts(overlay);
  await overlay.screenshot({ path: path.join(fixture, 'sleep-click-annoyed.png') });
  assert.ok(modelChecks >= 3, 'Both wake cycles passed through the real core reconnect path');
  assert.deepEqual(errors, []);
  console.log(
    'PASS sleeping drag, silent head taps, mixed-area tenth-tap wake, annoyed reaction, detached sleep and avatar-only preservation.',
  );
  console.log('Sleep-click screenshot: ' + path.join(fixture, 'sleep-click-annoyed.png'));
} finally {
  try {
    if (app) await app.close();
  } finally {
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
  }
}
