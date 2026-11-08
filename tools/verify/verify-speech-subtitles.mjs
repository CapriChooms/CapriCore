/** Actual Electron audio clock + synthetic PCM; no LLM, TTS, microphone or owner history. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/subtitle-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const server = createServer((_req, res) => res.end('{"data":[]}'));
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
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url),
  report = {
    passed: false,
    folder,
    physicalPlayback: false,
    realAudioClock: true,
    syntheticPcm: true,
  };
let application;
const errors = [];
try {
  application = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await page.evaluate(async () => {
    const { ReplyVisibility } = await import('./reply-visibility.mjs');
    const original = ReplyVisibility.prototype.arm;
    ReplyVisibility.prototype.arm = function () {
      original.call(this);
      window.replyVisibilityVerifier = {
        complete: this.current?.complete,
        generated: this.current?.generated,
        speechExpected: this.current?.speechExpected,
        protected: this.current?.protected,
        playing: this.current?.playing,
        holds: [...this.holds],
        manual: this.manual,
        hidden: this.hidden,
        enabled: this.enabled,
        timer: this.timer !== undefined,
      };
    };
    const playback = ReplyVisibility.prototype.playback;
    ReplyVisibility.prototype.playback = function (id, busy) {
      (window.replyVisibilityPlayback ??= []).push({
        matches: id === this.current?.id,
        hasId: Boolean(id),
        busy,
      });
      playback.call(this, id, busy);
    };
    const { VoicePlayer } = await import('./voice-player.mjs');
    const ending = VoicePlayer.prototype.endPlayback;
    VoicePlayer.prototype.endPlayback = function () {
      window.replyAudioEnding = {
        generated: this.generated,
        queued: this.queue.length,
        playing: Boolean(this.source),
        clock: this.context?.currentTime,
      };
      return ending.call(this);
    };
  });
  await page.evaluate(() => document.fonts.ready);
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    win.webContents.setAudioMuted(true);
    win.webContents.setBackgroundThrottling(false);
  });
  // A genuine user gesture unlocks Web Audio; verification mode never starts TTS.
  await page.locator('#voice-toggle').click({ force: true });
  await page.waitForFunction(
    () => document.querySelector('#voice-toggle').getAttribute('aria-pressed') === 'true',
  );
  const emit = async (event) =>
    application.evaluate(
      ({ BrowserWindow }, payload) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
          .webContents.send('capri:event', payload),
      event,
    );
  await emit({ type: 'voice.settings', enabled: true, ready: true });
  const first =
    'The city is quiet tonight, and the neon reflections are dancing across the rain on your window.';
  const second =
    'We can stay right here for a while, let the music play, and watch those reflections together.';
  const long =
    'Every thought deserves enough room to unfold naturally while the city moves around us, so the words on this little screen should follow the voice through the whole idea instead of racing ahead or making you reach for the arrows whenever the next part of the conversation is ready.';
  const id = randomUUID(),
    assistant = {
      id: randomUUID(),
      turnId: id,
      role: 'assistant',
      text: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
  await emit({ type: 'turn.started', turnId: id, assistant });
  const full = first + ' ' + second + ' ' + long;
  await emit({ type: 'turn.delta', turnId: id, text: full });
  await emit({
    type: 'turn.completed',
    turnId: id,
    assistant: { ...assistant, text: full, status: 'complete' },
  });
  await page.waitForFunction(() =>
    document.querySelector('#subtitle-text').textContent.startsWith('The city'),
  );
  const packet = (sequence, text, seconds) => ({
    type: 'voice.audio',
    turnId: id,
    sequence,
    text,
    sampleRate: 24000,
    pcm: Buffer.alloc(Math.round(24000 * seconds) * 4).toString('base64'),
  });
  await emit(packet(0, first, 1.3));
  await page.waitForFunction(() => document.body.dataset.speaking === 'true');
  await emit(packet(1, second, 1.3));
  await emit(packet(2, long, 3));
  await emit({ type: 'voice.generated', turnId: id });
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator('#subtitle-text').textContent(),
    first,
    'Queued audio must not turn the page before playback',
  );
  await page.waitForFunction(
    () => document.querySelector('#subtitle-text').textContent.startsWith('We can stay'),
    null,
    { timeout: 4000 },
  );
  await page.waitForFunction(
    () => document.querySelector('#subtitle-text').textContent.startsWith('Every thought'),
    null,
    { timeout: 4000 },
  );
  const longStart = Number(await page.locator('#subtitle-text').getAttribute('data-index'));
  await page.waitForFunction(
    (index) => Number(document.querySelector('#subtitle-text').dataset.index) > index,
    longStart,
    { timeout: 3000 },
  );
  report.longSentenceAdvanced = true;
  await page.locator('#subtitle-previous').click({ force: true });
  const paused = await page.locator('#subtitle-text').getAttribute('data-index');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#subtitle-text').getAttribute('data-index'), paused);
  await page.locator('#subtitle-next').click({ force: true });
  report.manualNavigation = true;
  const nextId = randomUUID(),
    next = {
      id: randomUUID(),
      turnId: nextId,
      role: 'assistant',
      text: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
  await emit({ type: 'turn.started', turnId: nextId, assistant: next });
  await emit({ type: 'turn.delta', turnId: nextId, text: 'A fresh reply.' });
  await emit({
    type: 'turn.completed',
    turnId: nextId,
    assistant: { ...next, text: 'A fresh reply.', status: 'complete' },
  });
  await page.waitForTimeout(650);
  assert.equal(await page.locator('#subtitle-text').textContent(), 'A fresh reply.');
  assert.equal(await page.locator('#subtitle-text').getAttribute('data-index'), '0');
  assert.deepEqual(errors, []);
  report.staleTimersCancelled = true;
  await page.evaluate(async () => {
    const snapshot = await window.capri.bootstrap();
    await window.capri.setCompanionSettings({
      ...snapshot.companion,
      replyAutoHide: true,
      replyAutoHideSeconds: 2,
    });
  });
  await page.mouse.move(0, 0);
  const hideId = randomUUID();
  const hideReply = {
    ...next,
    id: randomUUID(),
    turnId: hideId,
    text: 'This reply finishes after its audio.',
    status: 'complete',
  };
  await emit({
    type: 'turn.started',
    turnId: hideId,
    assistant: { ...hideReply, text: '', status: 'streaming' },
  });
  await emit({ type: 'turn.delta', turnId: hideId, text: hideReply.text });
  await emit({ type: 'turn.completed', turnId: hideId, assistant: hideReply });
  await emit({ ...packet(0, hideReply.text, 2.5), turnId: hideId });
  await emit({ type: 'voice.generated', turnId: hideId });
  await page.waitForFunction(() => document.body.dataset.speaking === 'true');
  await page.waitForTimeout(2100);
  assert.notEqual(await page.locator('body').getAttribute('data-reply-hidden'), 'true');
  await page
    .waitForFunction(() => document.body.dataset.replyHidden === 'true', null, { timeout: 6500 })
    .catch(async (error) => {
      throw new Error(
        'Auto-hide state: ' +
          JSON.stringify(
            await page.evaluate(() => ({
              state: window.replyVisibilityVerifier,
              playback: window.replyVisibilityPlayback?.slice(-8),
              audio: window.replyAudioEnding,
              speaking: document.body.dataset.speaking,
            })),
          ),
        { cause: error },
      );
    });
  assert.equal(await page.locator('#subtitle-stage').isVisible(), false);
  assert.equal(await page.locator('#subtitle-text').textContent(), hideReply.text);
  await page.locator('#history-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.replyHidden === 'false');
  assert.equal(await page.locator('#history-panel').isVisible(), true);
  report.autoHideAfterPlayback = true;
  report.hiddenReplyPreservedInHistory = true;
  assert.deepEqual(errors, []);
  report.passed = true;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, 'logs/speech-subtitles-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
