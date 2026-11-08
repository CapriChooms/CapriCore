// SPDX-License-Identifier: GPL-3.0-only
// Isolated desktop fixture. Never starts models, speech, screen capture or a real API.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'startup-intro-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `
import {ipcMain} from 'electron';
globalThis.introClaims = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, callback) => handle(name, async (...args) => {
  const result = await callback(...args);
  if (name === 'capri:startup-intro') globalThis.introClaims.push({action:args[1],result});
  return result;
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
let modelRequests = 0;
const server = createServer((request, response) => {
  if (request.method !== 'GET') modelRequests++;
  response.setHeader('Content-Type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let application;
async function launch(name, avatarId) {
  const fixture = path.join(folder, name);
  mkdirSync(fixture, { recursive: true });
  const rt = runtime({
    stateDir: path.join(fixture, 'openclaw'),
    workspace: path.join(fixture, 'workspace'),
    gatewayPort: port,
  });
  initialize(rt);
  if (name === 'normal') {
    mkdirSync(path.join(fixture, 'desktop'), { recursive: true });
    writeFileSync(
      path.join(fixture, 'desktop/avatar-layout.json'),
      JSON.stringify({ schemaVersion: 1, x: 0, y: 0, zoom: 3 }),
    );
  }
  if (avatarId) {
    mkdirSync(path.join(fixture, 'desktop'), { recursive: true });
    writeFileSync(
      path.join(fixture, 'desktop/avatar.json'),
      JSON.stringify({ schemaVersion: 1, id: avatarId }),
    );
  }
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  return page;
}
async function show() {
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
}
try {
  const page = await launch('normal');
  const centered = await page.evaluate(() => {
    const sprite = document.getElementById('sprite-region').getBoundingClientRect();
    const frame = document.getElementById('portrait-panel').getBoundingClientRect();
    return {
      x: sprite.x + (sprite.width * 646) / 1254 - (frame.x + frame.width / 2),
      y: sprite.y + (sprite.height * 400) / 1254 - (frame.y + 14 + (frame.height - 44) / 2),
      zoom: document.getElementById('sprite-region').dataset.zoom,
    };
  });
  assert.ok(
    Math.abs(centered.x) < 2 && Math.abs(centered.y) < 2,
    'Startup centers the face after a saved corner pan',
  );
  assert.equal(centered.zoom, '3');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  assert.equal(await page.locator('body').getAttribute('data-startup-intro'), 'pending');
  const first = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(first.startupIntro.frames.length, 7);
  assert.equal(JSON.stringify(first.startupIntro).includes('AI ASSISTANT'), false);
  await page.evaluate(async () => {
    await window.capri.bootstrap();
    await window.capri.bootstrap();
  });
  assert.equal(await page.evaluate(() => window.capri.startupIntro('play')), 'wait');
  await page.evaluate(() => {
    window.introFrames = [];
    window.introTimes = [];
    let last, revision;
    const watch = (now) => {
      const canvas = document.getElementById('startup-intro');
      if (document.body.dataset.startupIntro === 'playing') {
        if (canvas.dataset.frame !== last) window.introFrames.push((last = canvas.dataset.frame));
        if (canvas.avatarTextureRevision !== revision) {
          revision = canvas.avatarTextureRevision;
          window.introTimes.push(now);
        }
      }
      if (!['completed', 'skipped'].includes(document.body.dataset.startupIntro))
        requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.evaluate(() => {
    const source = document.getElementById('startup-intro');
    const preview = document.createElement('canvas');
    preview.width = 960;
    preview.height = 720;
    const ctx = preview.getContext('2d');
    const stream = preview.captureStream(60);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 3000000,
    });
    const parts = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) parts.push(event.data);
    };
    window.introMovie = new Promise((resolve) => {
      recorder.onstop = async () => {
        for (const track of stream.getTracks()) track.stop();
        const bytes = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
        resolve(Array.from(bytes));
      };
    });
    let started = false;
    function draw(now) {
      const phase = document.body.dataset.startupIntro;
      if (phase === 'pending') {
        requestAnimationFrame(draw);
        return;
      }
      if (phase === 'completed') {
        recorder.stop();
        return;
      }
      ctx.fillStyle = '#07131c';
      ctx.fillRect(0, 0, 960, 720);
      ctx.fillStyle = '#8ef5ed';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('CAPRI // COLD START', 40, 48);
      ctx.strokeStyle = '#2e6971';
      ctx.strokeRect(35, 75, 890, 580);
      if (source.width > 1) ctx.drawImage(source, 180, 70, 600, 600);
      ctx.fillStyle = '#c4e5e2';
      ctx.font = '14px sans-serif';
      ctx.fillText('Red lightning. A sharp landing. One familiar face.', 40, 689);
      if (!started) {
        recorder.start();
        started = true;
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  });
  await show();
  await page.waitForFunction(() => document.body.dataset.startupIntro === 'playing');
  await page.waitForFunction(
    () => document.getElementById('startup-intro').dataset.phase === 'greeting',
  );
  await page.screenshot({ path: path.join(folder, 'startup-greeting.png') });
  await page.waitForFunction(() => document.body.dataset.startupIntro === 'completed');
  writeFileSync(
    path.join(folder, 'startup-intro.webm'),
    Buffer.from(await page.evaluate(() => window.introMovie)),
  );
  const timing = await page.evaluate(() => ({
    frames: window.introFrames,
    times: window.introTimes,
    canvas: document.getElementById('startup-intro').width,
  }));
  assert.deepEqual([...new Set(timing.frames)], ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal(timing.canvas, 1, 'Intro allocations are released after the handoff');
  const intervals = timing.times
    .slice(1)
    .map((now, index) => now - timing.times[index])
    .sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  const average = (timing.times.at(-1) - timing.times[0]) / Math.max(1, timing.times.length - 1);
  assert.ok(median < 45, 'The effects must keep rendering between anime pose exposures');
  await page.screenshot({ path: path.join(folder, 'startup-ready.png') });
  assert.equal(
    await application.evaluate(
      () => globalThis.introClaims.filter((value) => value.result === 'play').length,
    ),
    1,
  );
  await application.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows().find(
      (view) => view.webContents.getURL() === 'capri://desktop/index.html',
    );
    view.hide();
    view.showInactive();
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.body.dataset.initialized === 'true' &&
      document.body.dataset.startupIntro === 'skipped',
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).startupIntro, null);
  assert.equal(
    await application.evaluate(
      () => globalThis.introClaims.filter((value) => value.result === 'play').length,
    ),
    1,
  );
  assert.deepEqual(errors, []);
  await application.close();
  application = null;
  const restored = await launch('restored', 'happy');
  await show();
  await restored.waitForFunction(() => {
    const canvas = document.getElementById('startup-intro');
    return document.body.dataset.startupIntro === 'playing' && canvas.avatarIntroTime >= 2860;
  });
  const handoff = await restored.evaluate(() => {
    const intro = document.getElementById('startup-intro');
    const sprite = document.getElementById('sprite');
    const expected = document.createElement('canvas');
    expected.width = expected.height = intro.width;
    const ctx = expected.getContext('2d');
    ctx.drawImage(sprite, 0, 0, intro.width, intro.height);
    return {
      frame: sprite.dataset.frame,
      identical: expected.toDataURL() === intro.toDataURL(),
      src: sprite.src,
    };
  });
  assert.equal(handoff.frame, 'happy');
  assert.equal(
    handoff.identical,
    true,
    'The last intro exposure matches the restored expression pixel for pixel',
  );
  await restored.waitForFunction(() => document.body.dataset.startupIntro === 'completed');
  assert.equal(
    await restored.locator('#sprite').getAttribute('src'),
    handoff.src,
    'Finishing the intro never clears the borrowed avatar image',
  );
  assert.equal((await restored.evaluate(() => window.capri.bootstrap())).avatar.id, 'happy');
  await application.close();
  application = null;
  const reduced = await launch('reduced');
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await show();
  await reduced.waitForFunction(() => document.body.dataset.startupIntro === 'skipped');
  assert.equal(
    await application.evaluate(
      () => globalThis.introClaims.filter((value) => value.result === 'play').length,
    ),
    0,
  );
  await application.close();
  application = null;
  const interrupted = await launch('interrupted');
  await show();
  await interrupted.waitForFunction(() => document.body.dataset.startupIntro === 'playing');
  await interrupted.locator('#message').fill('A draft that must survive the intro.');
  await interrupted.waitForFunction(() => document.body.dataset.startupIntro === 'skipped');
  assert.equal(
    await interrupted.locator('#message').inputValue(),
    'A draft that must survive the intro.',
  );
  assert.equal(modelRequests, 0, 'Intro never sends a request to a model');
  console.log(
    'PASS cold startup, seven phases, hidden wait, once per process, renderer recovery, restored expression, reduced motion and interruption.',
  );
  console.log(
    JSON.stringify({
      medianFrameMs: Math.round(median * 10) / 10,
      averageFrameMs: Math.round(average * 10) / 10,
      renderedFrames: timing.times.length,
      preview: folder,
    }),
  );
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
