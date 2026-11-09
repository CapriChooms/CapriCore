// SPDX-License-Identifier: GPL-3.0-only
// Real application and Settings perch; synthetic classifier results only.
// No system audio, microphone, model or owner data is opened.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const sourceRoot = path.resolve(process.argv[2] ?? root);
const parent = path.join(sourceRoot, '.runtime/music-bpm-gate');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
const moduleUrl = (file) => JSON.stringify(pathToFileURL(path.join(sourceRoot, file)).href);
writeFileSync(
  entry,
  `
import {MusicListeningService,MusicDecision} from ${moduleUrl('apps/desktop/music-listening-service.mjs')};
const snapshot=MusicListeningService.prototype.snapshot;
globalThis.musicGateDecision=new MusicDecision();
MusicListeningService.prototype.snapshot=function(){
  globalThis.musicGateService=this;
  return {...snapshot.call(this),...globalThis.musicGateStatus};
};
await import(${moduleUrl('apps/desktop/main.mjs')});
`,
);
let modelRequests = 0;
const server = createServer((request, response) => {
  if (request.method !== 'GET') modelRequests++;
  response.setHeader('content-type', 'application/json').end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let app, page;
const report = {
  passed: false,
  ownerDataAccessed: false,
  capturedAudio: false,
  checks: [],
  errors: [],
};
const classify = (tempo = 0, tempoConfidence = 0, music = 0.9) =>
  app.evaluate(
    (_electron, { tempo, tempoConfidence, music }) => {
      const decision = globalThis.musicGateDecision;
      decision.update({ music, speech: 0.01, rms: music ? 0.1 : 0, tempo, tempoConfidence });
      globalThis.musicGateStatus = {
        enabled: true,
        supported: true,
        phase: 'listening',
        hearingMusic: decision.hearingMusic,
        tempo: decision.tempo,
        tempoConfidence: decision.tempoConfidence,
        beatAt: decision.beatAt,
        energy: 0.7,
        settings: { enabled: true, notes: true, motion: true, autoBpm: true },
      };
      globalThis.musicGateService.publish();
    },
    { tempo, tempoConfidence, music },
  );
const assertOrdinary = async (view, selector) => {
  await view.waitForFunction((selector) => {
    const image = document.querySelector(selector);
    return (
      image.complete && image.naturalWidth > 0 && !/\/music-(?:floor|window)\.png$/.test(image.src)
    );
  }, selector);
};
const assertMoving = async (view) => {
  await view.waitForFunction(() =>
    window.musicGateSamples?.some(
      (state) => state.active && Math.abs(state.angle) > 0.01 && state.notes > 0,
    ),
  );
  await view.waitForFunction(() =>
    [...document.querySelectorAll('canvas')].some(
      (canvas) => canvas.style.zIndex === '14' && !canvas.hidden,
    ),
  );
};
const observeMotion = (view) =>
  view.evaluate(async () => {
    const { MusicAnimation } = await import('capri://desktop/music-animation.mjs');
    const sample = MusicAnimation.prototype.sample;
    window.musicGateSamples = [];
    MusicAnimation.prototype.sample = function (...args) {
      const value = sample.apply(this, args);
      window.musicGateSamples.push({
        active: value.active,
        angle: value.angle,
        notes: value.notes.length,
        sinceStatusMs: args[0] - (window.musicGateStatusAt ?? args[0]),
      });
      if (window.musicGateSamples.length > 120) window.musicGateSamples.shift();
      return value;
    };
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
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => {
    if (!report.errors.includes(error.message)) report.errors.push(error.message);
  });
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('/index.html'),
    );
    win.webContents.send('capri:event', { type: 'startup-intro.skip' });
    win.showInactive();
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeMotion(page);
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click();
  await page.waitForTimeout(400);
  await classify();
  await classify();
  await classify();
  await page.waitForTimeout(1200);
  await assertOrdinary(page, '#sprite');
  assert.equal(await page.locator('body').getAttribute('data-music-listening'), 'false');
  report.checks.push(
    'Home portrait retains its ordinary pose while music is detected but BPM is unknown',
  );
  const musicSettings = await settingsView(app, 'music');
  assert((await musicSettings.locator('#music-listening-status').textContent()).endsWith('BPM …'));
  await page.evaluate(() => {
    window.musicGateSamples = [];
    window.musicGateStatusAt = performance.now();
  });
  await classify(120, 0.8);
  await page.waitForFunction(
    () => document.getElementById('sprite').dataset.frame === 'music-floor',
  );
  await assertMoving(page);
  assert(
    (await musicSettings.locator('#music-listening-status').textContent()).endsWith('BPM 120'),
  );
  await musicSettings.screenshot({ path: path.join(folder, 'music-bpm-ready-settings.png') });
  report.homeStart = await page.evaluate(() => {
    const samples = window.musicGateSamples;
    return {
      poseMs: samples.find((s) => s.active)?.sinceStatusMs,
      motionMs: samples.find((s) => s.active && Math.abs(s.angle) > 0.01)?.sinceStatusMs,
      notesMs: samples.find((s) => s.notes > 0)?.sinceStatusMs,
    };
  });
  assert(report.homeStart.motionMs < 400, 'A reliable BPM must start movement without waiting');
  assert(report.homeStart.notesMs < 1000, 'Notes must start on the next beat');
  report.checks.push('First reliable BPM starts the home music pose, sway and notes');
  for (let i = 0; i < 5; i++) await classify();
  await page.waitForTimeout(1100);
  await assertMoving(page);
  assert.equal(await page.locator('#sprite').getAttribute('data-frame'), 'music-floor');
  report.checks.push('Uncertain estimates keep the acquired BPM and animation running');
  for (let i = 0; i < 3; i++) await classify(0, 0, 0);
  await assertOrdinary(page, '#sprite');
  await classify();
  await classify();
  await classify();
  await settingsView(app, 'general');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('/settings.html'),
    );
    const bounds = win.getBounds();
    win.setBounds({ ...bounds, y: Math.max(260, bounds.y) });
    win.showInactive();
  });
  await page.evaluate(() =>
    window.capri.send({ id: crypto.randomUUID(), text: 'Sit on the Settings window' }),
  );
  await page.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
  const overlay = app.windows().find((win) => win.url().endsWith('/avatar-detach.html'));
  await overlay.emulateMedia({ reducedMotion: 'no-preference' });
  await observeMotion(overlay);
  overlay.on('pageerror', (error) => report.errors.push(error.message));
  await overlay.waitForFunction(() =>
    document.querySelector('#parked-avatar img').src.endsWith('/pose-sit-edge.png'),
  );
  await page.waitForTimeout(700);
  await assertOrdinary(overlay, '#parked-avatar img');
  report.checks.push('A Settings perch keeps its normal sitting pose before BPM is acquired');
  await classify(120, 0.8);
  await overlay.waitForFunction(() =>
    document.querySelector('#parked-avatar img').src.endsWith('/music-window.png'),
  );
  await assertMoving(overlay);
  report.checks.push(
    'First BPM updates an already perched avatar to the fully animated music pose',
  );
  assert.equal(modelRequests, 0);
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
