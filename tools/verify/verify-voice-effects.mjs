/** Real Electron/Web Audio DSP and selected voice, isolated settings, no microphone. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { startCompanionVoice } from '../../integrations/voice_runtime/host.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/voice-effects-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
let requests = 0,
  application;
const server = createServer((req, res) => {
  if (req.url === '/v1/models') res.end('{"data":[]}');
  else {
    requests++;
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
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(
  path.join(folder, 'desktop/voice.json'),
  JSON.stringify({ schemaVersion: 1, enabled: false }),
);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url),
  errors = [];
try {
  await startCompanionVoice();
  application = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const companion = await application.firstWindow();
  let page = companion;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    win.webContents.setAudioMuted(true);
    win.webContents.setBackgroundThrottling(false);
    win.webContents.send('capri:event', { type: 'open-voice-effects' });
  });
  page = await settingsView(application, 'voice');
  await page.waitForSelector('#voice-effects-panel:not([hidden])');
  const initial = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(initial.voiceEffects.enabled, false);
  assert.equal(initial.voice.enabled, false);
  assert.equal(initial.voice.ready, false);
  const effectsFile = path.join(folder, 'desktop/voice-effects.json');
  const savedEffects = () => (existsSync(effectsFile) ? readFileSync(effectsFile, 'utf8') : null);
  const beforePreview = savedEffects();
  await page.locator('#voice-effects-preset').selectOption('holographic');
  assert.equal(await page.locator('#voice-effects-enabled').isChecked(), true);
  await page.waitForFunction(
    () => !document.querySelector('#voice-effects-preview').disabled,
    null,
    { timeout: 60000 },
  );
  await companion.evaluate(() => {
    window.__fxAudio = [];
    window.__fxPreview = undefined;
    window.capri.onEvent((e) => {
      if (e.type === 'voice.audio') window.__fxAudio.push(e);
      if (e.type === 'voice.preview-started') window.__fxPreview = e.effects;
    });
  });
  await page.locator('#voice-effects-preview').click({ force: true });
  assert.equal(await page.locator('#voice-effects-preview').isDisabled(), true);
  await companion.waitForFunction(() => window.__fxAudio.length > 0, null, { timeout: 60000 });
  assert.equal(await companion.evaluate(() => window.__fxPreview?.preset), 'holographic');
  assert.equal(savedEffects(), beforePreview);
  await companion.waitForFunction(() => document.body.dataset.speaking === 'true', null, {
    timeout: 15000,
  });
  await companion.evaluate(() => window.capri.stopVoice());
  await companion.waitForFunction(() => document.body.dataset.speaking === 'false');
  await page.waitForFunction(() => !document.querySelector('#voice-effects-preview').disabled);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).voice.enabled, false);
  const metrics = await companion.evaluate(async () => {
    const { VoiceEffects } = await import('./voice-effects.mjs');
    const { VOICE_EFFECT_PRESETS, VOICE_EFFECT_LIMITS } = await import(
      './voice-effects-settings.mjs'
    );
    const raw = Uint8Array.from(atob(window.__fxAudio[0].pcm), (c) => c.charCodeAt(0));
    const pcm = new Float32Array(raw.buffer),
      frames = pcm.length + 48000;
    const render = async (preset, split = false) => {
      const c = new OfflineAudioContext(1, frames, 24000),
        started = performance.now();
      const fx = new VoiceEffects(c, c.destination);
      fx.configure(preset);
      if (preset.glitch > 100) {
        fx.active = true;
        fx.burst(true);
      }
      const parts = split
        ? [pcm.slice(0, Math.floor(pcm.length / 2)), pcm.slice(Math.floor(pcm.length / 2))]
        : [pcm];
      let offset = 0;
      for (const samples of parts) {
        const b = c.createBuffer(1, samples.length, 24000);
        b.copyToChannel(samples, 0);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(fx.input);
        s.start(offset / 24000);
        offset += samples.length;
      }
      const output = (await c.startRendering()).getChannelData(0).slice();
      fx.destroy();
      return { output, ms: performance.now() - started };
    };
    const clean = await render(VOICE_EFFECT_PRESETS.clean),
      full = await render(VOICE_EFFECT_PRESETS.holographic),
      split = await render(VOICE_EFFECT_PRESETS.holographic, true);
    let bypassError = 0,
      splitError = 0,
      peak = 0,
      energy = 0;
    for (let i = 0; i < frames; i++) {
      bypassError = Math.max(bypassError, Math.abs(clean.output[i] - (pcm[i] ?? 0)));
      splitError = Math.max(splitError, Math.abs(full.output[i] - split.output[i]));
      peak = Math.max(peak, Math.abs(full.output[i]));
      if (i >= pcm.length) energy += full.output[i] ** 2;
    }
    const presets = {};
    for (const name of ['cybernetic', 'radio', 'maximum']) {
      const settings =
        name === 'maximum'
          ? { ...VOICE_EFFECT_LIMITS, enabled: true, preset: 'custom' }
          : VOICE_EFFECT_PRESETS[name];
      const p = await render(settings);
      presets[name] = {
        finite: p.output.every(Number.isFinite),
        peak: Math.max(...p.output.slice(0, 10000).map(Math.abs)),
        tailEnergy: p.output
          .subarray(pcm.length + 12000)
          .reduce((sum, sample) => sum + sample * sample, 0),
        renderMs: p.ms,
      };
    }
    return {
      bypassError,
      splitError,
      peak,
      tailEnergy: energy,
      sourceSeconds: pcm.length / 24000,
      renderMs: full.ms,
      presets,
    };
  });
  assert.ok(metrics.bypassError < 1e-6);
  assert.ok(metrics.splitError < 1e-5);
  assert.ok(metrics.peak <= 1 && metrics.tailEnergy > 0);
  for (const value of Object.values(metrics.presets)) assert.equal(value.finite, true);
  assert.ok(metrics.presets.maximum.peak <= 1 && metrics.presets.maximum.tailEnergy > 0);
  await page.locator('#voice-effects-reset').click({ force: true });
  await page.waitForFunction(() => !document.querySelector('#voice-effects-enabled').checked);
  assert.equal(savedEffects(), beforePreview);
  const history = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(history.messages.length, 0);
  assert.equal(requests, 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(folder, 'voice-effects.png') });
  writeFileSync(
    path.join(root, 'logs/voice-effects-verification.json'),
    JSON.stringify(
      {
        passed: true,
        mutedPhysicalOutput: true,
        realSelectedVoice: true,
        physicalMicrophone: false,
        metrics,
        folder,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, metrics, folder }));
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
