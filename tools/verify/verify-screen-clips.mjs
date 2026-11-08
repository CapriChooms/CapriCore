/** Screenshot commands against an owned generated window only; no private display pixels. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { MicrophoneService } from '../../apps/desktop/microphone-service.mjs';

const parent = path.join(root, '.runtime/clip-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
let application,
  languageRequests = 0;
const errors = [],
  report = {
    passed: false,
    folder,
    source: 'Owned generated fixture only',
    physicalMicrophone: false,
    physicalAudioMuted: true,
  };
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.end('{"data":[]}');
    return;
  }
  if (req.url === '/api/chat') {
    for await (const _chunk of req) {
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        done: true,
        message: { content: JSON.stringify({ summary: 'A red square and blue circle.' }) },
      }),
    );
    return;
  }
  languageRequests++;
  res.writeHead(500);
  res.end();
});
server.on('upgrade', (_request, socket) => socket.destroy());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port,
  rt = runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    gatewayPort: port,
  });
initialize(rt);
const fakeAudio = path.join(folder, 'silent-microphone.wav'),
  wav = Buffer.alloc(44 + 16000 * 2 * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
writeFileSync(fakeAudio, wav);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_CLIP_FIXTURE: '1',
  CAPRI_DESKTOP_VERIFICATION_OBSERVATION_URL: `http://127.0.0.1:${port}`,
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [
      path.join(root, 'apps/desktop/main.mjs'),
      '--verification',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudio}`,
    ],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  const handle = await application.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({
      x: 80,
      y: 80,
      width: 440,
      height: 320,
      show: false,
      title: 'CAPRI CLIP FIXTURE',
      skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await fixture.loadURL(
      'data:text/html,<title>CAPRI CLIP FIXTURE</title><body style="margin:0;background:white"><div style="position:absolute;left:40px;top:65px;width:110px;height:110px;background:red"></div><div style="position:absolute;left:245px;top:65px;width:110px;height:110px;border-radius:50%;background:blue"></div>',
    );
    fixture.setAlwaysOnTop(true, 'screen-saver');
    fixture.showInactive();
    const main = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    main.webContents.setAudioMuted(true);
    main.webContents.setBackgroundThrottling(false);
    main.showInactive();
    return fixture.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  writeFileSync(path.join(folder, 'clip-owned-window.txt'), handle);
  // Probe only native display geometry; the production monitor path never reads pixels here.
  const probe = JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts/capture-display.ps1'),
        '-Probe',
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 },
    ),
  );
  assert.ok(probe.width > 0 && probe.height > 0);
  report.displayGeometry = probe;
  const waitState = async (predicate, timeout = 20000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const value = await page.evaluate(() => window.capri.bootstrap());
      if (predicate(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Screenshot result did not arrive');
  };
  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'listening', null, {
    timeout: 60000,
  });
  const micBefore = (await page.evaluate(() => window.capri.bootstrap())).microphone.sessionId;
  const started = performance.now();
  await page.locator('#message').fill('Capri clip that');
  await page.locator('#message').press('Enter');
  // Simulate a brief rendering stall while the separate audio worklet keeps
  // capturing. Queued PCM must recover in order after the screenshot work.
  await page.evaluate(() => {
    const until = performance.now() + 1200;
    while (performance.now() < until) {}
  });

  const state = await waitState((value) => Boolean(value.lastScreenshot));
  report.nativeClipMs = Math.round(performance.now() - started);
  assert.equal(
    state.microphone.enabled,
    true,
    'Taking a screenshot must not stop microphone capture',
  );
  assert.equal(state.microphone.sessionId, micBefore);
  assert.doesNotMatch(
    await page.locator('#notice').textContent(),
    /audio could not keep up|recognizer stopped/i,
  );
  report.captureSurvivesRendererStall = true;
  const first = state.lastScreenshot,
    file = path.join(root, first.path);
  assert.ok(statSync(file).size > 33);
  assert.ok(file.startsWith(folder + path.sep));
  const pixels = await application.evaluate(({ nativeImage }, file) => {
    const image = nativeImage.createFromPath(file),
      bytes = image.toBitmap();
    let red = 0,
      blue = 0,
      opaque = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i + 2] > 180 && bytes[i] < 70 && bytes[i + 1] < 70) red++;
      if (bytes[i] > 180 && bytes[i + 2] < 70) blue++;
      if (bytes[i + 3] === 255) opaque++;
    }
    return { ...image.getSize(), red, blue, opaque };
  }, file);
  assert.ok(pixels.red > 5000 && pixels.blue > 5000 && pixels.opaque > 10000);
  report.pixels = pixels;
  assert.equal(state.messages.at(-1).text, 'Clipped it.');
  await page.waitForSelector('#clip-result:not([hidden])');
  const before = readFileSync(file);
  await page.evaluate((value) => window.capri.send(value), {
    id: first.id,
    text: 'Capri clip that',
  });
  assert.deepEqual(readFileSync(file), before);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).messages.length, 2);
  report.replaySafe = true;
  // The real voice-submit bridge receives final ASR text through the same microphone service.
  const worker = new EventEmitter();
  worker.send = async () => {};
  worker.close = () => {};
  let spoken;
  const microphone = new MicrophoneService({
    worker,
    config: { wakeWord: { enabled: true }, autoSend: true, bargeIn: true },
    emit: () => {},
    interrupt: () => {},
    submit: async (value) => {
      spoken = value;
      await page.evaluate((value) => window.capri.send(value), value);
    },
  });
  const capture = await microphone.start();
  microphone.confirm(capture.sessionId);
  worker.emit('transcript', {
    sessionId: capture.sessionId,
    utterance: 0,
    text: 'CAPRI CLIP THAT.',
    final: true,
  });
  await waitState((value) => value.lastScreenshot?.id !== first.id && value.messages.length === 4);
  assert.equal(spoken.text, 'CLIP THAT.');
  microphone.stop();
  report.voiceSubmit = true;
  // Existing observation uses exactly its selected source rather than the native display fallback.
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', { type: 'open-screen' }),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#screen-source option')].some((o) =>
      o.textContent.includes('CAPRI CLIP FIXTURE'),
    ),
  );
  const source = await page
    .locator('#screen-source option')
    .filter({ hasText: 'CAPRI CLIP FIXTURE' })
    .getAttribute('value');
  await page.locator('#screen-source').selectOption(source);
  await page.locator('#screen-watch-start').click({ force: true });
  await page.waitForFunction(() => document.getElementById('screen-live-preview').videoWidth > 0);
  const id = randomUUID(),
    liveStarted = performance.now();
  await page.evaluate((value) => window.capri.send(value), { id, text: 'clip that' });
  const live = await waitState((value) => value.lastScreenshot?.id === id);
  assert.equal(live.lastScreenshot.source.kind, 'window');
  assert.ok(statSync(path.join(root, live.lastScreenshot.path)).size > 33);
  report.selectedSourceClipMs = Math.round(performance.now() - liveStarted);
  await page.evaluate(() => window.capri.stopScreenWatch());
  assert.equal(languageRequests, 0);
  assert.equal(
    readdirSync(path.join(folder, 'screenshots')).filter((name) => name.endsWith('.png')).length,
    3,
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).microphone.enabled, true);
  assert.deepEqual(errors, []);
  report.savedCount = 3;
  report.languageModelRequests = 0;
  report.passed = true;
  await page.screenshot({ path: path.join(folder, 'saved.png') });
} catch (error) {
  report.error = error.stack;
  const page = application?.windows()[0];
  if (page)
    report.ui = await page
      .evaluate(async () => ({
        state: await window.capri.bootstrap(),
        notice: document.getElementById('notice').textContent,
      }))
      .catch(() => null);
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, 'logs/screen-clips-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
