// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

function pdfFixture() {
  const stream = 'BT /F1 20 Tf 60 150 Td (Synthetic PDF attachment) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 220] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let file = '%PDF-1.4\n';
  const offsets = objects.map((value, i) => {
    const at = file.length;
    file += `${i + 1} 0 obj\n${value}\nendobj\n`;
    return at;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(
    file + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

const parent = path.join(root, '.runtime', 'desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'attachments-'));
const entry = path.join(folder, 'main.mjs');
const url = (name) => pathToFileURL(path.join(root, 'apps/desktop', name)).href;
writeFileSync(
  entry,
  `
import assert from 'node:assert/strict';
import { app, desktopCapturer, ipcMain, session, shell } from 'electron';
import { VisualService, snapshotBytes } from ${JSON.stringify(url('visual-service.mjs'))};
import { CompanionRpc } from ${JSON.stringify(url('gateway-rpc.mjs'))};
globalThis.attachmentFixture = [];
globalThis.attachmentFixtureHandlers = new Map();
globalThis.attachmentExternalRequests = [];
globalThis.attachmentShellRequests = [];
globalThis.attachmentCaptureRequests = 0;
desktopCapturer.getSources = async () => {
  globalThis.attachmentCaptureRequests++;
  throw new Error('Desktop capture is disabled in attachment verification.');
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  globalThis.attachmentFixtureHandlers.set(channel, handler);
  return handle(channel, handler);
};
for (const method of ['openPath', 'openExternal']) shell[method] = async (value) => {
  globalThis.attachmentShellRequests.push(value);
  throw new Error('External file opening is disabled in attachment verification.');
};
const fetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(input.url ?? input);
  if (['http:', 'https:'].includes(url.protocol) &&
    !(url.hostname === '127.0.0.1' && url.port === process.env.CAPRI_DESKTOP_VERIFICATION_PORT)) {
    globalThis.attachmentExternalRequests.push(url.origin);
    throw new Error('External network is disabled in attachment verification.');
  }
  return fetch(input, ...args);
};
app.once('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const blocked = ['http:', 'https:'].includes(url.protocol) &&
      !(url.hostname === '127.0.0.1' && url.port === process.env.CAPRI_DESKTOP_VERIFICATION_PORT);
    if (blocked) globalThis.attachmentExternalRequests.push(url.origin);
    callback({ cancel: blocked });
  });
});
CompanionRpc.prototype.call = async function (method) {
  assert.equal(method, 'capri.visual.commit', 'Fixture never reads prior owner history.');
  return {};
};
VisualService.prototype.generate = async function ({ attachments, emit }) {
  for (const attachment of attachments) {
    assert.deepEqual(Object.keys(attachment).sort(), attachment.png ? ['animated', 'png'] : ['text']);
    if (attachment.png) snapshotBytes(attachment.png);
    else assert.equal(typeof attachment.text, 'string');
  }
  globalThis.attachmentFixture.push(attachments.map((value) => value.text ?? Boolean(value.png)));
  emit({ type: 'text', text: 'Attachment read.' });
  return { text: 'Attachment read.' };
};
app.on('browser-window-created', (_, window) => {
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
});
await import(${JSON.stringify(url('main.mjs'))});
`,
);
const unexpectedRequests = [];
const server = createServer((request, response) => {
  if (request.url !== '/v1/models') {
    unexpectedRequests.push(request.url);
    response.writeHead(404).end();
    return;
  }
  response.end('{"data":[]}');
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
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const viewerAddress = 'capri://desktop/attachment-viewer.html';
async function launch() {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () => document.body.dataset.initialized === 'true' && document.body.dataset.phase === 'ready',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  const snapshot = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(snapshot.microphone.status, 'off');
  assert.equal(snapshot.voice.enabled, false);
}

async function historyAttachments() {
  await page.locator('#history-toggle').click({ force: true });
  await page.locator('#history-panel').waitFor({ state: 'visible' });
  const message = page.locator('.message[data-role="user"]').first();
  const cards = message.locator('.message-attachments .message-attachment');
  assert.equal(await cards.count(), 3);
  const labels = await cards.allTextContents();
  for (const name of ['sample.png', 'sample.pdf', 'notes.txt'])
    assert(
      labels.some((label) => label.includes(name)),
      name + ' is shown in Conversation.',
    );
  assert(labels.every((label) => !label.includes(folder) && !label.includes('file://')));
  const thumbnail = message.locator('.message-attachment-image[data-attachment-id]');
  assert.equal(await thumbnail.count(), 1);
  assert.match(
    await thumbnail.locator('img').getAttribute('src'),
    /^capri:\/\/desktop\/attachments\/[a-f0-9-]{36}\/thumb\.png$/i,
  );
  await thumbnail.locator('img').evaluate((image) => image.decode());
  assert.equal(await message.locator('.message-attachment-file').count(), 2);
  await message.locator('.message-attachment-file').first().click();
  assert.equal(app.windows().length, 1, 'Document metadata does not launch a file opener.');
  return thumbnail;
}

async function verifyViewer(thumbnail, close) {
  await thumbnail.scrollIntoViewIfNeeded();
  const previousScroll = await page.locator('#messages').evaluate((messages) => messages.scrollTop);
  const created = app.waitForEvent('window');
  await thumbnail.click();
  const viewer = await created;
  viewer.on('pageerror', (error) => errors.push(error.message));
  await viewer.waitForURL((url) => url.href.startsWith(viewerAddress));
  await viewer.locator('#attachment-preview[data-phase="ready"]').waitFor();
  await viewer.locator('#attachment-preview-image').evaluate((image) => image.decode());
  assert.match(await viewer.locator('#attachment-preview-title').textContent(), /sample\.png/);
  assert.deepEqual(await viewer.evaluate(() => [typeof window.capri, typeof require]), [
    'undefined',
    'undefined',
  ]);
  const native = await app.evaluate(async ({ BrowserWindow, screen }, address) => {
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().startsWith(address),
    );
    const until = Date.now() + 5000;
    while (!window.isFullScreen() && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const { preload, contextIsolation, nodeIntegration, sandbox } =
      window.webContents.getLastWebPreferences();
    const bounds = window.getBounds();
    return {
      fullScreen: window.isFullScreen(),
      bounds,
      display: screen.getDisplayMatching(bounds).bounds,
      preload: Boolean(preload),
      contextIsolation,
      nodeIntegration,
      sandbox,
    };
  }, viewerAddress);
  assert.equal(native.fullScreen, true);
  assert.deepEqual(native.bounds, native.display);
  assert.deepEqual(
    [native.preload, native.contextIsolation, native.nodeIntegration, native.sandbox],
    [false, true, false, true],
  );
  const childRejected = await app.evaluate(
    async ({ BrowserWindow }, { address, id }) => {
      const child = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().startsWith(address),
      );
      const handler = globalThis.attachmentFixtureHandlers.get('capri:attachment-open');
      if (typeof handler !== 'function')
        throw new Error('The image-opening IPC handler is missing.');
      try {
        await handler({ sender: child.webContents, senderFrame: child.webContents.mainFrame }, id);
        return false;
      } catch {
        return true;
      }
    },
    { address: viewerAddress, id: await thumbnail.getAttribute('data-attachment-id') },
  );
  assert.equal(
    childRejected,
    true,
    'The viewer cannot invoke the companion image-opening capability.',
  );
  assert.equal(app.windows().length, 2);
  const image = await viewer.locator('#attachment-preview-image').evaluate((image) => {
    const { x, y, width, height } = image.getBoundingClientRect();
    return {
      x,
      y,
      width,
      height,
      viewport: [innerWidth, innerHeight],
      fit: getComputedStyle(image).objectFit,
      source: image.src,
      decoded: image.naturalWidth > 0 && image.naturalHeight > 0,
    };
  });
  assert.equal(image.decoded, true);
  assert.equal(image.fit, 'contain');
  assert.match(image.source, /\/preview\.png$/);
  assert(image.width > 200 && image.height > 100, 'The viewer enlarges the attachment.');
  assert(
    image.x >= -1 &&
      image.y >= -1 &&
      image.x + image.width <= image.viewport[0] + 1 &&
      image.y + image.height <= image.viewport[1] + 1,
  );
  if (close === 'button')
    await viewer.screenshot({ path: path.join(folder, 'attachment-fullscreen.png') });
  const closed = viewer.waitForEvent('close');
  const closing =
    close === 'escape'
      ? viewer.keyboard.press('Escape')
      : viewer.locator('#attachment-preview-close').click();
  await closing.catch((error) => {
    if (!viewer.isClosed()) throw error;
  });
  await closed;
  assert.equal(app.windows().length, 1);
  assert.equal(await page.locator('#history-panel').isVisible(), true);
  assert.equal(
    await page.locator('#messages').evaluate((messages) => messages.scrollTop),
    previousScroll,
  );
}

try {
  await launch();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    context.fillStyle = '#123a58';
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#f2c94c';
    context.fillRect(64, 70, 220, 220);
    context.fillStyle = '#8cf4e5';
    context.font = '30px sans-serif';
    context.fillText('Synthetic image', 310, 180);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const input = page.locator('#attachment-input');
  const pasted = await page.evaluate(
    ({ image, pdf }) => {
      const message = document.getElementById('message');
      message.focus();
      const plain = new DataTransfer();
      plain.setData('text/plain', 'ordinary pasted text');
      const textEvent = new ClipboardEvent('paste', {
        clipboardData: plain,
        bubbles: true,
        cancelable: true,
      });
      message.dispatchEvent(textEvent);
      const files = new DataTransfer();
      files.items.add(
        new File([Uint8Array.from(atob(image), (char) => char.charCodeAt(0))], 'sample.png', {
          type: 'image/png',
        }),
      );
      files.items.add(new File([new Uint8Array(pdf)], 'sample.pdf', { type: 'application/pdf' }));
      files.items.add(new File(['Synthetic text file'], 'notes.txt', { type: 'text/plain' }));
      const event = new ClipboardEvent('paste', {
        clipboardData: files,
        bubbles: true,
        cancelable: true,
      });
      message.dispatchEvent(event);
      return {
        plainTextPreserved: !textEvent.defaultPrevented,
        filesHandled: event.defaultPrevented,
      };
    },
    { image, pdf: [...pdfFixture()] },
  );
  assert.deepEqual(pasted, { plainTextPreserved: true, filesHandled: true });
  await page.waitForFunction(
    () => document.querySelectorAll('#attachment-list button').length === 3,
    null,
    { timeout: 12000 },
  );
  await page.locator('#send').evaluate((button) => button.click());
  await page.waitForFunction(
    () => document.getElementById('subtitle-text').textContent.includes('Attachment read.'),
    null,
    { timeout: 12000 },
  );
  assert.deepEqual(await app.evaluate(() => globalThis.attachmentFixture), [
    [true, 'Synthetic PDF attachment', 'Synthetic text file'],
  ]);
  const saved = (await page.evaluate(() => window.capri.bootstrap())).messages.find(
    (message) => message.attachments?.length,
  );
  assert.equal(saved.role, 'user');
  assert.deepEqual(
    saved.attachments.map(({ name, kind, preview }) => ({ name, kind, preview })),
    [
      { name: 'sample.png', kind: 'image', preview: true },
      { name: 'sample.pdf', kind: 'document', preview: false },
      { name: 'notes.txt', kind: 'document', preview: false },
    ],
  );
  for (const attachment of saved.attachments) {
    assert.match(attachment.id, /^[a-f0-9-]{36}$/i);
    assert(attachment.bytes > 0);
    assert(
      Object.keys(attachment).every((key) =>
        ['id', 'name', 'kind', 'bytes', 'width', 'height', 'preview'].includes(key),
      ),
    );
  }
  const thumbnail = await historyAttachments();
  await page.screenshot({ path: path.join(folder, 'attachments-history.png') });
  await verifyViewer(thumbnail, 'escape');
  await verifyViewer(thumbnail, 'button');
  assert.equal(
    await page.evaluate(() => window.capri.openAttachmentImage('../../private.png')),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      window.capri.openAttachmentImage('00000000-0000-4000-8000-000000000000'),
    ),
    false,
  );
  const documentId = saved.attachments[1].id;
  assert.equal(
    await page.evaluate((id) => window.capri.openAttachmentImage(id), documentId),
    false,
  );
  const documentPreview = await app.evaluate(
    async ({ net }, id) =>
      (await net.fetch('capri://desktop/attachments/' + id + '/preview.png')).status,
    documentId,
  );
  assert.equal(documentPreview, 404);
  await input.setInputFiles({
    name: 'test.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('sample'),
  });
  await page.waitForFunction(() =>
    document.getElementById('attachment-info').textContent.includes('cannot read this file format'),
  );
  assert.equal(await page.locator('#attachment-list button').count(), 0);
  assert.equal(await page.locator('.message-attachments .message-attachment').count(), 3);
  assert.equal(await page.getByText('test.exe', { exact: true }).count(), 0);
  if (process.argv.includes('--media')) {
    const gif = path.join(folder, 'fixture.gif');
    const video = path.join(folder, 'fixture.mp4');
    for (const [file, codec] of [
      [gif, []],
      [video, ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ])
      execFileSync(
        'ffmpeg',
        [
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=160x90:rate=10',
          '-t',
          '2',
          ...codec,
          file,
        ],
        { windowsHide: true },
      );
    await input.setInputFiles([gif, video]);
    await page
      .waitForFunction(
        () => document.querySelectorAll('#attachment-list button').length === 2,
        null,
        { timeout: 20000 },
      )
      .catch(async (error) => {
        throw new Error(await page.locator('#attachment-info').textContent(), { cause: error });
      });
    await page.locator('#send').evaluate((button) => button.click());
    for (let i = 0; i < 50; i++) {
      if ((await app.evaluate(() => globalThis.attachmentFixture)).length > 1) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual((await app.evaluate(() => globalThis.attachmentFixture))[1], [true, true]);
  }
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(await app.evaluate(() => globalThis.attachmentExternalRequests), []);
  assert.deepEqual(await app.evaluate(() => globalThis.attachmentShellRequests), []);
  assert.equal(await app.evaluate(() => globalThis.attachmentCaptureRequests), 0);
  await app.close();
  app = null;
  await launch();
  const restored = (await page.evaluate(() => window.capri.bootstrap())).messages.find(
    (message) => message.id === saved.id,
  );
  assert.deepEqual(restored.attachments, saved.attachments);
  const transcript = JSON.parse(readFileSync(path.join(folder, 'desktop/transcript.json'), 'utf8'));
  assert.deepEqual(
    transcript.messages.find((message) => message.id === saved.id).attachments,
    saved.attachments,
  );
  const restoredThumbnail = await historyAttachments();
  await verifyViewer(restoredThumbnail, 'escape');
  assert.deepEqual(await app.evaluate(() => globalThis.attachmentFixture), []);
  assert.deepEqual(await app.evaluate(() => globalThis.attachmentExternalRequests), []);
  assert.deepEqual(await app.evaluate(() => globalThis.attachmentShellRequests), []);
  assert.equal(await app.evaluate(() => globalThis.attachmentCaptureRequests), 0);
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS mixed attachment history, thumbnail restore, secure fullscreen viewer, Escape/close and rejected files. ' +
      folder,
  );
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
