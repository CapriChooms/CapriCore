// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, 'avatar-only-'));
const textAttachment = path.join(fixture, 'mini-input-notes.txt');
const unsupportedAttachment = path.join(fixture, 'mini-input-unsupported.exe');
writeFileSync(textAttachment, 'Synthetic mini composer attachment.');
writeFileSync(unsupportedAttachment, 'Unsupported file fixture; never executed.');
mkdirSync(path.join(fixture, 'desktop'));
writeFileSync(
  path.join(fixture, 'desktop/companion.json'),
  JSON.stringify({ schemaVersion: 1, settings: { glitchEnabled: false } }),
);
const entry = path.join(fixture, 'test-main.mjs');
writeFileSync(
  entry,
  `
import { app, dialog, Tray } from 'electron';
import { AvatarDetach } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main/avatar-detach.mjs')).href)};
import { ASRWorker } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/asr-worker.mjs')).href)};
globalThis.avatarComposerFixture = { dialogs: [], starts: 0, pending: [], closes: 0 };
dialog.showOpenDialog = async (parent, options) => {
  avatarComposerFixture.dialogs.push({ parent: parent.webContents.getURL(), properties: options.properties });
  return {
    canceled: false,
    filePaths: avatarComposerFixture.dialogs.length === 1
      ? ${JSON.stringify([textAttachment])}
      : ${JSON.stringify([unsupportedAttachment])},
  };
};
ASRWorker.prototype.send = async function(command) {
  if (command.type !== 'start') return;
  avatarComposerFixture.starts++;
  this.child = {};
  return new Promise((resolve,reject) => {
    const item = {resolve,reject,worker:this};
    avatarComposerFixture.pending.push(item);
    this.fixturePending = item;
  });
};
ASRWorker.prototype.close = function() {
  avatarComposerFixture.closes++;
  this.child = null;
  this.ready = null;
  this.fixturePending?.reject(new Error('Fixture recognition closed'));
  this.fixturePending = null;
};
app.on('browser-window-created', (_, window) => {
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
});
const on = Tray.prototype.on;
Tray.prototype.on = function(event, handler) {
  if(event === 'right-click') { globalThis.testCapriTray = this; Tray.prototype.on = on; }
  return on.call(this, event, handler);
};
const leave = AvatarDetach.prototype.leave;
AvatarDetach.prototype.leave = function(...args) {
  globalThis.testAvatarDetach = this;
  if(!this.testPhaseWatch) {
    this.testPhaseWatch = true;
    globalThis.testAvatarPhases = [];
    const onPhase = this.onPhase;
    this.onPhase = phase => { globalThis.testAvatarPhases.push(phase); onPhase(phase); };
  }
  return leave.apply(this,args);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
const streamStarted = Promise.withResolvers();
const firstChunk = Promise.withResolvers();
const finalChunk = Promise.withResolvers();
const firstReply = 'I am staying here above my head.';
const lastReply = ' Your home interface remains folded.';
const requests = [];
const gateway = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models')
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions')
    return response.writeHead(404).end();
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  streamStarted.resolve();
  await firstChunk.promise;
  response.write(delta('[avatar:happy]\n' + firstReply));
  await finalChunk.promise;
  response.end(delta(lastReply) + 'data: [DONE]\n\n');
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const port = gateway.address().port;
const rt = runtime({
  stateDir: path.join(fixture, 'openclaw'),
  workspace: path.join(fixture, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '1',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
const overlayUrl = 'capri://desktop/avatar-detach.html';
const composerUrl = 'capri://desktop/avatar-composer.html';
const errors = [];
let app;
let page;
const state = () =>
  app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const home = windows.find(
      (window) => window.webContents.getURL() === 'capri://desktop/index.html',
    );
    const overlay = windows.find(
      (window) => window.webContents.getURL() === 'capri://desktop/avatar-detach.html',
    );
    const settings = windows.find(
      (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
    );
    const composer = windows.find(
      (window) => window.webContents.getURL() === 'capri://desktop/avatar-composer.html',
    );
    return {
      homeVisible: home?.isVisible() ?? false,
      homeBounds: home?.getContentBounds(),
      overlayId: overlay?.id ?? null,
      overlayVisible: overlay?.isVisible() ?? false,
      settingsVisible: settings?.isVisible() ?? false,
      composerVisible: composer?.isVisible() ?? false,
      composerBounds: composer?.getContentBounds(),
      overlayBounds: overlay?.getContentBounds(),
      phase: globalThis.testAvatarDetach?.phase,
      dock: globalThis.testAvatarDetach?.session?.dock,
      teleports: (globalThis.testAvatarPhases ?? []).filter((phase) => phase === 'teleporting')
        .length,
      pointerTracking: Boolean(globalThis.testAvatarDetach?.pointerTimer),
      acceptsPointer: globalThis.testAvatarDetach?.acceptsPointer === true,
      pressActive: Boolean(globalThis.testAvatarDetach?.press),
      releaseWatches: globalThis.testPerchInput?.active ?? 0,
    };
  });
async function waitState(predicate, message) {
  for (let i = 0; i < 160; i++) {
    const snapshot = await state();
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(50);
  }
  throw new Error(message + ': ' + JSON.stringify(await state()));
}
async function menu(label) {
  await app.evaluate(async (_electron, label) => {
    const tray = globalThis.testCapriTray;
    const popup = tray.popUpContextMenu;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tray menu timed out')), 5000);
        tray.popUpContextMenu = (menu) => {
          clearTimeout(timer);
          const item = menu.items.find((entry) => entry.label === label);
          if (!item?.enabled) return reject(new Error('Menu item unavailable: ' + label));
          item.click();
          resolve();
        };
        tray.emit('right-click');
      });
    } finally {
      tray.popUpContextMenu = popup;
    }
  }, label);
}
async function collapse() {
  await page.locator('#hide').click({ force: true });
  const snapshot = await waitState(
    (value) => !value.homeVisible && value.overlayVisible && value.phase === 'detached',
    'The minus button should retain only the detached avatar',
  );
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).windowSettings.avatarOnly,
    true,
  );
  return snapshot;
}
async function leave() {
  await page.waitForFunction(() => !document.getElementById('avatar-detach').disabled);
  await page.locator('#avatar-detach').click({ force: true });
  return waitState((value) => value.phase === 'detached', 'Capri did not leave her frame');
}
async function composerPage() {
  await waitState((value) => value.composerVisible, 'The detached input bar should be visible');
  const mini = app.windows().find((window) => window.url() === composerUrl);
  assert.ok(mini, 'The mini composer should have its own renderer');
  mini.on('pageerror', (error) => errors.push(error.message));
  await mini.waitForFunction(() => !document.getElementById('message').disabled);
  return mini;
}
async function compositeScreenshot(overlay) {
  const avatar = await overlay.locator('#parked-avatar img').boundingBox();
  const windows = await state();
  const crop = {
    x: Math.max(0, Math.floor(avatar.x)),
    y: Math.max(0, Math.floor(avatar.y)),
    width: Math.ceil(avatar.width),
    height: Math.ceil(avatar.height),
  };
  crop.width = Math.min(crop.width, windows.overlayBounds.width - crop.x);
  crop.height = Math.min(crop.height, windows.overlayBounds.height - crop.y);
  const captures = await app.evaluate(async ({ BrowserWindow }, crop) => {
    const windows = BrowserWindow.getAllWindows();
    const overlay = windows.find(
      (window) => window.webContents.getURL() === 'capri://desktop/avatar-detach.html',
    );
    const mini = windows.find(
      (window) => window.webContents.getURL() === 'capri://desktop/avatar-composer.html',
    );
    return {
      avatar: (await overlay.capturePage(crop)).toPNG().toString('base64'),
      mini: (await mini.capturePage()).toPNG().toString('base64'),
    };
  }, crop);
  const avatarBounds = {
    ...crop,
    x: windows.overlayBounds.x + crop.x,
    y: windows.overlayBounds.y + crop.y,
  };
  const png = await page.evaluate(
    async ({ captures, avatar, mini }) => {
      const left = Math.min(avatar.x, mini.x) - 24;
      const top = Math.min(avatar.y, mini.y) - 48;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(Math.max(avatar.x + avatar.width, mini.x + mini.width) - left + 24);
      canvas.height = Math.ceil(
        Math.max(avatar.y + avatar.height, mini.y + mini.height) - top + 24,
      );
      const context = canvas.getContext('2d');
      context.fillStyle = '#111b28';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#ffffff09';
      for (let x = 0; x < canvas.width; x += 24) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
      }
      for (let y = 0; y < canvas.height; y += 24) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
      }
      const draw = async (data, bounds) => {
        const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          context.drawImage(image, bounds.x - left, bounds.y - top, bounds.width, bounds.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      await draw(captures.avatar, avatar);
      await draw(captures.mini, mini);
      context.fillStyle = '#a9cbd5';
      context.font = '12px system-ui';
      context.fillText('Detached Capri + live input · synthetic desktop fixture', 16, 23);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { captures, avatar: avatarBounds, mini: windows.composerBounds },
  );
  writeFileSync(path.join(fixture, 'avatar-only-composer-desktop.png'), Buffer.from(png, 'base64'));
}
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [entry, '--verification', '--use-fake-device-for-media-stream'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  await page.waitForFunction(() => Boolean(document.getElementById('sprite').dataset.avatar));
  await page.evaluate(() => {
    if (document.getElementById('presence-toggle').getAttribute('aria-pressed') !== 'true')
      document.getElementById('presence-toggle').click();
  });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  const detached = await leave();
  let overlay = app.windows().find((window) => window.url() === overlayUrl);
  const before = await overlay.locator('#parked-avatar img').boundingBox();
  const collapsed = await collapse();
  assert.equal(collapsed.overlayId, detached.overlayId);
  const after = await overlay.locator('#parked-avatar img').boundingBox();
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(before[key] - after[key]) <= 1);
  await page.evaluate(() => {
    const input = document.getElementById('message');
    input.value = 'Draft from the folded home interface';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // A draft pins the hover-only mini field without moving the owner's cursor.
  const mini = await composerPage();
  await mini.waitForFunction(
    () => document.getElementById('message').value === 'Draft from the folded home interface',
  );
  const draftRevision = await mini.evaluate(
    async () => (await window.capriMini.bootstrap()).draftRevision,
  );
  const newerPrimaryDraft = 'A newer draft from the folded home interface';
  await page.locator('#message').fill(newerPrimaryDraft);
  await mini.waitForFunction(
    (draft) => document.getElementById('message').value === draft,
    newerPrimaryDraft,
  );
  assert.equal(
    await mini.evaluate(async () => (await window.capriMini.bootstrap()).draftRevision),
    draftRevision + 1,
  );
  const acceptedCollision = await mini.evaluate(
    ({ revision }) =>
      window.capriMini.action({
        type: 'edit',
        draft: 'An older mini edit with a colliding revision',
        revision,
      }),
    { revision: draftRevision + 1 },
  );
  assert.equal(
    acceptedCollision,
    false,
    'A colliding mini revision must not replace a newer primary draft',
  );
  assert.equal(await page.locator('#message').inputValue(), newerPrimaryDraft);
  assert.equal(await mini.locator('#message').inputValue(), newerPrimaryDraft);
  const question = 'Where do your answers appear while the interface is folded?';
  await mini.locator('#message').fill(question);
  await page.waitForFunction(
    (draft) => document.getElementById('message').value === draft,
    question,
  );
  await mini.waitForFunction(() => !document.getElementById('attachment-open').disabled);
  await mini.locator('#attachment-open').click();
  await mini.waitForFunction(() => document.querySelectorAll('.attachment-chip').length === 1);
  await page.waitForFunction(
    () => document.querySelectorAll('#attachment-list button').length === 1,
  );
  assert.equal(await mini.locator('.attachment-name').textContent(), path.basename(textAttachment));
  assert.equal(await mini.locator('#composer-status').textContent(), '');
  assert.deepEqual(await app.evaluate(() => globalThis.avatarComposerFixture.dialogs), [
    {
      parent: composerUrl,
      properties: ['openFile', 'multiSelections'],
    },
  ]);
  assert.equal((await state()).homeVisible, false, 'The file picker must retain the folded owner');
  const narrow = await mini.evaluate(async () => ({
    apiKeys: Object.keys(window.capriMini).sort(),
    capri: typeof window.capri,
    require: typeof window.require,
    process: typeof window.process,
    snapshot: await window.capriMini.bootstrap(),
    fileInputs: document.querySelectorAll('input[type="file"]').length,
  }));
  assert.deepEqual(narrow.apiKeys, ['action', 'bootstrap', 'hide', 'onState', 'resize']);
  assert.equal(narrow.capri, 'undefined');
  assert.equal(narrow.require, 'undefined');
  assert.equal(narrow.process, 'undefined');
  assert.equal(narrow.fileInputs, 0);
  assert.deepEqual(Object.keys(narrow.snapshot).sort(), [
    'attachments',
    'busy',
    'canAttach',
    'canSend',
    'draft',
    'draftRevision',
    'error',
    'labels',
    'locale',
    'microphone',
    'status',
    'theme',
    'thinking',
  ]);
  assert.deepEqual(Object.keys(narrow.snapshot.attachments[0]).sort(), ['id', 'name']);
  const serialized = JSON.stringify(narrow.snapshot);
  assert.equal(serialized.includes(JSON.stringify(fixture).slice(1, -1)), false);
  assert.equal(serialized.includes(JSON.stringify(root).slice(1, -1)), false);
  assert.doesNotMatch(
    serialized,
    /"(?:apiKey|token|gateway|filePaths|bytes|settings|config|path)"\s*:/,
  );
  await mini.screenshot({ path: path.join(fixture, 'avatar-only-composer.png') });
  await compositeScreenshot(overlay);
  await mini.locator('#attachment-open').click();
  await mini.waitForFunction(() =>
    document.getElementById('composer-status').textContent.includes('cannot read this file format'),
  );
  assert.equal(
    await mini.locator('.attachment-chip').count(),
    1,
    'Unsupported selection must not duplicate or discard the valid attachment',
  );
  assert.equal(await page.locator('#attachment-list button').count(), 1);
  assert.equal(await app.evaluate(() => globalThis.avatarComposerFixture.dialogs.length), 2);
  await mini.locator('.attachment-chip button').click();
  await mini.waitForFunction(() => document.querySelectorAll('.attachment-chip').length === 0);
  await page.waitForFunction(
    () => document.querySelectorAll('#attachment-list button').length === 0,
  );

  // Recognition and the media device are synthetic; only the owner may capture audio.
  await page.waitForFunction(() =>
    ['completed', 'skipped'].includes(document.body.dataset.startupIntro),
  );
  await page.evaluate(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.avatarMiniAudioStarts = 0;
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.avatarMiniAudioStarts++;
      return new Promise((resolve, reject) => {
        window.releaseAvatarMiniAudio = () => getUserMedia(...args).then(resolve, reject);
      });
    };
  });
  await mini.waitForFunction(() => !document.getElementById('input-microphone').disabled);
  await mini.locator('#input-microphone').click();
  await page.waitForFunction(() => document.body.dataset.microphone === 'starting');
  await mini.waitForFunction(
    () => document.getElementById('input-microphone').getAttribute('aria-busy') === 'true',
  );
  assert.equal(await mini.locator('#input-microphone').isDisabled(), true);
  await mini.locator('#input-microphone').evaluate((button) => {
    button.click();
    button.click();
  });
  assert.equal(await app.evaluate(() => globalThis.avatarComposerFixture.starts), 1);
  await app.evaluate(() => {
    const item = globalThis.avatarComposerFixture.pending.shift();
    item.worker.fixturePending = null;
    item.resolve();
  });
  await page.waitForFunction(() => document.body.dataset.microphone === 'arming');
  assert.equal(await mini.locator('#input-microphone').getAttribute('aria-busy'), 'true');
  await page.evaluate(() => window.releaseAvatarMiniAudio());
  await page.waitForFunction(() => document.body.dataset.microphone === 'listening');
  await mini.waitForFunction(
    () => document.getElementById('input-microphone').getAttribute('aria-pressed') === 'true',
  );
  assert.equal(await page.evaluate(() => window.avatarMiniAudioStarts), 1);
  assert.equal((await state()).homeVisible, false, 'Voice capture must retain the folded owner');
  await mini.locator('#input-microphone').click();
  await page.waitForFunction(() => document.body.dataset.microphone === 'off');
  await mini.waitForFunction(
    () => document.getElementById('input-microphone').getAttribute('aria-pressed') === 'false',
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).microphone.modelLoaded, true);

  await mini.waitForFunction(() => !document.getElementById('send').disabled);
  await mini.locator('#message').press('Enter');
  await Promise.race([
    streamStarted.promise,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The folded conversation did not reach its gateway')),
        12000,
      );
      timer.unref();
    }),
  ]);
  await overlay.waitForFunction(
    () => document.getElementById('avatar-status').textContent === 'THINKING',
  );
  await mini.waitForFunction(
    () =>
      document.getElementById('send').disabled &&
      document.getElementById('send').dataset.busy === 'true',
  );
  const busyDraft = 'Keep this draft while Capri is replying.';
  await mini.locator('#message').fill(busyDraft);
  await mini.locator('#message').press('Enter');
  await mini.locator('#message').press('Enter');
  await mini.locator('#send').evaluate((button) => button.click());
  await page.waitForFunction(
    (draft) => document.getElementById('message').value === draft,
    busyDraft,
  );
  assert.equal(
    requests.length,
    1,
    'Enter and a disabled send button must not submit a second request',
  );
  assert.equal((await state()).homeVisible, false);
  firstChunk.resolve();
  await overlay.waitForFunction(
    (text) => document.getElementById('avatar-reply-text').textContent.startsWith(text),
    firstReply.slice(0, -1),
  );
  assert.equal((await state()).homeVisible, false);
  finalChunk.resolve();
  await overlay.waitForFunction(
    (text) => document.getElementById('avatar-reply-text').textContent.includes(text),
    'home interface remains folded',
  );
  assert.equal((await state()).homeVisible, false);
  assert.equal(requests.length, 1);
  assert.ok(
    JSON.stringify(requests[0]).includes(question),
    'The mini draft should reach the existing gateway',
  );
  await mini.waitForFunction(() => document.getElementById('send').dataset.busy === 'false');
  assert.equal(await mini.locator('#message').inputValue(), busyDraft);
  await mini.locator('#message').fill('');
  await page.waitForFunction(() => document.getElementById('message').value === '');
  await overlay.screenshot({ path: path.join(fixture, 'avatar-only-reply.png') });

  const id = collapsed.overlayId;
  const originalHome = collapsed.homeBounds;
  const oldHomeDrop = {
    x: originalHome.x + originalHome.width / 2,
    y: originalHome.y + originalHome.height / 2,
  };
  const beforeDrop = (await state()).teleports;
  await app.evaluate(
    (_electron, point) => globalThis.testAvatarDetach.onDragDrop(point, { x: 0, y: 0 }),
    oldHomeDrop,
  );
  await waitState(
    (value) => value.teleports > beforeDrop && value.phase === 'detached' && !value.homeVisible,
    'A hidden home rectangle must accept a desktop teleport instead of recalling Capri',
  );

  await app.evaluate(({ screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    screen.getCursorScreenPoint = () => ({
      x: Math.round(area.x + area.width * 0.3),
      y: Math.round(area.y + area.height * 0.5),
    });
  });
  const beforeTeleport = (await state()).teleports;
  const composerBeforeTeleport = (await state()).composerBounds;
  await menu('Teleport Capri');
  await waitState(
    (value) =>
      !value.homeVisible &&
      value.overlayVisible &&
      value.composerVisible &&
      value.phase === 'detached' &&
      value.teleports > beforeTeleport,
    'Teleport should work while the home interface is folded',
  );
  assert.equal((await state()).overlayId, id);
  const composerAfterTeleport = (await state()).composerBounds;
  assert.ok(
    composerAfterTeleport.x !== composerBeforeTeleport.x ||
      composerAfterTeleport.y !== composerBeforeTeleport.y,
    'The native input bar should follow Capri to the teleport destination',
  );
  assert.equal(composerAfterTeleport.width, 344);
  assert.ok(composerAfterTeleport.height >= 60 && composerAfterTeleport.height <= 140);
  const composerInWorkArea = await app.evaluate(({ screen }, bounds) => {
    const area = screen.getDisplayMatching(bounds).workArea;
    return (
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height
    );
  }, composerAfterTeleport);
  assert.equal(composerInWorkArea, true);
  await menu('Show Capri');
  await waitState(
    (value) =>
      value.homeVisible &&
      value.overlayVisible &&
      value.composerVisible &&
      value.phase === 'detached',
    'Tray restore should reveal the home interface without recalling Capri',
  );
  await collapse();
  await menu('Return to frame');
  await waitState(
    (value) =>
      value.homeVisible &&
      value.phase === 'attached' &&
      !value.overlayVisible &&
      !value.composerVisible,
    'Explicit return should reveal the home window and restore Capri',
  );
  await page.waitForFunction(() => !document.body.dataset.avatarArriving);

  if (process.platform === 'win32') {
    await settingsView(app, 'general');
    await app.evaluate(({ BrowserWindow, screen }) => {
      const settings = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
      );
      const area = screen.getDisplayMatching(settings.getBounds()).workArea;
      settings.setBounds({
        x: area.x + Math.round(area.width * 0.15),
        y: area.y + Math.round(area.height * 0.45),
        width: 600,
        height: 420,
      });
    });
    await page.evaluate(() =>
      window.capri.send({ id: crypto.randomUUID(), text: 'Sit on the Settings window' }),
    );
    await waitState((value) => value.phase === 'detached', 'Capri should perch on Settings');
    overlay = app.windows().find((window) => window.url() === overlayUrl);
    await overlay.waitForFunction(() =>
      document.querySelector('#parked-avatar img').src.endsWith('/pose-sit-edge.png'),
    );
    await app.evaluate(() => {
      const avatar = globalThis.testAvatarDetach;
      const originalScreen = avatar.screen;
      const input = (globalThis.testPerchInput = {
        originalScreen,
        originalWatch: avatar.watchRelease,
        originalVerification: avatar.verification,
        active: 0,
        cursor: { x: 0, y: 0 },
      });
      avatar.screen = new Proxy(originalScreen, {
        get(target, key) {
          if (key === 'getCursorScreenPoint') return () => input.cursor;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      // Exercise the real pointer timer and native click-through calls without
      // installing a global input hook or moving the owner's physical cursor.
      avatar.watchRelease = () => {
        input.active++;
        return () => input.active--;
      };
      avatar.verification = false;
      avatar.startPointer();
    });
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        await app.evaluate(({ BrowserWindow }) => {
          const settings = BrowserWindow.getAllWindows().find(
            (view) => view.webContents.getURL() === 'capri://desktop/settings.html',
          );
          settings.setMinimizable(true);
          settings.minimize();
        });
        await waitState(
          (value) => !value.overlayVisible && !value.pointerTracking,
          'Minimizing the perched window must stop invisible mouse capture',
        );
        assert.equal((await state()).releaseWatches, 0);
        await app.evaluate(({ BrowserWindow }) => {
          const avatar = globalThis.testAvatarDetach;
          const rect = avatar.spriteRect();
          const offsets = [0.4, 0.5, 0.3, 0.6];
          const point = offsets
            .flatMap((x) =>
              offsets.map((y) => ({ x: rect.x + rect.width * x, y: rect.y + rect.height * y })),
            )
            .find((point) => avatar.canGrab(point) && !avatar.replyHit(point));
          if (!point) throw new Error('The isolated seated pose needs a valid drag point.');
          globalThis.testPerchInput.cursor = {
            x: avatar.session.area.x + point.x,
            y: avatar.session.area.y + point.y,
          };
          // Reproduce the ordering missed by the old test: Windows has already
          // shown the same HWND before the target's restore event is processed.
          avatar.overlay.showInactive();
          const settings = BrowserWindow.getAllWindows().find(
            (view) => view.webContents.getURL() === 'capri://desktop/settings.html',
          );
          settings.restore();
          settings.showInactive();
        });
        await waitState(
          (value) =>
            value.overlayVisible &&
            value.pointerTracking &&
            value.acceptsPointer &&
            value.releaseWatches === 1,
          'Restoring an already shown avatar must rearm hover and release tracking',
        );
        assert.equal((await state()).pressActive, false);
        const beforeDrag = (await state()).teleports;
        await app.evaluate(({ BrowserWindow }) => {
          const avatar = globalThis.testAvatarDetach;
          const { area } = avatar.session;
          const pointer = globalThis.testPerchInput.cursor;
          const settings = BrowserWindow.getAllWindows().find(
            (view) => view.webContents.getURL() === 'capri://desktop/settings.html',
          );
          const bounds = settings.getBounds();
          const destination = {
            x: bounds.x + Math.round(bounds.width / 2),
            y: bounds.y + Math.round(bounds.height / 2),
          };
          avatar.overlay.webContents.emit(
            'before-mouse-event',
            {},
            {
              type: 'mouseDown',
              button: 'left',
              x: pointer.x - area.x,
              y: pointer.y - area.y,
            },
          );
          if (!avatar.press)
            throw new Error('The restored avatar did not accept the left-button press.');
          globalThis.testPerchInput.cursor = destination;
          avatar.overlay.webContents.emit(
            'before-mouse-event',
            {},
            {
              type: 'mouseUp',
              button: 'left',
              x: destination.x - area.x,
              y: destination.y - area.y,
              globalX: destination.x,
              globalY: destination.y,
            },
          );
        });
        await waitState(
          (value) => value.phase === 'detached' && value.teleports === beforeDrag + 1,
          'The restored avatar must complete exactly one drag teleport',
        );
        const beforeReseat = (await state()).teleports;
        await page.evaluate(() =>
          window.capri.send({ id: crypto.randomUUID(), text: 'Sit on the Settings window' }),
        );
        await waitState(
          (value) =>
            value.phase === 'detached' && value.dock === 'seat' && value.teleports > beforeReseat,
          'Re-seat Capri for the next cycle',
        );
        await overlay.waitForFunction(() =>
          document.querySelector('#parked-avatar img').src.endsWith('/pose-sit-edge.png'),
        );
      }
    } finally {
      await app.evaluate(() => {
        const avatar = globalThis.testAvatarDetach;
        const input = globalThis.testPerchInput;
        avatar.stopPointer();
        if (input.active !== 0) throw new Error('The isolated release watcher leaked.');
        avatar.screen = input.originalScreen;
        avatar.watchRelease = input.originalWatch;
        avatar.verification = input.originalVerification;
        delete globalThis.testPerchInput;
      });
    }
    await collapse();
    await page.waitForTimeout(700);
    const alone = await state();
    assert.equal(
      alone.overlayVisible,
      true,
      'Hiding Settings with the home interface must leave Capri visible',
    );
    assert.equal(alone.settingsVisible, false);
    await menu('Return to frame');
    await waitState(
      (value) => value.homeVisible && value.phase === 'attached',
      'The perched avatar should still return from avatar-only mode',
    );
    await page.waitForFunction(() => !document.body.dataset.avatarArriving);
  }
  await leave();
  await collapse();
  await menu('Hide to tray');
  await waitState(
    (value) =>
      !value.homeVisible &&
      !value.overlayVisible &&
      !value.composerVisible &&
      value.phase === 'attached',
    'Explicit Hide to tray must remove the avatar even when its interface is already hidden',
  );
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).windowSettings.avatarOnly,
    false,
  );
  await menu('Show Capri');
  await waitState(
    (value) => value.homeVisible && value.phase === 'attached',
    'Show should restore a fully hidden companion',
  );
  await leave();
  await collapse();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/avatar-detach.html')
      .destroy(),
  );
  await waitState(
    (value) =>
      !value.homeVisible &&
      !value.overlayVisible &&
      !value.composerVisible &&
      value.phase === 'attached',
    'Losing the detached surface must clear avatar-only mode without revealing the home interface',
  );
  await page.waitForTimeout(700);
  assert.equal((await state()).homeVisible, false);
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).windowSettings.avatarOnly,
    false,
  );
  await menu('Show Capri');
  await waitState(
    (value) => value.homeVisible && value.phase === 'attached',
    'The tray should restore the companion after surface loss',
  );
  await page.locator('#hide').click({ force: true });
  await waitState(
    (value) => !value.homeVisible && !value.overlayVisible && !value.composerVisible,
    'Minus while attached should retain the normal hide-to-tray behavior',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS avatar-only collapse, native mini draft and equal-revision collision guard, attachments and unsupported selection, narrow preload, synthetic microphone loading and warm stop, mini Enter streamed replies, busy guard, hidden-home drag, composer teleport, tray restore, explicit return, Settings perch, three minimize/restore/drag-teleport cycles, full hide, surface loss and normal attached hide.',
  );
  console.log('Avatar-only screenshot: ' + path.join(fixture, 'avatar-only-reply.png'));
  console.log('Mini composer screenshot: ' + path.join(fixture, 'avatar-only-composer.png'));
  console.log(
    'Synthetic desktop composite: ' + path.join(fixture, 'avatar-only-composer-desktop.png'),
  );
} finally {
  firstChunk.resolve();
  finalChunk.resolve();
  try {
    if (app) await app.close();
  } finally {
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
  }
}
