/** Bounded real voice + Electron check; isolated transcript and Gateway session. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
import {
  root,
  runtime,
  initialize,
  environment,
  runCli,
} from '../../packages/runtime/src/index.mjs';
import { startCompanionVoice } from '../../integrations/voice_runtime/host.mjs';
import { startCore } from '../../packages/runtime/src/providers/core.mjs';

const rt = runtime();
await startCore(rt);
const voice = await startCompanionVoice();
const parent = path.join(root, '.runtime/voice-integration-check');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const isolated = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: rt.gatewayPort,
});
initialize(isolated);
copyFileSync(rt.tokenPath, isolated.tokenPath);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(rt.gatewayPort),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_SESSION: `agent:capri:voice-verification-${randomUUID()}`,
  CAPRI_DESKTOP_VERIFICATION_VOICE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url);
let application;
try {
  application = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 180000,
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.setBackgroundThrottling(false),
  );
  await page.waitForFunction(
    () => !document.querySelector('#voice-toggle').title.includes('loading'),
    null,
    { timeout: 180000 },
  );
  await page.evaluate(() => {
    window.__voiceCheck = [];
    window.__poseChoices = [];
    window.__voiceLatency = {};
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' && event.target.id === 'message' && !event.shiftKey)
          window.__voiceLatency.sentAt = performance.now();
      },
      { capture: true },
    );
    new MutationObserver(() => {
      if (document.body.dataset.speaking === 'true' && !window.__voiceLatency.playbackAt)
        window.__voiceLatency.playbackAt = performance.now();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-speaking'] });
    window.capri.onEvent((event) => {
      if (event.type === 'avatar.selection' && event.source)
        window.__poseChoices.push({ source: event.source, id: event.selection.id });
      if (event.type === 'turn.delta' && !window.__voiceLatency.textAt)
        window.__voiceLatency.textAt = performance.now();
      if (event.type.startsWith('voice.'))
        window.__voiceCheck.push({
          type: event.type,
          turnId: event.turnId,
          sequence: event.sequence,
          sampleRate: event.sampleRate,
          bytes: event.pcm?.length,
          elapsedMs: event.elapsedMs,
          requestMs: event.requestMs,
          tokenMs: event.tokenMs,
          decoderMs: event.decoderMs,
        });
    });
  });
  await page
    .locator('#message')
    .fill('Give me a short greeting in English, just one friendly sentence.');
  await page.locator('#message').press('Enter');
  await page.waitForFunction(() => document.body.dataset.speaking === 'true', null, {
    timeout: 240000,
  });
  await page.waitForFunction(
    () => document.body.dataset.signal === 'speaking' && document.body.dataset.glitch === 'active',
    null,
    { timeout: 5000 },
  );
  const spoken = await page.evaluate(() => ({
    events: window.__voiceCheck,
    playbackLatencyMs: window.__voiceLatency.playbackAt - window.__voiceLatency.sentAt,
    firstTextMs: window.__voiceLatency.textAt - window.__voiceLatency.sentAt,
    text: [...document.querySelectorAll('.message[data-role="assistant"] .message-text')].at(-1)
      ?.textContent,
    crt: document.body.dataset.crt,
    speechGlitch: document.body.dataset.glitch === 'active',
    modelChoices: window.__poseChoices,
    frame: document.querySelector('#sprite').dataset.frame,
  }));
  assert.ok(spoken.events.some((event) => event.type === 'voice.audio' && event.bytes > 1000));
  // Stopping must silence the renderer immediately, even after text completes.
  await page.locator('#stop').click({ force: true });
  await page.waitForFunction(
    () => document.body.dataset.speaking === 'false' && document.body.dataset.voiceBusy === 'false',
  );
  await page.locator('#voice-toggle').click({ force: true });
  await page.waitForFunction(
    () => document.querySelector('#voice-toggle').getAttribute('aria-pressed') === 'false',
  );
  await page.locator('#voice-toggle').click({ force: true });
  await page.waitForFunction(
    () => document.querySelector('#voice-toggle').getAttribute('aria-pressed') === 'true',
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    engine: voice.engine,
    profile: voice.profile,
    adapterSha256: voice.adapterSha256,
    actualLlm: true,
    actualSynthesis: true,
    electronPlaybackStarted: true,
    stopAndMutePassed: true,
    playbackLatencyMs: spoken.playbackLatencyMs,
    firstTextMs: spoken.firstTextMs,
    crt: spoken.crt,
    speechGlitch: spoken.speechGlitch,
    modelChoices: spoken.modelChoices,
    frameAtSpeechStart: spoken.frame,
    text: spoken.text,
    events: spoken.events,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(
    path.join(root, 'logs/companion-voice-integration.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close();
  await runCli(
    [
      'gateway',
      'call',
      'sessions.delete',
      '--params',
      JSON.stringify({ key: env.CAPRI_DESKTOP_VERIFICATION_SESSION, deleteTranscript: true }),
      '--json',
      '--timeout',
      '60000',
    ],
    rt,
  );
}
