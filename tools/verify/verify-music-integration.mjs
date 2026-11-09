// SPDX-License-Identifier: GPL-3.0-only
// Real app/Settings/command bridge; generated stereo replaces OS loopback and
// music-worker IPC is a bounded synthetic sink. No microphone or user sound.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { settingsView } from './settings-view.mjs';

const root = process.cwd(),
  parent = path.join(root, '.runtime/music-integration-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const report = {
  passed: false,
  folder,
  capturedSystemAudio: false,
  physicalMicrophone: false,
  checks: [],
  errors: [],
  layouts: [],
};
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const owner = await application.firstWindow();
  owner.on('pageerror', (error) => report.errors.push(error.message));
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const initial = await owner.evaluate(() => window.capri.bootstrap());
  assert.equal(initial.musicListening.enabled, false);
  assert.equal(initial.musicListening.phase, 'off');
  assert.equal(await owner.locator('#music-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await owner.locator('#microphone-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(initial.microphone.status, 'off');
  report.checks.push(
    'real app cold-starts with visible music control, independent music/ASR microphone both off',
  );
  const resources = await application.evaluate(async ({ net }) => {
    const modules = [
      'system-music-capture.mjs',
      'music-worklet.mjs',
      'music-listening-panel.mjs',
      'music-animation.mjs',
    ];
    const notes = [
      '01-eighth-cyan',
      '02-beamed-lime',
      '03-quarter-pink',
      '04-sixteenth-violet',
    ].map((name) => 'music/' + name + '.png');
    return Promise.all(
      [...modules, ...notes, 'sprites/music-window.png', 'sprites/music-floor.png'].map(
        async (name) => {
          const response = await net.fetch('capri://desktop/' + name);
          return { name, ok: response.ok, type: response.headers.get('content-type') };
        },
      ),
    );
  });
  assert(resources.every(({ ok }) => ok));
  report.resources = resources;
  report.checks.push(
    'every music module, reviewed pose and floating-note image is served through the real resource allowlist',
  );
  for (const width of [480, 320]) {
    await owner.setViewportSize({ width, height: 660 });
    await owner.waitForTimeout(200);
    for (const presence of ['portrait', 'core']) {
      await owner.evaluate((value) => {
        document.body.dataset.presence = value;
      }, presence);
      const layout = await owner.evaluate(() => {
        const rect = (element) => {
          const r = element.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        const controls = [...document.querySelectorAll('#quick-actions button')].filter(
          (button) =>
            button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden',
        );
        return {
          width: innerWidth,
          presence: document.body.dataset.presence,
          controls: controls.map((button) => ({
            id: button.id || button.dataset.quick,
            ...rect(button),
          })),
        };
      });
      report.layouts.push(layout);
      assert(
        layout.controls.every((control) => control.left >= 0 && control.right <= width + 1),
        'Toolbar overflows ' + width + ' ' + presence,
      );
      for (let a = 0; a < layout.controls.length; a++)
        for (let b = a + 1; b < layout.controls.length; b++) {
          const x = layout.controls[a],
            y = layout.controls[b];
          assert(
            x.right <= y.left + 1 ||
              y.right <= x.left + 1 ||
              x.bottom <= y.top + 1 ||
              y.bottom <= x.top + 1,
            'Toolbar controls overlap',
          );
        }
      await owner.screenshot({ path: path.join(folder, `toolbar-${width}-${presence}.png`) });
    }
  }
  report.checks.push(
    'all quick controls fit without overlap at 480px and 320px in portrait and compact/core modes',
  );
  await owner.setViewportSize({ width: 480, height: 660 });
  const settings = await settingsView(application, 'music');
  assert.equal((await settings.evaluate(() => window.capri.musicStatus())).phase, 'off');
  await application.evaluate(({ ipcMain, session }) => {
    const state = (globalThis.musicIntegrationFixture = {
      packets: [],
      starts: 0,
      stops: 0,
      osRequests: 0,
    });
    session.defaultSession.setPermissionRequestHandler((_w, _p, respond) => {
      state.osRequests++;
      respond(false);
    });
    session.defaultSession.setDisplayMediaRequestHandler((_r, respond) => {
      state.osRequests++;
      respond({});
    });
    const handle = (name, callback) => {
      ipcMain.removeHandler('capri:' + name);
      ipcMain.handle('capri:' + name, (_event, input) => callback(input));
    };
    handle('music-audio-start', () => {
      state.starts++;
      return { sessionId: 'synthetic-integrated', sampleRate: 16000 };
    });
    handle('music-audio-prepare', () => true);
    handle('music-audio-cancel', () => true);
    handle('music-audio-ready', () => true);
    handle('music-audio-packet', (packet) => {
      const values = new Float32Array(
        packet.pcm.buffer,
        packet.pcm.byteOffset,
        packet.pcm.byteLength / 4,
      );
      let sum = 0;
      for (const value of values) sum += value * value;
      state.packets.push({
        bytes: packet.pcm.byteLength,
        sequence: packet.sequence,
        rms: Math.sqrt(sum / values.length),
      });
      return { accepted: true };
    });
    handle('music-audio-stop', () => {
      state.stops++;
      return true;
    });
  });
  await owner.evaluate(() => {
    let source, context;
    window.musicSyntheticFixture = {
      requests: 0,
      close: async () => {
        try {
          source?.stop();
        } catch {}
        await context?.close();
      },
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.musicSyntheticFixture.requests++;
      context = new AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } });
      await context.resume();
      source = context.createOscillator();
      source.frequency.value = 440;
      const left = context.createGain(),
        right = context.createGain(),
        merger = context.createChannelMerger(2),
        sink = context.createMediaStreamDestination();
      left.gain.value = 0.25;
      right.gain.value = -0.25;
      source.connect(left).connect(merger, 0, 0);
      source.connect(right).connect(merger, 0, 1);
      merger.connect(sink);
      source.start();
      window.musicSyntheticFixture.track = sink.stream.getAudioTracks()[0];
      return sink.stream;
    };
  });
  await settings.locator('#music-listening-enabled').check();
  await application.evaluate(async () => {
    const until = Date.now() + 12000;
    while (globalThis.musicIntegrationFixture.packets.length < 3 && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 100));
  });
  const stream = await application.evaluate(() => globalThis.musicIntegrationFixture);
  assert.equal(stream.starts, 1);
  assert.equal(stream.osRequests, 0);
  assert(stream.packets.length >= 3);
  assert(stream.packets.every((packet) => packet.bytes === 32000));
  assert(stream.packets.slice(1).every((packet) => packet.rms > 0.15 && packet.rms < 0.2));
  assert.equal(await owner.evaluate(() => window.musicSyntheticFixture.requests), 1);
  await settings.evaluate(() => window.capri.musicCommand('stop'));
  // The real host service has no synthetic worker session, so replay only its
  // documented session-revocation event after exercising the actual Stop IPC.
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('capri:event', {
        type: 'music.status',
        phase: 'off',
        enabled: false,
        stoppedSessionId: 'synthetic-integrated',
      });
  });
  await owner.waitForFunction(() => window.musicSyntheticFixture.track.readyState === 'ended');
  await owner.evaluate(() => window.musicSyntheticFixture.close());
  const after = await owner.evaluate(() => window.capri.bootstrap());
  assert.equal(after.microphone.status, 'off');
  assert.equal(after.musicListening.enabled, false);
  assert.equal((await application.evaluate(() => globalThis.musicIntegrationFixture)).stops, 0);
  assert.deepEqual(report.errors, []);
  report.checks.push(
    'actual Settings-to-companion command bridge streams exact synthetic PCM through real AudioWorklet, stops cleanly and leaves microphone off',
  );
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify(
    { passed: report.passed, folder: report.folder, checks: report.checks, errors: report.errors },
    null,
    2,
  ),
);
