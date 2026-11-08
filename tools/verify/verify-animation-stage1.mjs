/** Record the existing desktop renderer against the Stage 1 synthetic 15-second scene. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import { ACTIVE_AVATAR_CATALOG, loadAvatarCatalog } from '../../apps/desktop/avatar-catalog.mjs';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const require = createRequire(import.meta.url);
const parent = path.join(root, '.runtime/animation-stage1');
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(path.join(parent, 'baseline-'));
const fixture = path.join(output, 'fixture');
const duration = 15000;
const report = {
  schemaVersion: 1,
  durationMs: duration,
  technique: 'Isolated production Electron main and renderer with synthetic input and muted PCM.',
  timing: 'Renderer DOM commit observation followed by one requestAnimationFrame, not GPU scanout.',
  recording: 'CDP screencast is diagnostic and can add overhead. This is not a load benchmark.',
  audio: 'Local 24 kHz PCM fixture only. No microphone, TTS service or physical playback.',
  modes: {},
};
const settings = {
  glitchEnabled: false,
  floatEnabled: false,
  expandOnReply: false,
  buttonFeedback: false,
  memoryMonitor: false,
  processGraphs: false,
  wakeSound: 'off',
};
mkdirSync(path.join(fixture, 'desktop'), { recursive: true });
writeFileSync(
  path.join(fixture, 'desktop/companion.json'),
  JSON.stringify({ schemaVersion: 1, settings }),
);
const catalogPath = path.join(root, ACTIVE_AVATAR_CATALOG);
const catalog = loadAvatarCatalog(catalogPath);
const rgbaBytes = 1254 * 1254 * 4;
report.art = {
  pngFrames: catalog.frames.length,
  activePortraitFrames: catalog.portraitFrames.length,
  encodedBytes: catalog.frames.reduce((size, frame) => size + statSync(frame.file).size, 0),
  estimatedRgbaBytesPerFrame: rgbaBytes,
  estimatedRgbaBytesAt20Entries: 20 * rgbaBytes,
  estimatedRgbaBytesIfAllDecoded: catalog.frames.length * rgbaBytes,
  notes: 'Estimates exclude textures, masks and process overhead.',
};

const server = createServer((request, response) => {
  if (request.url !== '/v1/models') {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(fixture, 'openclaw'),
  workspace: path.join(fixture, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;

function tone(seconds) {
  const samples = Buffer.alloc(Math.round(seconds * 24000) * 4);
  for (let index = 0; index < samples.length / 4; index++) {
    const t = index / 24000;
    const envelope = [0.025, 0.11, 0.22, 0.075][Math.floor(t * 6) % 4];
    const edge = Math.min(1, t * 80, (seconds - t) * 100);
    samples.writeFloatLE(Math.sin(t * 2 * Math.PI * 170) * envelope * edge, index * 4);
  }
  return samples.toString('base64');
}
const audio = tone(1.75);
const landmarks = [
  ['rest', 1000],
  ['attention', 1900],
  ['thinking', 3550],
  ['phrase A', 5550],
  ['pause', 7250],
  ['phrase B', 8500],
  ['wink', 10050],
  ['interrupted', 10450],
  ['settled', 12950],
];
const errors = [];
let app;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(root, 'apps/desktop/main.mjs'),
      '--verification',
      '--autoplay-policy=no-user-gesture-required',
    ],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await page.evaluate(() => document.fonts.ready);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().endsWith('/index.html'),
    );
    win.webContents.setAudioMuted(true);
    win.webContents.setBackgroundThrottling(false);
    win.showInactive();
  });
  // Capture the verification window's real AvatarState from the existing bootstrap IPC.
  // Restore the prototype immediately so all measured selection/acknowledgement code is original.
  await app.evaluate(
    (_electron, file) => {
      const load = process.getBuiltinModule('module').createRequire(file);
      const { AvatarState } = load(file);
      const original = AvatarState.prototype.snapshot;
      AvatarState.prototype.snapshot = function capture() {
        globalThis.__capriStage1Avatar = this;
        AvatarState.prototype.snapshot = original;
        return original.call(this);
      };
    },
    path.join(root, 'apps/desktop/avatar-state.mjs'),
  );
  await page.evaluate(() => window.capri.bootstrap().then(() => undefined));
  assert.ok(await app.evaluate(() => Boolean(globalThis.__capriStage1Avatar)));
  const dispatch = (events, pose = null) =>
    app.evaluate(
      ({ BrowserWindow }, value) => {
        const win = BrowserWindow.getAllWindows().find((item) =>
          item.webContents.getURL().endsWith('/index.html'),
        );
        for (const event of value.events) win.webContents.send('capri:event', event);
        if (value.pose) {
          const selection = globalThis.__capriStage1Avatar.request(value.pose);
          if (selection)
            win.webContents.send('capri:event', { type: 'avatar.selection', selection });
        }
      },
      { events, pose },
    );
  await dispatch([{ type: 'voice.settings', enabled: true, ready: true, language: 'en' }]);
  await page.evaluate(() => {
    document.body.style.background = '#0c121c';
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  for (const mode of ['portrait', 'compact']) {
    const isPortrait = mode === 'portrait';
    await page.evaluate((expected) => {
      const button = document.querySelector('#presence-toggle');
      if ((button.getAttribute('aria-pressed') === 'true') !== expected) button.click();
    }, isPortrait);
    await page.waitForFunction(
      (expected) => document.body.dataset.presence === expected,
      isPortrait ? 'portrait' : 'core',
    );
    const modeDir = path.join(output, mode);
    const framesDir = path.join(modeDir, 'frames');
    mkdirSync(framesDir, { recursive: true });
    const initial = path.join(framesDir, '00000.jpg');
    await page.screenshot({ path: initial, type: 'jpeg', quality: 92 });
    const frames = [{ file: initial, atMs: 0 }];
    const writeFrame = ({ data, sessionId, metadata }) => {
      void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      const atMs = metadata.timestamp * 1000 - startEpoch;
      if (atMs < 0 || atMs >= duration || frames.length >= 1200) return;
      const file = path.join(framesDir, String(frames.length).padStart(5, '0') + '.jpg');
      writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, atMs });
    };
    const startEpoch = Date.now() + 250;
    const { bounds } = await page.evaluate((startEpoch) => {
      const sprite = document.querySelector('#sprite');
      const portrait = document.querySelector('#portrait-panel');
      const rect = portrait.getBoundingClientRect();
      const trace = [];
      const read = () => {
        const now = performance.timeOrigin + performance.now() - startEpoch;
        return {
          atMs: Number(now.toFixed(1)),
          frame: sprite.dataset.frame ?? null,
          avatar: sprite.dataset.avatar ?? null,
          activity: document.body.dataset.activity ?? null,
          state: document.body.dataset.signal ?? null,
          speaking: document.body.dataset.speaking === 'true',
          visible:
            document.body.dataset.presence === 'portrait' && portrait.getClientRects().length > 0,
        };
      };
      let last = '';
      const take = () => {
        const sample = read();
        const key = JSON.stringify({ ...sample, atMs: 0 });
        if (last === key) return;
        last = key;
        trace.push(sample);
      };
      const observer = new MutationObserver(take);
      for (const node of [sprite, document.body, portrait])
        observer.observe(node, { attributes: true });
      const readback = [];
      let active = true;
      let lastFrame = null;
      const paint = () => {
        if (!active) return;
        const sample = read();
        if (sample.visible && sample.frame !== lastFrame) {
          lastFrame = sample.frame;
          readback.push(sample);
        }
        requestAnimationFrame(paint);
      };
      take();
      requestAnimationFrame(paint);
      window.__capriStage1Trace = () => {
        active = false;
        observer.disconnect();
        return { trace, visibleFrameSamples: readback };
      };
      return {
        bounds: {
          viewportCss: [innerWidth, innerHeight],
          portraitCss: [rect.width, rect.height],
          dpr: devicePixelRatio,
        },
      };
    }, startEpoch);
    cdp.on('Page.screencastFrame', writeFrame);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
    const turnId = mode + '-stage1';
    const assistant = {
      id: turnId + '-response',
      turnId,
      role: 'assistant',
      text: '',
      status: 'streaming',
      createdAt: new Date(startEpoch).toISOString(),
    };
    const textA = 'Дай секунду.';
    const textB = 'Поняла, чум.';
    const microphone = (enabled) => ({
      type: 'microphone.settings',
      status: enabled ? 'listening' : 'off',
      wakeState: enabled ? 'disabled' : 'off',
      enabled,
      available: true,
      language: 'ru',
    });
    const packet = (sequence, text) => ({
      type: 'voice.audio',
      turnId,
      sequence,
      text,
      sampleRate: 24000,
      pcm: audio,
    });
    const actions = [
      [1500, 'attention', [microphone(true)], 'attentive'],
      [
        3000,
        'thinking',
        [microphone(false), { type: 'turn.started', turnId, assistant }],
        'thinking',
      ],
      [
        5000,
        'speech A',
        [
          { type: 'turn.delta', turnId, text: textA + ' ' + textB },
          {
            type: 'turn.completed',
            turnId,
            assistant: {
              ...assistant,
              text: textA + ' ' + textB,
              status: 'complete',
            },
          },
          packet(0, textA),
        ],
        'neutral',
      ],
      [7750, 'speech B', [packet(1, textB), { type: 'voice.generated', turnId }]],
      [9500, 'wink', [], 'wink'],
      [10125, 'interrupt', [{ type: 'microphone.interrupt' }, microphone(true)], 'attentive'],
      [11750, 'settle', [microphone(false)], 'neutral'],
    ];
    const sent = [];
    for (const [at, label, events, pose] of actions) {
      await delay(Math.max(0, startEpoch + at - Date.now()));
      sent.push({ label, targetMs: at, dispatchedMs: Date.now() - startEpoch });
      await dispatch(events, pose);
    }
    await delay(Math.max(0, startEpoch + duration - Date.now()));
    const { trace, visibleFrameSamples } = await page.evaluate(() => window.__capriStage1Trace());
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', writeFrame);
    const { metrics } = await cdp.send('Performance.getMetrics');
    const jsHeapUsedBytes = metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? null;
    report.modes[mode] = { bounds, sent, trace, visibleFrameSamples };
    assert.ok(
      trace.some(
        (entry) => entry.state === 'listening' && entry.atMs >= 1450 && entry.atMs <= 1850,
      ),
      'Attention did not enter listening',
    );
    assert.ok(
      trace.some((entry) => entry.speaking && entry.atMs >= 4950 && entry.atMs <= 5450),
      'Phrase A did not play',
    );
    assert.ok(
      trace.some((entry) => entry.speaking && entry.atMs >= 7700 && entry.atMs <= 8150),
      'Phrase B did not play',
    );
    assert.ok(
      trace.some((entry) => !entry.speaking && entry.atMs >= 6650 && entry.atMs <= 7650),
      'Phrase pause was not observed',
    );
    if (isPortrait) {
      assert.ok(
        visibleFrameSamples.some((entry) => entry.frame?.startsWith('idle-wink')),
        'Wink was never shown',
      );
      assert.ok(
        visibleFrameSamples.some(
          (entry) => entry.frame === 'attentive' && entry.atMs >= 10050 && entry.atMs <= 10800,
        ),
        'Interrupt did not return to attention',
      );
    } else assert.equal(visibleFrameSamples.length, 0, 'Core exposes portrait frames');
    assert.ok(frames.length >= 3, 'Native screencast did not capture enough frames');

    frames.sort((a, b) => a.atMs - b.atMs);
    const concatFile = path.join(modeDir, 'frames.ffconcat');
    const concat = ['ffconcat version 1.0'];
    for (let index = 0; index < frames.length; index++) {
      const hold = Math.max(
        0.001,
        ((frames[index + 1]?.atMs ?? duration) - frames[index].atMs) / 1000,
      );
      concat.push(
        'file ' +
          JSON.stringify(
            path.relative(modeDir, frames[index].file).replaceAll('\\', '/'),
          ).replaceAll('"', "'"),
        'duration ' + hold.toFixed(5),
      );
    }
    concat.push(
      'file ' +
        JSON.stringify(path.relative(modeDir, frames.at(-1).file).replaceAll('\\', '/')).replaceAll(
          '"',
          "'",
        ),
    );
    writeFileSync(concatFile, concat.join('\n') + '\n');
    const video = mode + '-v1.mp4';
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatFile,
        '-t',
        '15',
        '-vf',
        'fps=24,pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '19',
        '-movflags',
        '+faststart',
        path.join(output, video),
      ],
      { windowsHide: true, timeout: 60000 },
    );
    const marks = landmarks.map(([label, at]) => {
      const frame = frames.findLast((entry) => entry.atMs <= at) ?? frames[0];
      return {
        label,
        atMs: at,
        capturedMs: Number(frame.atMs.toFixed(1)),
        file: path.relative(output, frame.file).replaceAll('\\', '/'),
      };
    });
    const data = {
      bounds,
      video,
      screenshotFrames: frames.length,
      distinctVisibleFrames: new Set(visibleFrameSamples.map((entry) => entry.frame)).size,
      jsHeapUsedBytes,
      jsHeapNotes: 'Chrome JS heap snapshot only; excludes decoded graphics.',
      sent,
      trace,
      visibleFrameSamples,
      marks,
    };
    report.modes[mode] = data;
    writeFileSync(path.join(output, mode + '-trace.json'), JSON.stringify(data, null, 2) + '\n');
  }
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  throw error;
} finally {
  report.pageErrors = errors;
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  console.log('Stage 1 baseline: ' + output);
}
