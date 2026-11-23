/** Real display-media capture of one generated owned window; no other source frames. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
import {
  root,
  runtime,
  initialize,
  environment,
  startGateway,
  stopManaged,
} from '../../packages/runtime/src/index.mjs';
import { CompanionRpc } from '../../apps/desktop/gateway-rpc.mjs';
const parent = path.join(root, '.runtime/screen-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const real = process.argv.includes('--real'),
  withVoice = real && process.argv.includes('--voice'),
  key = 'agent:capri:screen-test-' + randomUUID();
const server = real ? null : createServer((req, res) => res.end('{"data":[]}'));
if (server) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = real ? 18802 : server.address().port,
  rt = runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    gatewayPort: port,
    logPrefix: 'screen-dialogue-verification',
  });
initialize(rt);
if (real) {
  const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  config.tools.allow = ['session_status'];
  for (const [id, name] of [
    ['capri-filesystem', 'files'],
    ['capri-applications', 'apps'],
  ])
    config.plugins.entries[id].config = {
      stateDirectory: path.relative(root, path.join(folder, name)),
    };
  const plugin = path.join(root, 'integrations/perception');
  if (!config.plugins.load.paths.includes(plugin)) config.plugins.load.paths.push(plugin);
  config.plugins.entries['capri-perception'] = {
    enabled: true,
    config: {
      sessionKey: key,
      stateDirectory: path.relative(root, path.join(folder, 'perception')),
    },
  };
  writeFileSync(rt.configPath, JSON.stringify(config, null, 2));
}
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_SESSION: key,
};
delete env.ELECTRON_RUN_AS_NODE;
if (withVoice) env.CAPRI_DESKTOP_VERIFICATION_VOICE = '1';
const require = createRequire(import.meta.url);
let application;
const errors = [],
  report = { passed: false, folder, source: 'owned generated test window', cameraEnabled: false };
try {
  if (real) await startGateway(rt);
  application = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(m.text().slice(0, 300));
  });
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  if (withVoice) {
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
        .webContents.setAudioMuted(true),
    );
    await page.evaluate(() => {
      window.__screenVoice = { turnId: null, packets: 0, completed: false, speaking: false };
      window.capri.onEvent((e) => {
        if (e.type === 'turn.started' && e.source === 'screen')
          window.__screenVoice.turnId = e.turnId;
        if (e.turnId === window.__screenVoice.turnId) {
          if (e.type === 'voice.audio') window.__screenVoice.packets++;
          if (e.type === 'voice.generated') window.__screenVoice.completed = true;
        }
      });
      new MutationObserver(() => {
        if (window.__screenVoice.turnId && document.body.dataset.speaking === 'true')
          window.__screenVoice.speaking = true;
      }).observe(document.body, { attributes: true, attributeFilter: ['data-speaking'] });
    });
  }
  if (real) {
    await page.locator('#message').fill('Hello Capri.');
    await page.locator('#message').press('Enter');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
          .length === 1,
      null,
      { timeout: 90000 },
    );
  }
  await application.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({
      width: 440,
      height: 320,
      show: false,
      title: 'CAPRI OWNED SCREEN FIXTURE',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await fixture.loadURL(
      'data:text/html,<title>CAPRI OWNED SCREEN FIXTURE</title><body style="margin:0;background:white"><div style="position:absolute;left:40px;top:65px;width:110px;height:110px;background:red"></div><div style="position:absolute;left:245px;top:65px;width:110px;height:110px;border-radius:50%;background:blue"></div>',
    );
    fixture.showInactive();
    const main = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    main.webContents.setBackgroundThrottling(false);
    main.webContents.send('capri:event', { type: 'open-screen' });
  });
  await page.waitForSelector('#screen-panel:not([hidden])');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#screen-source option')].some((o) =>
      o.textContent.includes('CAPRI OWNED SCREEN FIXTURE'),
    ),
  );
  const id = await page
    .locator('#screen-source option')
    .filter({ hasText: 'CAPRI OWNED SCREEN FIXTURE' })
    .getAttribute('value');
  await page.locator('#screen-source').selectOption(id);
  const armed = await page.evaluate((id) => window.capri.prepareScreen(id), id);
  assert.equal(
    await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'Arming display capture must never authorize the camera',
  );
  await page.evaluate((id) => window.capri.releaseScreen(id), armed.id);
  await page.locator('#screen-capture').click({ force: true });
  await page.waitForSelector('#screen-preview:not([hidden])', { timeout: 15000 });
  const pixels = await page.evaluate(async () => {
    const image = document.getElementById('screen-preview');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0,
      blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] < 60 && data[i + 2] < 60) red++;
      if (data[i] < 60 && data[i + 1] < 80 && data[i + 2] > 150) blue++;
    }
    return { width: canvas.width, height: canvas.height, red, blue };
  });
  assert.ok(pixels.red > 4000 && pixels.blue > 4000);
  report.pixels = pixels;
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).screen.active, false);
  assert.equal(
    await page.evaluate(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        s.getTracks().forEach((t) => t.stop());
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  if (real) {
    await page
      .locator('#screen-question')
      .fill('Describe the two colored shapes in this snapshot.');
    await page.locator('#screen-ask').click({ force: true });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
          .length === 2,
      null,
      { timeout: 90000 },
    );
    report.answer = await page
      .locator('.message[data-role="assistant"] .message-text')
      .last()
      .textContent();
    assert.match(report.answer, /red/i);
    assert.match(report.answer, /square/i);
    assert.match(report.answer, /blue/i);
    assert.match(report.answer, /circle/i);
    if (withVoice) {
      await page.waitForFunction(
        () =>
          window.__screenVoice.completed &&
          window.__screenVoice.packets > 0 &&
          window.__screenVoice.speaking,
        null,
        { timeout: 60000 },
      );
      report.voice = await page.evaluate(() => window.__screenVoice);
      report.physicalOutputMuted = true;
    }
    await page.locator('#message').fill('Which two shapes did you identify in that snapshot?');
    await page.locator('#message').press('Enter');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
          .length === 3,
      null,
      { timeout: 90000 },
    );
    report.recall = await page
      .locator('.message[data-role="assistant"] .message-text')
      .last()
      .textContent();
    assert.match(report.recall, /red square/i);
    assert.match(report.recall, /blue circle/i);
    const rpc = new CompanionRpc({
      url: rt.gatewayUrl,
      token: () => readFileSync(rt.tokenPath, 'utf8').trim(),
    });
    try {
      const history = await rpc.call('chat.history', { sessionKey: key, limit: 20 });
      assert.equal(history.messages.filter((m) => m.role === 'user').length, 3);
      assert.equal(JSON.stringify(history).includes('iVBORw0KGgo'), false);
    } finally {
      rpc.stop();
    }
    report.sharedHistory = true;
  } else {
    await page.locator('#screen-source').selectOption(id);
    assert.equal(
      await page.locator('#screen-preview').getAttribute('src'),
      null,
      'Changing selection discards the old source preview',
    );
    await page.evaluate(() => {
      const original = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function () {
        return original.call(this).then((buffer) => {
          window.__lateBlobPending = true;
          return new Promise((resolve) =>
            setTimeout(() => {
              window.__lateBlobFinished = true;
              resolve(buffer);
            }, 750),
          );
        });
      };
    });
    await page.locator('#screen-capture').click({ force: true });
    await page.waitForFunction(() => window.__lateBlobPending);
    await page.locator('#screen-close').click({ force: true });
    await page.waitForFunction(() => window.__lateBlobFinished);
    assert.equal(
      await page.locator('#screen-preview').getAttribute('src'),
      null,
      'A late image buffer cannot restore a closed preview',
    );
    report.latePreviewCancelled = true;
  }
  assert.equal(await page.locator('#screen-preview').getAttribute('src'), null);
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  const page = application?.windows()[0];
  if (page)
    report.ui = await page
      .evaluate(() => ({
        notice: document.getElementById('notice')?.textContent,
        source: document.getElementById('screen-source')?.value,
        disabled: document.getElementById('screen-capture')?.disabled,
      }))
      .catch(() => null);
  console.error(JSON.stringify(report));
  throw error;
} finally {
  await application?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (real) await stopManaged(rt.logPrefix);
  writeFileSync(
    path.join(
      root,
      real ? 'logs/screen-dialogue-verification.json' : 'logs/screen-capture-verification.json',
    ),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
