// SPDX-License-Identifier: GPL-3.0-only
// Real renderer + IPC + MicrophoneService. ASR and audio input are isolated synthetic fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'microphone-loading-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `
import { ASRWorker } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/asr-worker.mjs')).href)};
globalThis.microphoneFixture = { starts: 0, pending: [], closes: 0 };
ASRWorker.prototype.send = async function(command) {
  if (command.type !== 'start') return;
  microphoneFixture.starts++;
  this.child = {};
  return new Promise((resolve,reject) => {
    const item = {resolve,reject,worker:this};
    microphoneFixture.pending.push(item);
    this.fixturePending = item;
  });
};
ASRWorker.prototype.close = function() {
  microphoneFixture.closes++;
  this.child = null;
  this.ready = null;
  this.fixturePending?.reject(new Error('Fixture recognition closed'));
  this.fixturePending = null;
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: server.address().port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '1',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification', '--use-fake-device-for-media-stream'],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/index.html',
    );
    view.webContents.setBackgroundThrottling(false);
    view.showInactive();
  });
  await page.waitForFunction(() =>
    ['completed', 'skipped'].includes(document.body.dataset.startupIntro),
  );
  await page.evaluate(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) =>
      new Promise((resolve, reject) => {
        window.releaseMicrophoneFixture = () => getUserMedia(...args).then(resolve, reject);
      });
  });
  const upper = page.locator('#microphone-toggle');
  const lower = page.locator('#input-microphone');
  const resolveStart = () =>
    app.evaluate(() => {
      const item = globalThis.microphoneFixture.pending.shift();
      item.worker.fixturePending = null;
      item.resolve();
    });
  const assertBusy = async (phase) => {
    await page.waitForFunction((status) => document.body.dataset.microphone === status, phase);
    assert.equal(await upper.getAttribute('aria-busy'), 'true');
    assert.equal(await lower.getAttribute('aria-busy'), 'true');
    assert.equal(
      await upper.isDisabled(),
      false,
      'The master switch must still cancel preparation',
    );
    assert.equal(await lower.isDisabled(), true, 'Composer must not start another pending capture');
    assert.equal(await lower.getAttribute('aria-pressed'), 'false');
    assert.match(await upper.getAttribute('aria-label'), /Preparing speech recognition/);
    assert.equal(
      await lower.evaluate((button) => getComputedStyle(button).opacity),
      '1',
      'The loading icon must remain visible on its disabled button',
    );
  };
  await lower.click({ force: true });
  await assertBusy('starting');
  await lower.evaluate((button) => {
    button.click();
    button.click();
  });
  assert.equal(await app.evaluate(() => globalThis.microphoneFixture.starts), 1);
  const animation = await upper.evaluate((button) => ({
    name: getComputedStyle(button, '::after').animationName,
    pointerEvents: getComputedStyle(button, '::after').pointerEvents,
    width: getComputedStyle(button, '::after').width,
  }));
  assert.equal(animation.name, 'microphone-preparing');
  assert.equal(animation.pointerEvents, 'none');
  assert.equal(animation.width, '21px');
  await page.screenshot({ path: path.join(folder, 'microphone-loading.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await upper.evaluate((button) => getComputedStyle(button, '::after').animationName),
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await resolveStart();
  await assertBusy('arming');
  await page.evaluate(() => window.releaseMicrophoneFixture());
  await page.waitForFunction(() => document.body.dataset.microphone === 'listening');
  assert.equal(await upper.getAttribute('aria-busy'), 'false');
  assert.equal(await lower.getAttribute('aria-busy'), 'false');
  assert.equal(await lower.isDisabled(), false);
  // Composer stop keeps the model; the header remains the unload switch.
  await lower.click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'off');
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).microphone.modelLoaded, true);
  await upper.click({ force: true });
  await page.waitForFunction(
    () => document.getElementById('microphone-toggle').getAttribute('aria-pressed') === 'false',
  );
  await upper.click({ force: true });
  await assertBusy('starting');
  await upper.click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'off');
  await page.waitForFunction(
    () => document.getElementById('input-microphone').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await lower.isDisabled(), false);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).microphone.enabled, false);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'model-loading progress',
        'device-arming progress',
        'no duplicate composer start',
        'reduced motion',
        'composer retains model',
        'header cancels and unloads',
      ],
      physicalMicrophone: false,
      realModels: false,
      folder,
    }),
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
