// SPDX-License-Identifier: GPL-3.0-only
/** Real Settings and main IPC. --windows-loopback tests an opt-in Windows endpoint. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const windowsLoopback = process.argv.includes('--windows-loopback');
const routed = process.argv.includes('--routed');
if ((windowsLoopback || routed) && process.platform !== 'win32')
  throw new Error('Windows is required.');
const parent = path.join(root, '.runtime', 'call-audio-settings-verification');
mkdirSync(parent, { recursive: true });
using verification = mkdtempDisposableSync(path.join(parent, 'run-'));
const folder = verification.path;
const entry = path.join(folder, 'entry.mjs');
const toneFile = path.join(folder, 'generated-tone.wav');
const run = promisify(execFile);

function testTone() {
  const rate = 48000;
  const length = rate * 0.48;
  const wave = Buffer.alloc(44 + length * 2);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(length * 2, 40);
  for (let index = 0; index < length; index++) {
    const envelope = Math.min(1, index / 1200, (length - index - 1) / 1200);
    wave.writeInt16LE(
      Math.round(1800 * envelope * Math.sin((2 * Math.PI * 1370 * index) / rate)),
      44 + index * 2,
    );
  }
  return wave;
}

writeFileSync(
  entry,
  `
import { app, nativeImage, session } from 'electron';
import { ASRWorker } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/asr-worker.mjs')).href)};
import { MicrophoneService } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/microphone-service.mjs')).href)};
import { WindowsAudioEndpoints } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/windows-audio-endpoints.mjs')).href)};
import { MusicListeningService } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/music-listening-service.mjs')).href)};
const fixture = globalThis.audioFixture = { consents: [], packets: 0, mixedTones: false, named: [], stops: [], musicPackets: 0 };
const windowsLoopback = ${windowsLoopback};
const routed = ${routed};
const startMicrophone = MicrophoneService.prototype.start;
MicrophoneService.prototype.start = function (...args) {
  this.config.autoSend = false;
  return startMicrophone.apply(this, args);
};
if (routed) {
  WindowsAudioEndpoints.prototype.list = async () => [
    { id: 'fixture-music-in', label: 'Music bus', kind: 'input' },
    { id: 'fixture-call-out', label: 'Call bus', kind: 'output' },
  ];
  WindowsAudioEndpoints.prototype.capture = async function (id, { onPacket, signal }) {
    fixture.named.push(id);
    const pcm = Buffer.alloc(6400);
    for (let i = 0; i < 1600; i++) pcm.writeFloatLE(0.17 * Math.sin(2 * Math.PI * 1370 * i / 16000), i * 4);
    const timer = setInterval(() => onPacket(pcm), 100);
    const stop = () => { clearInterval(timer); fixture.stops.push(id); };
    signal.addEventListener('abort', stop, { once: true });
    return { stop };
  };
  MusicListeningService.prototype.initialize = async function (session) {
    session.ready = true;
    session.child = {
      stdin: {
        writable: true,
        writableLength: 0,
        write(value) {
          const bytes = Buffer.from(JSON.parse(value).pcm, 'base64');
          if (bytes.length === 32000 && bin(bytes, 1370) > 0.1) fixture.musicPackets++;
        },
        destroy() {},
      },
      kill() {},
    };
  };
}
function bin(samples, frequency) {
  const rotation = (2 * Math.PI * frequency) / 16000;
  const coefficient = 2 * Math.cos(rotation);
  let previous = 0, older = 0;
  for (let index = 0; index < samples.length; index += 4) {
    const next = samples.readFloatLE(index) + coefficient * previous - older;
    older = previous;
    previous = next;
  }
  return Math.sqrt(Math.max(0, previous ** 2 + older ** 2 - coefficient * previous * older)) / (samples.length / 8);
}
ASRWorker.prototype.send = async function ({ type, sessionId, pcm }) {
  this.child = {};
  if (type === 'start') Object.assign(fixture, { worker: this, sessionId });
  if (type === 'pcm') {
    fixture.packets++;
    if ((windowsLoopback || routed) && fixture.measure && !fixture.mixedTones) {
      // Retain only whether this packet contains both known test tones. No recording or ASR.
      const samples = Buffer.from(pcm, 'base64');
      fixture.mixedTones = bin(samples, 440) > 0.03 && bin(samples, 1370) > 0.0002 &&
        bin(samples, 1370) > 5 * Math.max(bin(samples, 1310), bin(samples, 1430));
    }
  }
};
ASRWorker.prototype.close = function () { this.child = null; };
app.on('browser-window-created', (_, window) => {
  // Exercise both real renderer surfaces without painting them on the user's desktop.
  let shown = false;
  window.isVisible = () => shown;
  window.show = window.showInactive = () => {
    if (!shown) { shown = true; window.emit('show'); }
  };
  window.hide = () => {
    if (shown) { shown = false; window.emit('hide'); }
  };
  window.focus = () => {};
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
  window.webContents.capturePage = async () => nativeImage.createFromBitmap(Buffer.alloc(4), { width: 1, height: 1 });
});
app.whenReady().then(() => {
  const media = session.defaultSession;
  const install = media.setDisplayMediaRequestHandler.bind(media);
  media.setDisplayMediaRequestHandler = (handler, options) => install((request, respond) => {
    handler(request, (streams) => {
      if (streams?.audio !== 'loopback' || streams.video !== request.frame) return respond({});
      fixture.consents.push({ gesture: request.userGesture, video: request.videoRequested });
      // The default smoke uses only the test tab. Windows mode sends the real grant unchanged.
      respond(windowsLoopback ? streams : { video: request.frame, audio: request.frame });
    });
  }, options);
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);

const server = createServer((_request, response) => response.end('{"data":[]}'));
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
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification', '--autoplay-policy=no-user-gesture-required'],
    env,
    timeout: 30000,
  });
  const companion = await application.firstWindow({ timeout: 30000 });
  const errors = [];
  companion.on('pageerror', (error) => errors.push(error.message));
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (view) => view.webContents.getURL() === 'capri://desktop/index.html',
    );
    window.showInactive(); // Only updates the test's logical visibility, no native show.
  });
  await companion.evaluate(() => {
    navigator.mediaDevices.enumerateDevices = async () => [];
    window.testMediaTracks = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const fixture = new AudioContext({ sampleRate: 16000 });
      const audio = fixture.createMediaStreamDestination();
      const tone = fixture.createOscillator();
      tone.connect(audio);
      tone.start();
      await fixture.resume();
      window.testMicrophone = audio.stream.getAudioTracks()[0];
      return audio.stream;
    };
    const display = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await display(options);
      window.testMediaTracks.push(...stream.getTracks());
      return stream;
    };
  });
  if (routed) {
    const audio = await settingsView(application, 'audio');
    await audio.locator('#audio-route-music').selectOption('fixture-music-in');
    const system = audio.locator('#audio-route-system');
    await system.selectOption('fixture-call-out');
    await audio.waitForFunction(() => !document.getElementById('audio-route-system').disabled);
    const saved = JSON.parse(
      readFileSync(path.join(folder, 'desktop', 'audio-routing.json'), 'utf8'),
    ).settings;
    assert.equal(saved.routes.music, 'fixture-music-in');
    assert.equal(saved.routes.system, 'fixture-call-out');
    assert.deepEqual(await application.evaluate(() => globalThis.audioFixture.named), []);
    await audio.evaluate(() => window.capri.setSkill({ id: 'capri.music', enabled: true }));
    await audio.waitForFunction(
      async () => (await window.capri.musicStatus()).phase === 'listening',
    );
    const deadline = Date.now() + 3000;
    while (
      Date.now() < deadline &&
      !(await application.evaluate(() => globalThis.audioFixture.musicPackets))
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(await application.evaluate(() => globalThis.audioFixture.musicPackets));
    await audio.evaluate(() => window.capri.setSkill({ id: 'capri.music', enabled: false }));
    assert.deepEqual(await application.evaluate(() => globalThis.audioFixture.stops), [
      'fixture-music-in',
    ]);
    console.log(
      'PASS Audio tab stores independent endpoints and feeds only the music input to the detector.',
    );
  }
  const settings = await settingsView(application, 'calls');
  settings.on('pageerror', (error) => errors.push(error.message));
  await settings.evaluate(() => window.capri.setSkill({ id: 'capri.voice-calls', enabled: true }));
  const enable = settings.locator('#call-system-enable');
  const stop = settings.locator('#call-system-stop');
  const indicator = companion.locator('#system-audio-indicator');
  assert.equal(await enable.isDisabled(), true);
  assert.equal(await indicator.isHidden(), true);
  assert.deepEqual(await application.evaluate(() => globalThis.audioFixture.consents), []);
  await settings.evaluate(() => window.capri.setSkill({ id: 'capri.microphone', enabled: true }));
  await settings
    .waitForFunction(() => !document.getElementById('call-system-enable').disabled, null, {
      timeout: 5000,
    })
    .catch(async (error) => {
      const details = await companion.evaluate(async () => ({
        microphone: (await window.capri.bootstrap()).microphone.status,
        notice: document.getElementById('notice').innerText,
        mockMicrophone: window.testMicrophone?.readyState,
      }));
      throw new Error(JSON.stringify({ details, errors }), { cause: error });
    });
  assert.equal(await indicator.isHidden(), true);
  if (routed) await application.evaluate(() => (globalThis.audioFixture.measure = true));
  await enable.evaluate((button) => button.click());
  await indicator.waitFor({ state: 'visible', timeout: 12000 }).catch(async (error) => {
    const consent = await application.evaluate(() => globalThis.audioFixture.consents);
    const state = await settings.evaluate(
      () => document.getElementById('call-system-status').innerText,
    );
    throw new Error(JSON.stringify({ consent, state, errors }), { cause: error });
  });
  assert.deepEqual(
    await application.evaluate(() => globalThis.audioFixture.consents),
    routed ? [] : [{ gesture: true, video: true }],
  );
  assert.ok(await application.evaluate(() => globalThis.audioFixture.packets > 0));
  if (routed) {
    const deadline = Date.now() + 3000;
    while (
      Date.now() < deadline &&
      !(await application.evaluate(() => globalThis.audioFixture.mixedTones))
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await application.evaluate(() => globalThis.audioFixture.mixedTones), true);
    assert.deepEqual(await application.evaluate(() => globalThis.audioFixture.named), [
      'fixture-music-in',
      'fixture-call-out',
    ]);
  }
  if (windowsLoopback) {
    writeFileSync(toneFile, testTone());
    await application.evaluate(() => {
      globalThis.audioFixture.measure = true;
    });
    try {
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$player = [System.Media.SoundPlayer]::new($env:CAPRI_TEST_TONE); $player.PlaySync()',
        ],
        {
          env: { ...process.env, CAPRI_TEST_TONE: toneFile },
          windowsHide: true,
          timeout: 5000,
        },
      );
      assert.equal(
        await application.evaluate(() => globalThis.audioFixture.mixedTones),
        true,
        'Both generated tones must reach the same recognition packet via the native loopback',
      );
    } finally {
      await application.evaluate(() => {
        globalThis.audioFixture.measure = false;
      });
    }
  }
  assert.equal(
    (await companion.evaluate(() => window.capri.bootstrap())).microphone.systemAudioReview,
    true,
  );
  assert.equal(
    (await companion.evaluate(() => window.capri.bootstrap())).microphone.wakeState,
    'waiting',
  );
  await application.evaluate(() => {
    const { worker, sessionId } = globalThis.audioFixture;
    worker.emit('transcript', {
      sessionId,
      text: 'Capri',
      utterance: 0,
      final: false,
      wakeOnly: true,
    });
  });
  await companion.waitForFunction(
    async () => (await window.capri.bootstrap()).microphone.wakeState === 'command',
  );
  await application.evaluate(() => {
    const { worker, sessionId } = globalThis.audioFixture;
    worker.emit('transcript', { sessionId, text: 'Capri', utterance: 0, final: true });
    worker.emit('transcript', {
      sessionId,
      text: 'Turn off the microphone',
      utterance: 1,
      final: true,
    });
  });
  await companion.waitForFunction(
    () => document.querySelector('#message').value === 'Turn off the microphone',
  );
  assert.equal(
    (await companion.evaluate(() => window.capri.bootstrap())).microphone.status,
    'listening',
  );
  const states = () =>
    companion.evaluate(() =>
      window.testMediaTracks.map(({ kind, readyState }) => [kind, readyState]).sort(),
    );
  assert.deepEqual(
    await states(),
    routed
      ? []
      : [
          ['audio', 'live'],
          ['video', 'ended'],
        ],
  );
  await stop.evaluate((button) => button.click());
  await indicator.waitFor({ state: 'hidden' });
  assert.deepEqual(
    await states(),
    routed
      ? []
      : [
          ['audio', 'ended'],
          ['video', 'ended'],
        ],
  );
  assert.equal(await companion.evaluate(() => window.testMicrophone.readyState), 'live');
  if (routed)
    assert.deepEqual(await application.evaluate(() => globalThis.audioFixture.stops), [
      'fixture-music-in',
      'fixture-call-out',
    ]);
  assert.deepEqual(errors, []);
  console.log(
    routed
      ? 'PASS named call audio uses only its selected bus, mixes mic/system PCM and releases capture without closing the mic.'
      : windowsLoopback
        ? 'PASS native Windows loopback, simultaneous test-tone input, wake review and release.'
        : 'PASS actual Settings and main IPC activate, identify, and stop generated system audio.',
  );
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
