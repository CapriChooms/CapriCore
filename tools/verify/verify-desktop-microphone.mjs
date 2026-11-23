/** Real CPU ASR + AudioWorklet + IPC + TTS, with a fake microphone and isolated history. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import {
  root,
  runtime,
  initialize,
  environment,
  settings,
} from '../../packages/runtime/src/index.mjs';
import { startCompanionVoice } from '../../integrations/voice_runtime/host.mjs';

const parent = path.join(root, '.runtime/asr-verification');
const russian = process.argv.includes('--ru');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'electron-'));
const reference = path.join(parent, 'english-reference.wav');
if (!existsSync(reference)) {
  const response = await fetch(
    'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21/resolve/9a65b6ea94c311ca770c2bf895b30f456a22d703/test_wavs/0.wav',
  );
  if (!response.ok) throw new Error('Could not obtain public English ASR test recording');
  writeFileSync(reference, Buffer.from(await response.arrayBuffer()));
}
const fakeAudio = path.join(folder, 'fake-microphone.wav');
if (russian)
  execFileSync(
    path.join(root, '.runtime/asr-venv/Scripts/python.exe'),
    [path.join(root, 'scripts/prepare-russian-asr-fixture.py')],
    { windowsHide: true },
  );
const inputReference = russian
  ? path.join(root, '.runtime/asr-verification/russian-reference.wav')
  : reference;
// Test fixture files contain only a public reference recording, never live audio.
execFileSync(
  path.join(root, '.runtime/asr-venv/Scripts/python.exe'),
  [
    '-c',
    `
import wave,sys,numpy as np
with wave.open(sys.argv[1],'rb') as source:
    params=source.getparams(); data=source.readframes(source.getnframes())
    assert params.nchannels==1 and params.sampwidth==2
    if params.framerate!=16000:
        pcm=np.frombuffer(data,dtype='<i2').astype(np.float32)
        data=np.interp(np.arange(int(len(pcm)*16000/params.framerate))*params.framerate/16000,np.arange(len(pcm)),pcm).astype('<i2').tobytes()
with wave.open(sys.argv[2],'wb') as target:
    target.setnchannels(1);target.setsampwidth(2);target.setframerate(16000);target.writeframes(bytes(16000*2*3)+data+bytes(16000*2*5))
`,
    inputReference,
    fakeAudio,
  ],
  { windowsHide: true },
);

const seen = [],
  cancellations = [];
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404);
    res.end();
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw),
    text = body.messages.at(-1).content;
  seen.push({ session: req.headers['x-openclaw-session-key'], text });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const reply =
    text === 'microphone interruption test'
      ? 'The neon outside can wait for us. I have a long story about the city tonight. We could watch the traffic from the window and talk about all the things that happened today. There is no hurry. Take your time and tell me whenever you want to ask another question.'
      : 'I heard you. The shared conversation is still here.';
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: '[avatar:neutral]\n' + reply } }] })}\n\n`,
  );
  const timer = setTimeout(() => res.end('data: [DONE]\n\n'), seen.length === 1 ? 45000 : 100);
  res.on('close', () => {
    clearTimeout(timer);
    cancellations.push(text);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(path.join(folder, 'desktop/voice.json'), JSON.stringify({ enabled: true }));
if (russian)
  writeFileSync(
    path.join(folder, 'desktop/languages.json'),
    JSON.stringify({
      schemaVersion: 1,
      settings: {
        interface: 'en',
        conversation: 'en',
        recognition: 'ru',
        speech: 'follow',
        autoDetect: false,
        experimentalRecognition: true,
      },
    }),
  );
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '1',
};
// Continuous mode remains a supported configuration; wake gating has its own real-ASR test.
env.CAPRI_DESKTOP_VERIFICATION_WAKE = '0';
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
let application, page;
const errors = [],
  checks = [];
const record = (name) => {
  checks.push(name);
  console.log('PASS ' + name);
};
try {
  await startCompanionVoice();
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
  application.process().stderr.on('data', (data) => {
    if (/unavailable|denied|worklet|permission|failed/i.test(data.toString()))
      console.log(data.toString().trim());
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
  assert.equal(await page.locator('#microphone-toggle').getAttribute('aria-pressed'), 'false');
  const permission = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return 'unexpected';
    } catch (error) {
      return error.name;
    }
  });
  assert.equal(permission, 'NotAllowedError');
  record('microphone off at launch; unarmed device access denied');
  await page.evaluate(() => {
    // Diagnostic capture is restricted to this fake-device test recording.
    const NativeWorklet = window.AudioWorkletNode;
    window.__fakePcm = [];
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(...args) {
        super(...args);
        this.port.addEventListener('message', (event) => {
          if (event.data.pcm) window.__fakePcm.push(Array.from(new Float32Array(event.data.pcm)));
        });
      }
    };
    window.__micEvents = [];
    window.__micStoppedAt = null;
    new MutationObserver(() => {
      if (document.body.dataset.speaking === 'false') window.__micStoppedAt = performance.now();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-speaking'] });
    window.capri.onEvent((event) => {
      if (
        event.type.startsWith('microphone.') ||
        ['turn.started', 'turn.cancelled', 'voice.cancelled'].includes(event.type)
      )
        window.__micEvents.push({ ...event, at: performance.now() });
    });
  });
  await page.waitForFunction(
    () => !document.querySelector('#voice-toggle').title.includes('loading'),
    null,
    { timeout: 180000 },
  );
  await page.locator('#message').fill('microphone interruption test');
  await page.locator('#message').press('Enter');
  await page.waitForFunction(() => document.body.dataset.speaking === 'true', null, {
    timeout: 90000,
  });
  await page.locator('#message').fill('Keep this typed draft.');
  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'listening', null, {
    timeout: 30000,
  });
  await page.waitForFunction(
    () =>
      window.__micEvents.some(
        (e) => e.type === 'microphone.settings' && e.recognitionPhase === 'processing',
      ),
    null,
    { timeout: 20000 },
  );
  assert.equal(await page.locator('#message').inputValue(), 'Keep this typed draft.');
  assert.ok(
    !(await page.evaluate(() => window.__micEvents)).some(
      (e) => e.type === 'microphone.partial' && e.text && !e.final,
    ),
  );
  record('direct accurate recognition exposes processing status without text drafts');
  await page.waitForFunction(
    () => document.querySelectorAll('.message[data-role="user"]').length === 2,
    null,
    { timeout: 20000 },
  );
  const camera = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      return 'unexpected';
    } catch (error) {
      return error.name;
    }
  });
  assert.equal(camera, 'NotAllowedError');
  record('armed companion permits audio while camera remains denied');
  await page.locator('#microphone-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.microphone === 'off');
  const events = await page.evaluate(() => window.__micEvents);
  const final = events.find((e) => e.type === 'microphone.partial' && e.text && e.final);
  const processing = events.findLast(
    (e) =>
      e.type === 'microphone.settings' && e.recognitionPhase === 'processing' && e.at < final.at,
  );
  assert.ok(final && processing && processing.at < final.at);
  assert.ok(!events.some((e) => e.type === 'microphone.partial' && e.text && !e.final));
  assert.equal(seen.length, 2);
  assert.equal(seen[1].text, final.text);
  // Acoustic preprocessing may alter the opening words; this is an integration
  // check of real recognition and routing, not a word-error-rate benchmark.
  if (russian) assert.match(seen[1].text, /[А-Яа-яЁё]{3}/);
  else assert.ok(seen[1].text.toUpperCase().includes('YELLOW LAMPS'));
  assert.equal(seen[0].session, seen[1].session);
  assert.equal(seen[0].session, settings.sessionKey);
  assert.equal(await page.locator('#message').inputValue(), 'Keep this typed draft.');
  record('one final phrase uses the typed-message session without replacing the draft');
  await page.waitForFunction(() => document.body.dataset.replying === 'false', null, {
    timeout: 10000,
  });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.message[data-role="user"]').count(), 2);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).microphone.enabled, false);
  const offAgain = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return 'unexpected';
    } catch (error) {
      return error.name;
    }
  });
  assert.equal(offAgain, 'NotAllowedError');
  assert.deepEqual(errors, []);
  record('switching off releases capture and prevents further input');
  await page.screenshot({ path: path.join(folder, 'microphone.png') });
  const report = {
    passed: true,
    language: russian ? 'ru' : 'en',
    timestamp: new Date().toISOString(),
    realCpuAsr: true,
    realTts: true,
    physicalMicrophone: false,
    fixtureGateway: true,
    checks,
    draft: false,
    recognitionMs: final.at - processing.at,
    events: events.map((e) => ({
      type: e.type,
      at: e.at,
      final: e.final,
      recognitionPhase: e.recognitionPhase,
      utterance: e.utterance,
      text: e.text,
    })),
    folder,
  };
  writeFileSync(
    path.join(
      root,
      russian
        ? 'logs/desktop-microphone-ru-verification.json'
        : 'logs/desktop-microphone-verification.json',
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ passed: true, checks, recognitionMs: report.recognitionMs, folder }),
  );
} catch (error) {
  if (page) {
    const syntheticPcm = await page.evaluate(() => window.__fakePcm?.flat() ?? []).catch(() => []);
    writeFileSync(
      path.join(folder, 'synthetic-captured.f32'),
      Buffer.from(Float32Array.from(syntheticPcm).buffer),
    );
    console.error('Synthetic capture:', folder);
  }
  if (page)
    console.error(
      await page
        .evaluate(() => ({
          mic: document.body.dataset.microphone,
          notice: document.querySelector('#notice').textContent,
          events: window.__micEvents?.slice(-10),
          errors: [],
        }))
        .catch(() => ({})),
    );
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
