// SPDX-License-Identifier: GPL-3.0-only
/** Real capture consent and renderer flow using only generated screen content. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime', 'screen-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'all-monitors-'));
const entry = path.join(folder, 'test-main.mjs');
writeFileSync(
  entry,
  `
import { app, desktopCapturer, nativeImage, screen, session } from 'electron';
const width = 960, height = 540;
const displays = [1171001, 1171002].map((id, index) => ({
  id, bounds: { x: index * width, y: 0, width, height }, scaleFactor: 1, rotation: 0,
}));
const fixture = globalThis.monitorFixture = {
  colors: [[255, 0, 0], [0, 0, 255]],
  reads: 0,
  permissions: [],
  ownedSource: null,
  removeSecondDisplay() {
    const removed = displays.pop();
    screen.emit('display-removed', {}, removed);
  },
};
app.whenReady().then(() => {
  screen.getAllDisplays = () => displays;
  desktopCapturer.getSources = async ({ types, thumbnailSize }) => {
    if (!types.includes('screen')) return [];
    const pixels = thumbnailSize.width > 0 && thumbnailSize.height > 0;
    if (pixels) fixture.reads++;
    return displays.map(({ id }, index) => {
      const [r, g, b] = fixture.colors[index];
      return {
        id: 'screen:' + (index + 1) + ':0',
        name: 'Synthetic monitor ' + (index + 1),
        display_id: String(id),
        thumbnail: pixels
          ? nativeImage.createFromBitmap(Buffer.alloc(width * height * 4, Buffer.from([b, g, r, 255])), { width, height })
          : nativeImage.createEmpty(),
      };
    }).reverse();
  };
  const mediaSession = session.defaultSession;
  const install = mediaSession.setDisplayMediaRequestHandler.bind(mediaSession);
  mediaSession.setDisplayMediaRequestHandler = (handler, options) => install((request, respond) => {
    handler(request, (streams) => {
      if (!streams?.video || !fixture.ownedSource) return respond({});
      fixture.permissions.push({ source: streams.video.id, gesture: request.userGesture });
      // The real media stream comes exclusively from an owned generated window.
      respond({ video: fixture.ownedSource });
    });
  }, options);
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);

const analysisRequests = [];
const dialogueRequests = [];
const server = createServer(async (request, response) => {
  if (request.url === '/v1/models') return response.end('{"data":[]}');
  let text = '';
  for await (const chunk of request) text += chunk;
  if (request.url === '/api/chat') {
    analysisRequests.push(JSON.parse(text));
    return response.end(
      JSON.stringify({
        done: true,
        message: { content: '{"summary":"Two generated colored screens."}' },
      }),
    );
  }
  if (request.url === '/v1/chat/completions') {
    dialogueRequests.push(JSON.parse(text));
    response.setHeader('Content-Type', 'text/event-stream');
    return response.end(
      'data: {"choices":[{"delta":{"content":"I can see the two colors."}}]}\n\ndata: [DONE]\n\n',
    );
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_OBSERVATION_URL: `http://127.0.0.1:${port}`,
};
delete env.ELECTRON_RUN_AS_NODE;

async function sampleMosaic(element) {
  let canvas = element;
  if (element instanceof HTMLImageElement) {
    await element.decode();
    canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    canvas.getContext('2d').drawImage(element, 0, 0);
  }
  const context = canvas.getContext('2d');
  return {
    width: canvas.width,
    height: canvas.height,
    colors: [0.25, 0.75].map((fraction) =>
      Array.from(
        context.getImageData(
          Math.floor(canvas.width * fraction),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data,
      ).slice(0, 3),
    ),
  };
}

function assertMosaic(frame, colors) {
  assert.ok(frame.width > 0 && frame.width <= 1280);
  assert.ok(frame.height > 0 && frame.height <= 720);
  assert.deepEqual(frame.colors, colors);
}

let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  const companion = await application.firstWindow();
  const errors = [];
  companion.on('pageerror', (error) => errors.push(error.message));
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(async ({ BrowserWindow, nativeImage }) => {
    const owned = new BrowserWindow({ width: 320, height: 200, show: false });
    await owned.loadURL(
      'data:text/html,<title>Capri Owned Consent Fixture</title><body style="background:yellow">',
    );
    owned.showInactive();
    globalThis.monitorFixture.ownedSource = {
      id: owned.getMediaSourceId(),
      name: 'Capri Owned Consent Fixture',
      display_id: '',
      thumbnail: nativeImage.createEmpty(),
    };
    const main = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/index.html',
    );
    main.showInactive();
    main.webContents.setAudioMuted(true);
    main.webContents.setBackgroundThrottling(false);
  });
  await companion.evaluate(() => {
    const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    window.monitorAuthorizationTracks = [];
    window.capri.onEvent((event) => {
      if (event.type === 'screen.clip-request') window.observedMonitorGrant = event.captureId;
    });
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await capture(options);
      window.monitorAuthorizationTracks.push(...stream.getTracks());
      return stream;
    };
  });

  const settings = await settingsView(application, 'screen');
  settings.on('pageerror', (error) => errors.push(error.message));
  const group = settings
    .locator('#screen-source option')
    .filter({ hasText: /All monitors|Все мониторы/i });
  await group.waitFor({ state: 'attached' });
  assert.equal(await settings.locator('#screen-source').inputValue(), '');
  assert.equal(await settings.locator('#screen-capture').isDisabled(), true);
  assert.equal(await settings.locator('#screen-watch-start').isDisabled(), true);
  assert.equal(await application.evaluate(() => globalThis.monitorFixture.reads), 0);
  const token = await group.getAttribute('value');
  await settings.locator('#screen-source').selectOption(token);

  const armed = await companion.evaluate((id) => window.capri.prepareScreen(id), token);
  assert.equal(armed.allMonitors, true);
  await assert.rejects(companion.evaluate((id) => window.capri.screenMonitorFrames(id), armed.id));
  assert.equal(await application.evaluate(() => globalThis.monitorFixture.reads), 0);
  await companion.evaluate((id) => window.capri.releaseScreen(id), armed.id);

  await settings.locator('#screen-capture').click();
  const preview = settings.locator('#screen-preview:not([hidden])');
  await preview.waitFor({ state: 'attached' });
  const originalColors = [
    [255, 0, 0],
    [0, 0, 255],
  ];
  assertMosaic(await preview.evaluate(sampleMosaic), originalColors);
  assert.equal((await companion.evaluate(() => window.capri.bootstrap())).screen.active, false);

  await settings.locator('#screen-watch-start').click();
  const live = companion.locator('#screen-live-mosaic:not([hidden])');
  await live.waitFor({ state: 'attached' });
  assertMosaic(await live.evaluate(sampleMosaic), originalColors);
  assert.equal(
    await companion.locator('#screen-live-preview').evaluate((video) => video.srcObject),
    null,
  );
  await companion.waitForFunction(
    async () => (await window.capri.bootstrap()).screenObservation.lastAnalysedAt,
  );
  assert.deepEqual(
    await companion.evaluate(() =>
      window.monitorAuthorizationTracks.map((track) => track.readyState),
    ),
    ['ended', 'ended'],
  );
  assert.deepEqual(await application.evaluate(() => globalThis.monitorFixture.permissions), [
    { source: 'screen:1:0', gesture: true },
    { source: 'screen:1:0', gesture: true },
  ]);

  async function checkAnalysis(request, colors) {
    assert.deepEqual(request.tools, []);
    const images = request.messages.at(-1).images;
    assert.equal(images.length, 1);
    const sizeAndColors = await application.evaluate(({ nativeImage }, image) => {
      const png = nativeImage.createFromBuffer(Buffer.from(image, 'base64'));
      const { width, height } = png.getSize();
      const bitmap = png.toBitmap();
      return {
        width,
        height,
        colors: [0.25, 0.75].map((fraction) => {
          const offset = (Math.floor(height / 2) * width + Math.floor(width * fraction)) * 4;
          return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
        }),
      };
    }, images[0]);
    assertMosaic(sizeAndColors, colors);
  }
  assert.match(analysisRequests[0].messages[0].content, /grid of separate monitors/);
  await checkAnalysis(analysisRequests[0], originalColors);

  const freshColors = [
    [0, 255, 0],
    [255, 0, 255],
  ];
  await application.evaluate(
    (_electron, colors) => (globalThis.monitorFixture.colors = colors),
    freshColors,
  );
  await companion.locator('#message').fill('What colors can you see now?');
  await companion.locator('#message').press('Enter');
  await companion.waitForSelector('.message[data-role="assistant"][data-status="complete"]', {
    state: 'attached',
  });
  const foreground = analysisRequests.find((request) => request.options.num_predict === 384);
  assert.ok(foreground, 'An ordinary question should trigger a fresh mosaic');
  await checkAnalysis(foreground, freshColors);
  assert.equal(dialogueRequests.length, 1);
  assert.match(dialogueRequests[0].messages.at(-1).content, /Two generated colored screens/);
  assert.equal(JSON.stringify(dialogueRequests[0]).includes('iVBORw0KGgo'), false);

  await settings.locator('#screen-watch-stop').click();
  await companion.waitForFunction(
    async () => !(await window.capri.bootstrap()).screenObservation.active,
  );
  assert.equal(
    await companion.locator('#screen-live-mosaic').evaluate((canvas) => canvas.width),
    0,
  );
  const reads = await application.evaluate(() => globalThis.monitorFixture.reads);
  const watchedGrant = await companion.evaluate(() => window.observedMonitorGrant);
  assert.ok(watchedGrant);
  await assert.rejects(
    companion.evaluate((id) => window.capri.screenMonitorFrames(id), watchedGrant),
  );
  await companion.waitForTimeout(2300);
  assert.equal(await application.evaluate(() => globalThis.monitorFixture.reads), reads);

  await settings.locator('#screen-watch-start').click();
  await live.waitFor({ state: 'attached' });
  await application.evaluate(() => globalThis.monitorFixture.removeSecondDisplay());
  await companion.waitForFunction(
    async () => !(await window.capri.bootstrap()).screenObservation.active,
  );
  await live.waitFor({ state: 'detached' });
  await settings.locator('#screen-refresh').click();
  await group.waitFor({ state: 'detached' });
  assert.equal(await settings.locator('#screen-capture').isDisabled(), true);

  assert.deepEqual(errors, []);
  console.log(
    'PASS Electron all-monitor opt-in, consent, bounded snapshots, fresh observation mosaics and revocation.',
  );
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
