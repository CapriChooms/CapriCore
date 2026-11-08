/** Own-app Electron verification: silent fake inputs, real CPU ASR, isolated state. */
import { saveSettings } from './settings-view.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/audio-input-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'electron-')),
  fakeAudio = path.join(folder, 'silence.wav');
const wav = Buffer.alloc(44 + 16000 * 2 * 2);
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
const server = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port,
  rt = runtime({
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
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url),
  checks = [],
  errors = [];
let application, page, selectedId;
const record = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
const report = {
  passed: false,
  timestamp: new Date().toISOString(),
  physicalMicrophone: false,
  realCpuAsr: true,
  checks,
  folder,
};
async function launch() {
  application = await electron.launch({
    executablePath: require('electron'),
    env,
    timeout: 60000,
    args: [
      path.join(root, 'apps/desktop/main.mjs'),
      '--verification',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeAudio}`,
    ],
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.setBackgroundThrottling(false),
  );
}
const snapshot = () => page.evaluate(() => window.capri.bootstrap());
async function denied() {
  return page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'unexpected capture';
    } catch (error) {
      return error.name;
    }
  });
}
try {
  await launch();
  assert.equal((await snapshot()).microphone.enabled, false);
  assert.equal(await denied(), 'NotAllowedError');
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__inputAttempts = [];
    window.__inputStreams = [];
    window.__inputEvents = [];
    window.__rejectInput = null;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__inputAttempts.push(structuredClone(constraints));
      if (window.__rejectInput && constraints.audio?.deviceId?.exact === window.__rejectInput)
        throw new DOMException('Synthetic unavailable device', 'OverconstrainedError');
      const stream = await original(constraints);
      window.__inputStreams.push(stream);
      return stream;
    };
    window.capri.onEvent((event) => {
      if (event.type.startsWith('microphone.')) window.__inputEvents.push(event);
    });
  });
  const inputs = await page.evaluate(() => window.capri.microphoneDevices());
  assert.ok(inputs.devices.length > 0, 'Fake device must have a named audio input');
  selectedId = inputs.devices[0].deviceId;
  assert.equal(await page.evaluate(() => window.__inputAttempts.length), 0);
  assert.equal((await snapshot()).microphone.enabled, false);
  assert.equal(await denied(), 'NotAllowedError');
  record('listing input names does not open a stream or enable capture');

  await application.evaluate(({ Menu }) => {
    const original = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = (template) => {
      const menu = original(template);
      globalThis.__inputMenu = menu;
      return menu;
    };
  });
  await page.evaluate(() => window.capri.menu());
  await application.evaluate(() => {
    const submenu = globalThis.__inputMenu.getMenuItemById('microphone-input').submenu;
    if (submenu.items.length < 2) throw new Error('Native microphone menu is empty');
    if (submenu.items[0].type !== 'radio' || !submenu.items[0].checked)
      throw new Error('Default input is not selected');
    submenu.items[1].click();
    globalThis.__inputMenu.closePopup();
  });
  await page.waitForFunction(
    (id) => window.capri.bootstrap().then((value) => value.microphone.deviceId === id),
    selectedId,
  );
  assert.equal((await snapshot()).microphone.enabled, false);
  assert.equal(
    JSON.parse(readFileSync(path.join(folder, 'desktop/microphone.json'), 'utf8')).deviceId,
    selectedId,
  );
  record('native microphone menu selects and saves a named device while capture stays off');

  await page.evaluate(() => window.capri.menu());
  const [speechSettings] = await Promise.all([
    application.waitForEvent('window'),
    application.evaluate(() => {
      globalThis.__inputMenu.getMenuItemById('speech-settings').click();
      globalThis.__inputMenu.closePopup();
    }),
  ]);
  await speechSettings.waitForURL('capri://desktop/settings.html');
  await speechSettings.locator('#speech-panel').waitFor({ state: 'visible' });
  await speechSettings.locator('#speech-pause').evaluate((input) => {
    input.value = '2.7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await speechSettings.locator('#speech-pause-value').textContent(), '2.7 s');
  await saveSettings(speechSettings);
  await speechSettings.waitForFunction(() =>
    window.capri.bootstrap().then((s) => s.speech.trailingSilenceSeconds === 2.7),
  );
  assert.equal((await snapshot()).microphone.enabled, false);
  assert.equal(
    JSON.parse(readFileSync(path.join(folder, 'desktop/speech.json'), 'utf8')).settings
      .trailingSilenceSeconds,
    2.7,
  );
  await speechSettings.locator('#settings-window-close').click();
  record('native menu opens a working pause slider and saves it without opening the microphone');

  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'listening', null, {
    timeout: 30000,
  });
  const first = (await snapshot()).microphone;
  const captured = await page.evaluate(() => ({
    attempt: window.__inputAttempts.at(-1),
    settings: window.__inputStreams.at(-1).getAudioTracks()[0].getSettings(),
    state: window.__inputStreams.at(-1).getAudioTracks()[0].readyState,
  }));
  assert.deepEqual(captured.attempt.audio.deviceId, { exact: selectedId });
  assert.equal(captured.settings.deviceId, selectedId);
  assert.equal(captured.state, 'live');
  assert.ok(
    (await page.locator('#microphone-toggle').getAttribute('title')).includes(
      inputs.devices[0].deviceLabel,
    ),
  );
  record('capture opens the exact selected input through the real ASR pipeline');
  await page.evaluate(() => window.capri.setSpeechSettings({ trailingSilenceSeconds: 3.2 }));
  assert.equal((await snapshot()).microphone.sessionId, first.sessionId);
  assert.equal((await snapshot()).microphone.trailingSilenceSeconds, 3.2);
  record('pause changes reach the warm ASR worker without restarting capture');

  await page.evaluate(() => window.capri.setMicrophoneDevice(''));
  await page.waitForFunction(
    (id) =>
      window.capri
        .bootstrap()
        .then(
          (value) => value.microphone.status === 'listening' && value.microphone.sessionId !== id,
        ),
    first.sessionId,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      window.__inputAttempts.at(-1)?.audio &&
      !('deviceId' in window.__inputAttempts.at(-1).audio) &&
      window.__inputStreams.at(-1)?.getAudioTracks()[0].readyState === 'live',
    null,
    { timeout: 15000 },
  );
  assert.equal(
    await page.evaluate(() => window.__inputStreams[0].getAudioTracks()[0].readyState),
    'ended',
  );
  assert.ok(!('deviceId' in (await page.evaluate(() => window.__inputAttempts.at(-1).audio))));
  assert.equal((await snapshot()).microphone.deviceId, '');
  record('switching to System default releases the old stream and starts a fresh session');

  const current = (await snapshot()).microphone;
  await assert.rejects(
    page.evaluate(() => window.capri.setMicrophoneDevice('unknown-device')),
    /unavailable/,
  );
  assert.equal((await snapshot()).microphone.sessionId, current.sessionId);
  assert.equal((await snapshot()).microphone.enabled, true);
  record('an invalid selection cannot change the preference or stop active capture');

  const count = await page.evaluate(() => window.__inputAttempts.length);
  await page.evaluate((id) => {
    window.__rejectInput = id;
  }, selectedId);
  await page.evaluate((id) => window.capri.setMicrophoneDevice(id), selectedId);
  await page.waitForFunction(
    () =>
      document.body.dataset.microphone === 'off' &&
      document.querySelector('#notice').textContent.includes('selected microphone is unavailable'),
    null,
    { timeout: 10000 },
  );
  assert.equal(await page.evaluate(() => window.__inputAttempts.length), count + 1);
  assert.equal((await snapshot()).microphone.deviceId, selectedId);
  assert.ok(
    await page.evaluate(() =>
      window.__inputStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    ),
  );
  record('unavailable selected input stops visibly without trying a different microphone');

  await page.evaluate(() => {
    window.__rejectInput = null;
  });
  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'listening', null, {
    timeout: 15000,
  });
  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'off');
  assert.equal(await denied(), 'NotAllowedError');
  assert.deepEqual(errors, []);
  record('the selected input can be restarted and fully released');

  await application.close();
  application = null;
  await launch();
  assert.equal((await snapshot()).speech.trailingSilenceSeconds, 3.2);
  assert.equal((await snapshot()).microphone.deviceId, selectedId);
  assert.equal((await snapshot()).microphone.enabled, false);
  assert.equal(await denied(), 'NotAllowedError');
  assert.deepEqual(errors, []);
  record('relaunch retains the preference while microphone capture starts off');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  if (page)
    console.error(
      await page
        .evaluate(() => ({
          microphone: document.body.dataset.microphone,
          notice: document.querySelector('#notice').textContent,
          events: window.__inputEvents?.slice(-8),
        }))
        .catch(() => ({})),
    );
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  mkdirSync(path.join(root, 'logs'), { recursive: true });
  writeFileSync(
    path.join(root, 'logs/audio-inputs-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify({ passed: report.passed, checks }));
