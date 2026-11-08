// SPDX-License-Identifier: GPL-3.0-only
// Real renderer and teleport lifecycle; isolated state, no model, audio or owner input.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const sourceRoot = path.resolve(process.argv[2] ?? root);
const parent = path.join(sourceRoot, '.runtime/avatar-face-centering');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
mkdirSync(path.join(folder, 'desktop'));
writeFileSync(
  path.join(folder, 'desktop/avatar-layout.json'),
  JSON.stringify({ schemaVersion: 1, x: 0, y: 0, zoom: 3 }),
);
const server = createServer((_request, response) =>
  response.setHeader('content-type', 'application/json').end('{"data":[]}'),
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let app, page;
const report = {
  passed: false,
  ownerDataAccessed: false,
  modelStarted: false,
  checks: [],
  errors: [],
};
const emit = (event) =>
  app.evaluate(
    ({ BrowserWindow }, event) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('/index.html'))
        .webContents.send('capri:event', event),
    event,
  );
const face = () =>
  page.evaluate(async () => {
    const { avatarPoseLandmarks } = await import('capri://desktop/avatar-mouth.mjs');
    const sprite = document.getElementById('sprite'),
      box = sprite.getBoundingClientRect(),
      frame = document.getElementById('portrait-panel').getBoundingClientRect();
    const [x, y] = avatarPoseLandmarks(sprite.dataset.frame)?.face ?? [646, 400];
    return {
      x: box.x + (box.width * x) / 1254,
      y: box.y + (box.height * y) / 1254,
      cx: frame.x + frame.width / 2,
      cy: frame.y + 14 + (frame.height - 44) / 2,
      zoom: document.getElementById('sprite-region').dataset.zoom,
      frame: sprite.dataset.frame,
      centering: document.body.dataset.avatarCentering === 'true',
    };
  });
const assertCentered = async (label) => {
  await page.waitForFunction(() => !document.body.dataset.avatarCentering);
  const point = await face();
  assert(
    Math.hypot(point.x - point.cx, point.y - point.cy) < 2,
    label + ': ' + JSON.stringify(point),
  );
  assert.equal(point.zoom, '3');
  report.checks.push(label);
};
const pan = async () => {
  const layout = await page.evaluate(() => window.capri.setAvatarLayout({ x: 0, y: 0, zoom: 3 }));
  // Native manual drags apply locally; their IPC deliberately does not echo back.
  await emit({ type: 'avatar.layout', layout });
};
const music = (enabled) =>
  emit({
    type: 'music.status',
    enabled,
    hearingMusic: enabled,
    tempo: enabled ? 120 : 0,
    tempoConfidence: enabled ? 0.8 : 0,
    phase: 'ready',
    settings: { enabled, notes: false, motion: false, autoBpm: false },
  });
try {
  const env = {
    ...process.env,
    TEMP: folder,
    TMP: folder,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_ASR: '0',
    CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(sourceRoot, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await emit({ type: 'startup-intro.skip' });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().endsWith('/index.html'))
      .showInactive(),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click();
  await page.waitForFunction(
    () =>
      document.body.dataset.presence === 'portrait' &&
      Boolean(document.getElementById('sprite').dataset.frame),
  );
  await page.waitForTimeout(600);
  await assertCentered('Startup recovers a saved corner pan without changing zoom');
  await pan();
  await page.waitForTimeout(50);
  const before = await face();
  assert(Math.hypot(before.x - before.cx, before.y - before.cy) > 20);
  await music(true);
  await page.waitForFunction(
    () => document.getElementById('sprite').dataset.frame === 'music-floor',
  );
  const samples = [];
  for (let i = 0; i < 25; i++) {
    samples.push(await face());
    await page.waitForTimeout(16);
  }
  assert(
    samples.some((point) => point.centering),
    'A normal pose change must animate its recovery',
  );
  assert(
    new Set(samples.map((point) => point.y.toFixed(1))).size > 4,
    'Recovery must include intermediate positions',
  );
  await assertCentered('Music pose eases its authored face into the frame center');
  await page
    .locator('#portrait-panel')
    .screenshot({ path: path.join(folder, 'music-centered.png') });
  await pan();
  await music(false);
  await page.locator('#message').fill('fixture');
  await page.locator('#message').fill('');
  await page.waitForFunction(
    () => document.getElementById('sprite').dataset.frame !== 'music-floor',
  );
  await page.waitForTimeout(400);
  await assertCentered('Returning to a standing pose centers its own face landmark');
  await page.locator('#avatar-detach').click();
  await page.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
  await pan();
  await page.locator('#avatar-detach').click();
  await page.waitForFunction(
    () =>
      document.body.dataset.avatarDetach === 'attached' && !document.body.dataset.avatarArriving,
  );
  await page.waitForTimeout(450);
  await assertCentered('Button return measures and commits a centered home arrival');
  await page
    .locator('#portrait-panel')
    .screenshot({ path: path.join(folder, 'home-centered.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pan();
  await music(true);
  await page.waitForFunction(
    () => document.getElementById('sprite').dataset.frame === 'music-floor',
  );
  await assertCentered('Reduced motion centers immediately without a travel animation');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await pan();
  await page.locator('#message').fill('fixture');
  await page.locator('#message').fill('');
  await music(false);
  await page.waitForFunction(() => document.body.dataset.avatarCentering === 'true');
  await pan();
  await page.waitForTimeout(400);
  const interrupted = await face();
  assert.equal(interrupted.centering, false);
  assert(Math.hypot(interrupted.x - interrupted.cx, interrupted.y - interrupted.cy) > 20);
  report.checks.push(
    'Manual placement interrupts recovery and is not overwritten by a stale camera frame',
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, folder }));
