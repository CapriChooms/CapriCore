// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempDisposableSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium, _electron as electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/index.mjs';
import {
  CAMERA_BACKGROUND_COLOR,
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
} from '../../apps/desktop/call-camera-protocol.mjs';
import { settingsView } from './settings-view.mjs';

if (process.platform !== 'win32') throw new Error('This test requires Windows.');
const previewOnly = process.argv.includes('--preview-only');
const previewSelector = '#call-camera-preview';
const chrome = [
  process.env.CAPRI_CAMERA_TEST_BROWSER,
  path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(
    process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
    'Microsoft/Edge/Application/msedge.exe',
  ),
].find((file) => file && existsSync(file));
if (!previewOnly && !chrome)
  throw new Error('Install Chrome or Edge, or set CAPRI_CAMERA_TEST_BROWSER.');
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
using fixture = mkdtempDisposableSync(path.join(parent, 'call-camera-'));
const require = createRequire(import.meta.url);
const server = createServer((request, response) => {
  if (request.url === '/camera-test') {
    return response
      .writeHead(200, { 'content-type': 'text/html' })
      .end(
        '<meta charset="utf-8"><title>Capri Camera test</title><video autoplay muted playsinline></video>',
      );
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture.path,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_CAMERA: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app, browser;
async function openCameraClient() {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext();
  await context.grantPermissions(['camera'], { origin });
  const client = await context.newPage();
  await client.goto(origin + '/camera-test');
  return client;
}
const cameras = (client) =>
  client.evaluate(async () =>
    (await navigator.mediaDevices.enumerateDevices()).some(
      (device) => device.kind === 'videoinput' && device.label === 'Capri Camera',
    ),
  );
async function launchCapri() {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const companion = await app.firstWindow();
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready');
  return settingsView(app, 'calls');
}
async function expectBackground(viewer, left, right = left, selector = 'video') {
  await viewer.waitForFunction(
    ([first, last, selector]) => {
      const source = document.querySelector(selector);
      if (!source) return false;
      const canvas =
        source instanceof HTMLCanvasElement ? source : document.createElement('canvas');
      if (canvas !== source) {
        canvas.width = source.videoWidth;
        canvas.height = source.videoHeight;
        canvas.getContext('2d').drawImage(source, 0, 0);
      }
      const context = canvas.getContext('2d');
      return [first, last].every((expected, index) => {
        const x = index ? canvas.width - 8 : 8;
        const { data } = context.getImageData(x, 8, 1, 1);
        return expected.every((channel, i) => Math.abs(channel - data[i]) < 14);
      });
    },
    [left, right, selector],
    { timeout: 6000, polling: 100 },
  );
}

async function cameraBackgroundPng(settings) {
  const image = await settings.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = '#30c259';
    context.fillRect(0, 0, 48, 96);
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 96, 12);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') };
}

async function verifyPreview() {
  const settings = await launchCapri();
  await settings.evaluate(() => window.capri.setSkill({ id: 'capri.voice-calls', enabled: true }));
  const preview = settings.locator(previewSelector);
  const toggle = settings.locator('#call-camera-enabled');
  const color = settings.locator('#call-camera-color');
  const file = settings.locator('#call-camera-image-file');
  const remove = settings.locator('#call-camera-image-remove');
  const reset = settings.locator('#call-camera-background-reset');
  assert.equal(await toggle.isChecked(), false);
  await preview.waitFor({ state: 'visible' });
  await preview.scrollIntoViewIfNeeded();
  await settings.waitForFunction(
    ([selector, width, height]) => {
      const canvas = document.querySelector(selector);
      if (canvas.width !== width || canvas.height !== height) return false;
      const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
      let spritePixels = 0;
      for (let i = 0; i < data.length; i += 16)
        if (data[i] > 115 && data[i] > data[i + 1] * 1.8 && data[i] > data[i + 2] * 1.4)
          spritePixels++;
      return spritePixels > 500;
    },
    [previewSelector, CAMERA_WIDTH, CAMERA_HEIGHT],
    { timeout: 12000, polling: 200 },
  );
  const expectPreviewBackground = async (left, right = left) => {
    await settings.locator('#companion[aria-busy="false"]').waitFor({ state: 'attached' });
    await preview.scrollIntoViewIfNeeded();
    await expectBackground(settings, left, right, previewSelector);
  };
  await expectPreviewBackground([11, 21, 29]);
  await color.fill('#267dba');
  await expectPreviewBackground([38, 125, 186]);
  await file.setInputFiles(await cameraBackgroundPng(settings));
  await remove.waitFor({ state: 'visible' });
  await expectPreviewBackground([48, 194, 89], [38, 125, 186]);
  await settings.locator('#call-system-enable').scrollIntoViewIfNeeded();
  await settings.waitForFunction(
    (selector) =>
      document.querySelector(selector).getContext('2d').getImageData(8, 8, 1, 1).data[3] === 0,
    previewSelector,
    { timeout: 6000 },
  );
  await expectPreviewBackground([48, 194, 89], [38, 125, 186]);
  await settingsView(app, 'general');
  await preview.waitFor({ state: 'hidden' });
  await settingsView(app, 'calls');
  await preview.waitFor({ state: 'visible' });
  await expectPreviewBackground([48, 194, 89], [38, 125, 186]);
  await settings.locator('#settings-window-close').click();
  assert.equal(
    await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (view) => view.webContents.getURL() === 'capri://desktop/settings.html',
      );
      for (let i = 0; i < 60 && window?.isVisible(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return !window?.isVisible();
    }),
    true,
  );
  await settingsView(app, 'calls');
  await expectPreviewBackground([48, 194, 89], [38, 125, 186]);
  await remove.click();
  await expectPreviewBackground([38, 125, 186]);
  await reset.click();
  await expectPreviewBackground([11, 21, 29]);
  assert.equal(await color.inputValue(), CAMERA_BACKGROUND_COLOR);
  assert.equal(await toggle.isChecked(), false);
  console.log('PASS The camera-off preview renders the sprite and tracks background changes.');
}

async function verifyNativeCamera() {
  const client = await openCameraClient();
  assert.equal(
    await cameras(client),
    false,
    'Use a Windows session with Capri Camera switched off.',
  );
  await client.evaluate(() => navigator.mediaDevices.addEventListener('devicechange', () => {}));

  const settings = await launchCapri();
  await settings.evaluate(async () =>
    window.capri.setSkill({ id: 'capri.voice-calls', enabled: true }),
  );
  const toggle = settings.locator('#call-camera-enabled');
  assert.equal(await toggle.isChecked(), false);
  await toggle.check();
  await settings.waitForFunction(() => {
    const input = document.getElementById('call-camera-enabled');
    return input.checked && !input.disabled;
  });
  const powershell32 = path.join(
    process.env.SystemRoot ?? 'C:/Windows',
    'SysWOW64/WindowsPowerShell/v1.0/powershell.exe',
  );
  await promisify(execFile)(
    powershell32,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; if ([IntPtr]::Size -ne 4) { throw 'Expected a 32-bit COM client' }; $filter=[Activator]::CreateInstance([Type]::GetTypeFromCLSID([guid]'e8bb7233-74f8-4c77-9872-89d543b75e84')); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($filter)",
    ],
    { windowsHide: true, timeout: 10000 },
  );
  console.log('PASS 32-bit COM clients can activate the camera.');
  let viewer = client;
  let enumerated = await cameras(client);
  for (let attempt = 0; attempt < 10 && !enumerated; attempt++) {
    await wait(250);
    enumerated = await cameras(client);
  }
  if (enumerated) {
    console.log('PASS An open Chromium session refreshed its camera list.');
  } else {
    await browser.close();
    viewer = await openCameraClient();
    console.log('Chromium needed a restart to refresh its camera list.');
  }
  const audioTracks = await viewer.evaluate(async () => {
    const device = (await navigator.mediaDevices.enumerateDevices()).find(
      (entry) => entry.kind === 'videoinput' && entry.label === 'Capri Camera',
    );
    if (!device) throw new Error('Capri Camera was not enumerated by Chromium.');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: device.deviceId } },
      audio: false,
    });
    const video = document.querySelector('video');
    video.srcObject = stream;
    await video.play();
    return stream.getAudioTracks().length;
  });
  assert.equal(audioTracks, 0);
  await viewer.waitForFunction(
    ([width, height]) => {
      const video = document.querySelector('video');
      return video.videoWidth === width && video.videoHeight === height;
    },
    [CAMERA_WIDTH, CAMERA_HEIGHT],
    { timeout: 10000, polling: 100 },
  );
  await viewer.waitForFunction(
    () => {
      const video = document.querySelector('video');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let spritePixels = 0;
      for (let i = 0; i < data.length; i += 16)
        if (data[i] > 115 && data[i] > data[i + 1] * 1.8 && data[i] > data[i + 2] * 1.4)
          spritePixels++;
      return spritePixels > 500;
    },
    null,
    { timeout: 12000, polling: 200 },
  );
  console.log('PASS Chromium selected Capri Camera and received the Capri sprite at 640×360.');

  const color = settings.locator('#call-camera-color');
  const file = settings.locator('#call-camera-image-file');
  const remove = settings.locator('#call-camera-image-remove');
  const reset = settings.locator('#call-camera-background-reset');
  await expectBackground(viewer, [11, 21, 29]);
  await color.fill('#267dba');
  await expectBackground(viewer, [38, 125, 186]);
  const png = await cameraBackgroundPng(settings);
  await file.setInputFiles(png);
  await remove.waitFor({ state: 'visible' });
  await expectBackground(viewer, [48, 194, 89], [38, 125, 186]);
  await file.setInputFiles({ ...png, buffer: Buffer.from('broken png') });
  await settings.waitForFunction(() => !document.getElementById('settings-notice').hidden);
  await expectBackground(viewer, [48, 194, 89], [38, 125, 186]);
  await remove.click();
  await expectBackground(viewer, [38, 125, 186]);
  await reset.click();
  await expectBackground(viewer, [11, 21, 29]);
  assert.equal(await color.inputValue(), CAMERA_BACKGROUND_COLOR);
  console.log(
    'PASS An active video feed updated for color, a cropped transparent PNG, removal and reset.',
  );

  const jpeg = await settings.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d');
    context.fillStyle = '#7744a8';
    context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await file.setInputFiles({
    name: 'camera.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpeg, 'base64'),
  });
  await expectBackground(viewer, [119, 68, 168]);
  await toggle.uncheck();
  await settings.waitForFunction(() => {
    const input = document.getElementById('call-camera-enabled');
    return !input.checked && !input.disabled;
  });
  await viewer.waitForFunction(
    () => {
      const video = document.querySelector('video');
      if (video.srcObject.getVideoTracks()[0].readyState === 'ended') return true;
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 9;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return context
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.every((value, index) => index % 4 === 3 || value <= 5);
    },
    null,
    { timeout: 6000, polling: 150 },
  );
  await browser.close();
  assert.equal(
    await cameras(await openCameraClient()),
    false,
    'Disabling the camera must unregister it.',
  );
  console.log('PASS Disabling Camera removes the virtual device.');
  await app.close();
  const reopened = await launchCapri();
  await reopened.locator('#call-camera-image-remove').waitFor({ state: 'visible' });
  assert.equal(await reopened.locator('#call-camera-enabled').isChecked(), false);
  console.log('PASS The JPEG background survived a full Capri restart with the camera off.');
}

try {
  if (previewOnly) await verifyPreview();
  else await verifyNativeCamera();
} finally {
  await browser?.close();
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
