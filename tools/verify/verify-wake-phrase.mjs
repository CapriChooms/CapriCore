/** Real CPU ASR with generated/public fake input; never accesses a physical mic. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempDisposableSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { saveSettings, settingsView } from './settings-view.mjs';
import {
  startCompanionVoice,
  companionVoiceHeaders,
  companionVoiceUrl,
} from '../../integrations/voice_runtime/host.mjs';

const parent = path.join(root, '.runtime/wake-verification');
mkdirSync(parent, { recursive: true });
if (process.argv.includes('--preview-only')) {
  await verifyWakePreview();
  process.exit(0);
}
const folder = mkdtempSync(path.join(parent, 'run-')),
  reference = path.join(root, '.runtime/asr-verification/english-reference.wav');
const address = process.argv.includes('--hey') ? 'Hey, Capri.' : 'Capri.';
const restoreFromTray = !process.argv.includes('--keep-in-tray');
const focusMode = process.argv.includes('--focus-mode');
const expectAutoRestore = restoreFromTray && !focusMode;
if (!existsSync(reference)) throw new Error('Prepare the public ASR verification fixture first.');
await startCompanionVoice();
const response = await fetch(companionVoiceUrl() + '/synthesize', {
  method: 'POST',
  headers: { ...companionVoiceHeaders(), 'content-type': 'application/json' },
  body: JSON.stringify({ text: address, requestId: 'wake-prefix-fixture' }),
  signal: AbortSignal.timeout(90000),
});
if (!response.ok) throw new Error('Could not generate the synthetic wake fixture');
writeFileSync(path.join(folder, 'synthetic-prefix.f32'), Buffer.from(await response.arrayBuffer()));
const fakeAudio = path.join(folder, 'fake-input.wav');
const fixture = JSON.parse(
  execFileSync(
    path.join(root, '.runtime/asr-venv/Scripts/python.exe'),
    [
      '-c',
      `
import json,sys,wave,numpy as np
with wave.open(sys.argv[1],'rb') as source:
    assert source.getnchannels()==1 and source.getsampwidth()==2
    rate=source.getframerate(); pcm=np.frombuffer(source.readframes(source.getnframes()),dtype='<i2').astype(np.float32)/32768
    speech=np.interp(np.arange(int(len(pcm)*16000/rate))*rate/16000,np.arange(len(pcm)),pcm)
prefix=np.fromfile(sys.argv[2],dtype='<f4'); prefix=np.interp(np.arange(int(len(prefix)*16000/24000))*24000/16000,np.arange(len(prefix)),prefix)
combined=np.concatenate([np.zeros(32000),speech,np.zeros(35200),prefix,np.zeros(4000),speech,np.zeros(64000)])
with wave.open(sys.argv[3],'wb') as target:
    target.setnchannels(1);target.setsampwidth(2);target.setframerate(16000);target.writeframes((np.clip(combined,-1,1)*32767).astype('<i2').tobytes())
print(json.dumps(dict(prefixEndSeconds=2+len(speech)/16000+2.2+len(prefix)/16000,totalSeconds=len(combined)/16000)))
`,
      reference,
      path.join(folder, 'synthetic-prefix.f32'),
      fakeAudio,
    ],
    { windowsHide: true, encoding: 'utf8' },
  ),
);
const seen = [],
  server = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.end('{"data":[]}');
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    seen.push(request.messages.at(-1).content);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: '[avatar:neutral] I heard your question.' } }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
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
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url),
  report = {
    passed: false,
    folder,
    physicalMicrophone: false,
    realCpuAsr: true,
    qwenUsed: false,
    fixture,
  };
let application;
const errors = [];
try {
  application = await electron.launch({
    executablePath: require('electron'),
    env,
    timeout: 60000,
    args: [
      path.join(root, 'apps/desktop/main.mjs'),
      '--verification',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' + fakeAudio,
    ],
  });
  const page = await application.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    win.webContents.setAudioMuted(true);
    win.showInactive();
  });
  const visible = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
        .isVisible(),
    );
  const settings = await settingsView(application, 'microphone');
  const restore = settings.locator('#wake-restore-from-tray');
  assert.equal(await restore.isChecked(), true);
  if (!restoreFromTray) {
    await restore.uncheck();
    await saveSettings(settings);
    await page.waitForFunction(
      async () => (await window.capri.bootstrap()).companion.restoreFromTrayOnWake === false,
    );
  }
  await settings.locator('#settings-window-close').click();
  await page.evaluate(() => {
    window.__wake = { started: null, awake: null, settings: [], commands: [], wakeCount: 0 };
    window.capri.onEvent((e) => {
      if (e.type === 'microphone.settings') {
        window.__wake.settings.push(e.wakeState);
        if (e.status === 'listening') window.__wake.started ??= performance.now();
      }
      if (e.type === 'microphone.wake') {
        window.__wake.awake = performance.now();
        window.__wake.wakeCount++;
      }
      if (e.type === 'microphone.partial' && e.text) window.__wake.commands.push(e.text);
    });
  });
  if (
    (await page.locator('#presence-toggle').getAttribute('aria-pressed')) === 'true' ||
    (await page.locator('body').getAttribute('data-presence')) === 'portrait'
  )
    await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).microphone.status === 'listening',
    null,
    { timeout: 60000 },
  );
  if (focusMode) {
    const general = await settingsView(application, 'general');
    await general.locator('[data-window-action="focus-mode"]').click();
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isVisible()),
      ),
      false,
    );
  } else await page.evaluate(() => window.capri.hide());
  assert.equal(await visible(), false);
  await page.waitForTimeout(Math.max(1000, (fixture.prefixEndSeconds - 2) * 1000));
  assert.equal(await visible(), false);
  assert.equal(seen.length, 0);
  assert.equal(await page.locator('body').getAttribute('data-presence'), 'core');
  await page.waitForFunction(() => window.__wake.awake !== null, null, { timeout: 15000 });
  assert.equal(await visible(), expectAutoRestore);
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait', null, {
    timeout: 1000,
  });
  await page.waitForSelector('#wake-feedback:not([hidden])');
  assert.equal(await page.locator('#wake-feedback').getAttribute('data-sound'), 'scheduled');
  assert.equal(await page.locator('body').getAttribute('data-command-listening'), 'true');
  assert.match(await page.locator('#wake-feedback').textContent(), /I'M LISTENING/);
  if (expectAutoRestore)
    await page.screenshot({ path: path.join(folder, 'wake-feedback.png'), omitBackground: true });
  const cue = await page.evaluate(async () => {
    const { playWakeChime } = await import('./wake-feedback.mjs');
    const context = new OfflineAudioContext(1, 12000, 24000);
    if (!playWakeChime(context)) throw new Error('Wake chime scheduling failed');
    const pcm = (await context.startRendering()).getChannelData(0);
    return {
      finite: pcm.every(Number.isFinite),
      peak: pcm.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0),
      lateEnergy: pcm.subarray(7200).reduce((sum, x) => sum + x * x, 0),
    };
  });
  assert.equal(cue.finite, true);
  assert.ok(cue.peak > 0.01 && cue.peak < 0.18);
  assert.equal(cue.lateEnergy, 0);
  await page.waitForFunction(
    () => window.__wake.commands.some((text) => /nightfall|yellow lamps/i.test(text)),
    null,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).microphone.wakeState === 'waiting',
    null,
    { timeout: 20000 },
  );
  const start = Date.now();
  while (!seen.length && Date.now() - start < 10000)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0], /(?:hey.?\s*)?(?:capri|cappy|capree)/i);
  assert.match(seen[0], /nightfall|yellow lamps/i);
  const state = await page.evaluate(() => window.__wake);
  report.afterPrefixEndMs = Math.round(
    state.awake - state.started - fixture.prefixEndSeconds * 1000,
  );
  report.wakeCount = state.wakeCount;
  report.prompt = seen[0];
  report.expandedFromCore = true;
  report.restoredFromTray = expectAutoRestore;
  report.focusMode = focusMode;
  report.address = address;
  report.feedback = { visible: true, chime: cue, physicalAudioMuted: true };
  assert.ok(report.afterPrefixEndMs < 1600);
  assert.equal(state.wakeCount, 1);
  assert.deepEqual(errors, []);
  if (focusMode) {
    assert.equal(await visible(), false);
    await application.evaluate(({ app }) => app.emit('second-instance'));
    assert.equal(await visible(), true);
    assert.equal(
      await page.evaluate(
        async () => (await window.capri.bootstrap()).companion.restoreFromTrayOnWake,
      ),
      restoreFromTray,
    );
  }
  await page.locator('#microphone-toggle').click({ force: true });
  report.passed = true;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, 'logs/wake-phrase-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));

async function verifyWakePreview() {
  using fixture = mkdtempDisposableSync(path.join(parent, 'preview-'));
  const sampleRate = 24000;
  const length = sampleRate * 3;
  const wav = Buffer.alloc(44 + length * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++)
    wav.writeInt16LE(Math.round(4000 * Math.sin((i * 2 * Math.PI * 440) / sampleRate)), 44 + i * 2);
  const sample = path.join(fixture.path, 'preview.wav');
  writeFileSync(sample, wav);
  const server = createServer((_request, res) => res.end('{"data":[]}'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    const gatewayPort = server.address().port;
    const rt = runtime({
      stateDir: path.join(fixture.path, 'openclaw'),
      workspace: path.join(fixture.path, 'workspace'),
      gatewayPort,
    });
    initialize(rt);
    const env = {
      ...environment(rt),
      CAPRI_DESKTOP_VERIFICATION_DIR: fixture.path,
      CAPRI_DESKTOP_VERIFICATION_PORT: String(gatewayPort),
      CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
      env,
      timeout: 60000,
    });
    const owner = await app.firstWindow();
    await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
    const settings = await settingsView(app, 'microphone');
    await settings.waitForSelector('#companion[aria-busy="false"]');
    await app.evaluate(({ BrowserWindow, dialog }, sample) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sample] });
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
    }, sample);
    await settings.evaluate(() => {
      const outputs = new WeakMap();
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        outputs.set(this, destination);
        return connect.call(this, destination, ...args);
      };
      window.wakePreviewAudio = [];
      window.wakePreviewContexts = [];
      window.wakePreviewClicks = [];
      window.AudioContext = new Proxy(AudioContext, {
        construct(target, args) {
          const context = Reflect.construct(target, args);
          window.wakePreviewContexts.push(context);
          return context;
        },
      });
      document.getElementById('wake-play').addEventListener('click', (event) => {
        window.wakePreviewClicks.push({
          trusted: event.isTrusted,
          active: navigator.userActivation.isActive,
        });
      });
      const record = (type, node, gain) => {
        window.wakePreviewAudio.push({
          type,
          volume: gain?.gain.value,
          duration: node.buffer?.duration,
          node,
          stopped: false,
        });
      };
      const startOscillator = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (...args) {
        record('tone', this, outputs.get(outputs.get(this)));
        return startOscillator.apply(this, args);
      };
      const startBuffer = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        record('file', this, outputs.get(this));
        return startBuffer.apply(this, args);
      };
      const stopBuffer = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (...args) {
        const playback = window.wakePreviewAudio.find(({ node }) => node === this);
        if (playback) playback.stopped = true;
        return stopBuffer.apply(this, args);
      };
    });
    const savedWakeSettings = () =>
      owner.evaluate(async () => {
        const { wakeSound, wakeVolume } = (await window.capri.bootstrap()).companion;
        return { wakeSound, wakeVolume };
      });
    const original = await savedWakeSettings();
    const sound = settings.locator('#wake-sound');
    const volume = settings.locator('#wake-volume');
    const play = settings.locator('#wake-play');
    const expectPlayback = async (count) => {
      try {
        await settings.waitForFunction((count) => window.wakePreviewAudio.length === count, count, {
          timeout: 7000,
        });
      } catch (error) {
        const details = await settings.evaluate(() => {
          const button = document.getElementById('wake-play');
          return {
            button: button.textContent,
            disabled: button.disabled,
            notice: document.getElementById('settings-notice').textContent,
            mode: document.getElementById('wake-sound').value,
            clicks: window.wakePreviewClicks,
            contexts: window.wakePreviewContexts.map(({ state }) => state),
            audio: window.wakePreviewAudio.map(({ type }) => type),
          };
        });
        throw new Error(`Wake preview expected ${count} audio nodes. ${JSON.stringify(details)}`, {
          cause: error,
        });
      }
    };
    await sound.selectOption('off');
    assert.equal(await play.isDisabled(), true);
    await sound.selectOption('file');
    assert.equal(await play.isDisabled(), true);
    await sound.selectOption('tone');
    await volume.fill('0.25');
    await play.click();
    await expectPlayback(2);
    const rendered = () =>
      settings.evaluate(() =>
        window.wakePreviewAudio.map(({ type, volume, duration }) => ({ type, volume, duration })),
      );
    const tones = await rendered();
    assert.ok(
      tones.every(({ type, volume }) => type === 'tone' && Math.abs(volume - 0.02125) < 1e-6),
    );
    await sound.selectOption('file');
    await settings.locator('#wake-import').click();
    await volume.fill('0.4');
    await play.click();
    await expectPlayback(3);
    const file = (await rendered()).at(-1);
    assert.equal(file.type, 'file');
    assert.ok(Math.abs(file.volume - 0.4) < 1e-6);
    assert.equal(file.duration, 3);
    await play.click();
    await settings.waitForFunction(() => {
      const playback = window.wakePreviewAudio.at(-1);
      return playback.stopped || playback.node.context.state === 'closed';
    });
    assert.deepEqual(await savedWakeSettings(), original);
    console.log('PASS Wake preview played the draft tone and uploaded WAV at the selected volume.');
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
