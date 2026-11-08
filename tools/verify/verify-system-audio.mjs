// SPDX-License-Identifier: GPL-3.0-only
/** Exercise the actual Electron audio graph with two silent, generated input streams. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime', 'system-audio-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'entry.mjs');
writeFileSync(
  entry,
  `
import { app, BrowserWindow, protocol } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const renderer = ${JSON.stringify(path.join(root, 'apps/desktop/renderer'))};
app.setPath('userData', ${JSON.stringify(path.join(folder, 'electron-profile'))});
protocol.registerSchemesAsPrivileged([{ scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(async () => {
  protocol.handle('capri', (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/index.html')
      return new Response('<meta charset="utf-8"><body>Generated audio verification</body>', { headers: { 'Content-Type': 'text/html' } });
    if (!['/microphone.mjs', '/microphone-worklet.mjs'].includes(pathname)) return new Response('', { status: 404 });
    return new Response(readFileSync(path.join(renderer, pathname.slice(1))), { headers: { 'Content-Type': 'text/javascript' } });
  });
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await window.loadURL('capri://desktop/index.html');
});
`,
);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--autoplay-policy=no-user-gesture-required'],
    env,
    timeout: 15000,
  });
  const page = await application.firstWindow({ timeout: 15000 });
  const result = await page.evaluate(async () => {
    const { MicrophoneClient } = await import('/microphone.mjs');
    const synthetic = new AudioContext({ sampleRate: 16000 });
    const tone = (frequency) => {
      const stream = synthetic.createMediaStreamDestination();
      const amplitude = synthetic.createGain();
      const wave = synthetic.createOscillator();
      amplitude.gain.value = 0.3;
      wave.frequency.value = frequency;
      wave.connect(amplitude).connect(stream);
      wave.start();
      return stream.stream.getAudioTracks()[0];
    };
    const mic = tone(300);
    const loopback = tone(700);
    const canvas = document.createElement('canvas');
    const video = canvas.captureStream(1).getVideoTracks()[0];
    navigator.mediaDevices.getUserMedia = async () => new MediaStream([mic]);
    navigator.mediaDevices.getDisplayMedia = async () => new MediaStream([loopback, video]);
    const received = [];
    const errors = [];
    const client = new MicrophoneClient({
      api: {
        startMicrophone: async () => ({ sessionId: 'fixture' }),
        microphoneReady: async () => {},
        microphoneAudio: async ({ pcm }) => {
          received.push(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4));
          return { accepted: true };
        },
        microphonePlayback: async () => {},
        prepareSystemAudio: async () => {},
        cancelSystemAudio: async () => {},
        stopMicrophone: async () => {},
      },
      onState() {},
      onError: (message) => errors.push(message),
      onLevel() {},
    });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const spectrum = (frequency, samples) => {
      let real = 0,
        imaginary = 0;
      for (let i = 0; i < samples.length; i++) {
        const phase = (2 * Math.PI * frequency * i) / 16000;
        real += samples[i] * Math.cos(phase);
        imaginary += samples[i] * Math.sin(phase);
      }
      return (2 * Math.hypot(real, imaginary)) / samples.length;
    };
    const measure = async (settle = 700) => {
      await wait(settle);
      const samples = received.at(-1) ?? [];
      return [spectrum(300, samples), spectrum(700, samples)];
    };
    try {
      await synthetic.resume();
      client.settings({ available: true });
      await client.start();
      const before = await measure();
      const enabled = await client.setSystemAudio(true);
      const mixed = await measure();
      client.playback({ speaking: true, text: 'Synthetic playback state' });
      const duringPlayback = await measure();
      client.playback({ speaking: false });
      const afterPlayback = await measure();
      await client.setSystemAudio(false);
      const afterDisable = await measure();
      const tracksAfterDisable = [mic.readyState, loopback.readyState, video.readyState];
      client.stop();
      return {
        errors,
        enabled,
        before,
        mixed,
        duringPlayback,
        afterPlayback,
        afterDisable,
        tracksAfterDisable,
        micAfterStop: mic.readyState,
      };
    } finally {
      if (client.run) client.stop();
      await synthetic.close();
    }
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.enabled, true);
  for (const stage of ['before', 'mixed', 'duringPlayback', 'afterPlayback', 'afterDisable'])
    assert.ok(
      result[stage][0] > 0.06,
      `The microphone must stay audible to recognition during ${stage}`,
    );
  for (const stage of ['mixed', 'afterPlayback'])
    assert.ok(
      result[stage][1] > 0.04,
      `The system audio input must reach recognition during ${stage}`,
    );
  for (const stage of ['before', 'duringPlayback', 'afterDisable'])
    assert.ok(result[stage][1] < 0.01, `The system audio input must be absent during ${stage}`);
  assert.deepEqual(result.tracksAfterDisable, ['live', 'ended', 'ended']);
  assert.equal(result.micAfterStop, 'ended');
  console.log(
    'PASS real Electron audio graph mixes two generated streams, suppresses echo, and releases audio tracks.',
  );
} finally {
  await application?.close();
}
