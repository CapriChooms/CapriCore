// SPDX-License-Identifier: GPL-3.0-only
// Owned-window instrumentation only: no desktop capture, cursor injection, or model requests.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { settingsView } from './settings-view.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const option = (name) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const duration = Math.max(2500, Math.min(12000, Number(option('duration')) || 5000));
const statesOnly = process.argv.includes('--perch-states-only');
const parent = path.join(root, '.runtime/perch-follow-motion');
mkdirSync(parent, { recursive: true });
const reportDirectory = mkdtempSync(path.join(parent, 'run-'));
const baselineMetadata = path.join(parent, 'baseline.json');
const baseline =
  option('baseline') ??
  (existsSync(baselineMetadata) ? JSON.parse(readFileSync(baselineMetadata, 'utf8')).folder : null);
const variants = [
  ...(baseline && !statesOnly ? [{ label: 'baseline', root: path.resolve(baseline) }] : []),
  { label: 'current', root: path.resolve(option('current') ?? root) },
];
const urls = {
  owner: 'capri://desktop/index.html',
  settings: 'capri://desktop/settings.html',
  avatar: 'capri://desktop/avatar-detach.html',
  composer: 'capri://desktop/avatar-composer.html',
};

const percentile = (values, fraction) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.floor(values.length * fraction))
      ]
    : null;
const round = (value) => (value === null ? null : Math.round(value * 100) / 100);
function changes(samples) {
  return samples.filter(
    (sample, index) =>
      !index || Math.hypot(sample.x - samples[index - 1].x, sample.y - samples[index - 1].y) > 0.35,
  );
}
function cadence(samples, elapsed) {
  const moved = changes(samples);
  const intervals = moved.slice(1).map((sample, index) => sample.at - moved[index].at);
  return {
    frames: samples.length,
    changedFrames: moved.length,
    updatesPerSecond: round((Math.max(0, moved.length - 1) * 1000) / elapsed),
    medianIntervalMs: round(percentile(intervals, 0.5)),
    p95IntervalMs: round(percentile(intervals, 0.95)),
    maximumIntervalMs: round(Math.max(0, ...intervals)),
  };
}
function nearest(samples, at) {
  let low = 0,
    high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].at < at) low = middle + 1;
    else high = middle;
  }
  if (low && Math.abs(samples[low - 1].at - at) < Math.abs(samples[low].at - at)) low--;
  return samples[low];
}
function lag(samples, target) {
  if (!samples.length || !target.length) return { lagMs: null, errorDip: null, p95ErrorDip: null };
  let best;
  for (let delay = 0; delay <= 500; delay += 5) {
    const errors = samples
      .filter((sample) => sample.at > target[0].at + 600 && sample.at < target.at(-1).at - 50)
      .map((sample) => {
        const point = nearest(target, sample.at - delay);
        return Math.hypot(sample.x - point.x, sample.y - point.y);
      });
    if (!errors.length) continue;
    const mean = errors.reduce((sum, value) => sum + value * value, 0) / errors.length;
    if (!best || mean < best.mean) best = { mean, delay, p95: percentile(errors, 0.95) };
  }
  return {
    lagMs: best?.delay ?? null,
    errorDip: best ? round(Math.sqrt(best.mean)) : null,
    p95ErrorDip: round(best?.p95 ?? null),
  };
}

async function runVariant(variant) {
  assert.ok(
    existsSync(path.join(variant.root, 'apps/desktop/main.mjs')),
    'Expected a Capri source root',
  );
  const fixtureParent = path.join(variant.root, '.runtime/desktop-verification');
  mkdirSync(fixtureParent, { recursive: true });
  const fixture = mkdtempSync(path.join(fixtureParent, 'perch-motion-'));
  mkdirSync(path.join(fixture, 'desktop'), { recursive: true });
  writeFileSync(
    path.join(fixture, 'desktop/presence.json'),
    JSON.stringify({ schemaVersion: 1, pinned: true }),
  );
  const entry = path.join(fixture, 'main.mjs');
  const source = (relative) =>
    JSON.stringify(pathToFileURL(path.join(variant.root, relative)).href);
  writeFileSync(
    entry,
    `
import { BrowserWindow } from 'electron';
import { AvatarDetach } from ${source('apps/desktop/main/avatar-detach.mjs')};
import { AvatarComposer } from ${source('apps/desktop/main/avatar-composer.mjs')};
const originalPointer = AvatarDetach.prototype.startPointer;
AvatarDetach.prototype.startPointer = function (...args) { globalThis.fixtureAvatar = this; return originalPointer.apply(this, args); };
// Keep the owned mini-input visible without moving the real cursor or changing saved preferences.
const originalSync = AvatarComposer.prototype.sync;
AvatarComposer.prototype.sync = function (value) { globalThis.fixtureComposer = this; return originalSync.call(this, { ...value, keepVisible: true }); };
await import(${source('apps/desktop/main.mjs')});
`,
  );
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models')
      return response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    if (request.method === 'POST') posts++;
    response.writeHead(503).end('Motion verification never uses a model.');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    ...process.env,
    CAPRI_DESKTOP_VERIFICATION_DIR: fixture,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [entry, '--verification'],
      env,
      timeout: 60000,
    });
    const owner = await app.firstWindow();
    owner.on('pageerror', (error) => errors.push(error.message));
    await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
        .showInactive();
    });
    await owner.waitForFunction(
      () => ['completed', 'skipped'].includes(document.body.dataset.startupIntro),
      null,
      { timeout: 20000 },
    );
    await settingsView(app, 'general');
    await app.evaluate(({ BrowserWindow, screen }) => {
      const settings = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
      );
      const area = screen.getDisplayMatching(settings.getBounds()).workArea;
      settings.setBounds({
        x: area.x + Math.round(area.width * 0.16),
        y: area.y + Math.round(area.height * 0.4),
        width: Math.min(620, area.width - 80),
        height: Math.min(480, Math.round(area.height * 0.5)),
      });
      const owner = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === 'capri://desktop/index.html',
      );
      owner.showInactive();
      owner.focus();
    });
    const target = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (item) => item.webContents.getURL() === 'capri://desktop/settings.html',
      );
      const handle = window.getNativeWindowHandle();
      return {
        windowId: String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()),
        processId: String(process.pid),
      };
    });
    const discovered = await callApplicationBridge(variant.root, {
      action: 'avatar_window',
      windowId: target.windowId,
      allowedWindowId: target.windowId,
      ignoreProcessId: target.processId,
    });
    assert.ok(discovered.windowId, 'The owned Settings HWND must pass native identity discovery');
    const before = (await owner.evaluate(() => window.capri.bootstrap())).messages.length;
    await owner.locator('#message').fill('Sit on the Settings window');
    await owner.waitForFunction(() => !document.getElementById('send').disabled);
    await owner.locator('#message').press('Enter');
    let completed;
    for (let retry = 0; retry < 300; retry++) {
      const state = await owner.evaluate(() => window.capri.bootstrap());
      if (
        !state.activeTurnId &&
        state.messages.length === before + 2 &&
        state.messages.at(-1).status === 'complete'
      ) {
        completed = state.messages.at(-1);
        break;
      }
      await owner.waitForTimeout(50);
    }
    assert.ok(completed, 'The deterministic owned-window command must complete');
    assert.match(completed.text, /perched on the window/u);
    await app.evaluate(() => {
      globalThis.fixtureAvatar.sendReply({ text: '', turnId: '' });
    });
    for (
      let retry = 0;
      retry < 100 && !app.windows().find((page) => page.url() === urls.composer);
      retry++
    )
      await owner.waitForTimeout(50);
    const overlay = app.windows().find((page) => page.url() === urls.avatar);
    const composer = app.windows().find((page) => page.url() === urls.composer);
    assert.ok(overlay && composer, 'Both real avatar and mini-input renderers must exist');
    overlay.on('pageerror', (error) => errors.push(error.message));
    composer.on('pageerror', (error) => errors.push(error.message));
    await overlay.waitForFunction(() => {
      const parked = document.getElementById('parked-avatar');
      const image = parked.querySelector('img');
      return !parked.hidden && image.complete && image.naturalWidth > 0;
    });
    await app.evaluate(() => globalThis.fixtureComposer.ready);
    await owner.waitForTimeout(1200);
    const perchChecks = {};
    if (variant.label === 'current') {
      const initial = await app.evaluate(({ BrowserWindow, screen }) => {
        const settings = BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
        );
        const bounds = settings.getBounds();
        const { workArea, scaleFactor } = screen.getDisplayMatching(bounds);
        const avatar = globalThis.fixtureAvatar;
        const original = {
          bounds,
          spriteUrl: avatar.session.spriteUrl,
          dock: avatar.session.dock,
          scaleFactor,
        };
        // The window stays partly visible while its existing seat goes offscreen.
        settings.setBounds({
          ...bounds,
          x: workArea.x + workArea.width - Math.round(bounds.width * 0.66) + 32,
        });
        return original;
      });
      const waitForState = async (visible) => {
        for (let retry = 0; retry < 150; retry++) {
          const state = await app.evaluate(() => {
            const avatar = globalThis.fixtureAvatar;
            return {
              detached: avatar.phase === 'detached',
              avatarVisible: avatar.overlay?.isVisible() ?? false,
              composerVisible: globalThis.fixtureComposer.window?.isVisible() ?? false,
              spriteUrl: avatar.session?.spriteUrl,
              dock: avatar.session?.dock,
            };
          });
          assert.equal(state.detached, true, 'A temporarily offscreen perch stays detached');
          assert.equal(
            state.spriteUrl,
            initial.spriteUrl,
            'Movement must not replace the seated pose',
          );
          assert.equal(state.dock, initial.dock, 'Movement must retain the same seat anchor');
          if (state.avatarVisible === visible && state.composerVisible === visible) return;
          await owner.waitForTimeout(20);
        }
        assert.fail(
          `The owned avatar and mini-input must become ${visible ? 'visible' : 'hidden'}`,
        );
      };
      await waitForState(false);
      perchChecks.offscreenHidesWithoutDroppingSeat = true;
      await app.evaluate(({ BrowserWindow }, bounds) => {
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL() === 'capri://desktop/settings.html')
          .setBounds(bounds);
      }, initial.bounds);
      await waitForState(true);
      perchChecks.returnRestoresSameSeatAndComposer = true;
      if (statesOnly) {
        if (option('expected-scale'))
          assert.equal(
            initial.scaleFactor,
            Number(option('expected-scale')),
            'Expected native display scale',
          );
        assert.equal(posts, 0, 'No inference request is allowed');
        assert.deepEqual(errors, []);
        return {
          label: variant.label,
          scaleFactor: initial.scaleFactor,
          perchChecks,
          modelRequests: posts,
          errors,
        };
      }
    }
    const frame = requireCapriAvatar(variant.root).desktopPoseFrames.find(
      (value) => value.id === 'pose-sit-edge',
    );
    const canvas = requireCapriAvatar(variant.root).canvas;
    await overlay.evaluate(
      ({ frame, canvas }) => {
        const samples = [],
          counters = { imageSourceChanges: 0, decodedImages: 0, imageGeometryReads: 0 };
        const image = document.querySelector('#parked-avatar img');
        const observer = new MutationObserver((records) => {
          counters.imageSourceChanges += records.filter(
            (record) => record.attributeName === 'src',
          ).length;
        });
        observer.observe(image, { attributes: true, attributeFilter: ['src'] });
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function (...args) {
          counters.decodedImages++;
          return decode.apply(this, args);
        };
        const geometry = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (...args) {
          if (this === image) counters.imageGeometryReads++;
          return geometry.apply(this, args);
        };
        const sample = () => {
          if (!globalThis.fixtureMotion.running) return;
          // The sampler's one read is excluded from production geometry counters.
          const rect = geometry.call(image);
          samples.push({
            at: performance.timeOrigin + performance.now(),
            x: window.screenX + rect.x + (rect.width * frame.anchor.x) / canvas.width,
            y: window.screenY + rect.y + (rect.height * frame.anchor.y) / canvas.height,
          });
          requestAnimationFrame(sample);
        };
        globalThis.fixtureMotion = {
          running: true,
          samples,
          counters,
          stop() {
            this.running = false;
            observer.disconnect();
            HTMLImageElement.prototype.decode = decode;
            Element.prototype.getBoundingClientRect = geometry;
            return { samples, counters };
          },
        };
        requestAnimationFrame(sample);
      },
      { frame, canvas },
    );
    await composer.evaluate(() => {
      const samples = [];
      globalThis.fixtureMotion = { running: true, samples };
      const sample = () => {
        if (!globalThis.fixtureMotion.running) return;
        samples.push({
          at: performance.timeOrigin + performance.now(),
          x: window.screenX,
          y: window.screenY,
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const native = await app.evaluate(async ({ app: electronApp, BrowserWindow }, duration) => {
      const settings = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
      );
      const avatar = globalThis.fixtureAvatar,
        composer = globalThis.fixtureComposer;
      const initial = settings.getBounds(),
        initialMini = composer.window.getBounds(),
        counters = {},
        originals = [];
      const readMiniBounds = composer.window.getBounds.bind(composer.window);
      const count = (object, method, label) => {
        if (typeof object?.[method] !== 'function') return;
        const original = object[method];
        object[method] = function (...args) {
          counters[label] = (counters[label] || 0) + 1;
          if (label === 'avatarExecuteJavaScript' && typeof args[0] === 'string') {
            counters.avatarScriptBytes =
              (counters.avatarScriptBytes || 0) + Buffer.byteLength(args[0]);
            const method = /capriAvatarDetach\.([a-zA-Z]+)/u.exec(args[0])?.[1];
            if (method) counters[`avatar.${method}`] = (counters[`avatar.${method}`] || 0) + 1;
          }
          return original.apply(this, args);
        };
        originals.push(() => {
          object[method] = original;
        });
      };
      for (const method of ['updateFrame', 'followFrame', 'queuePlacement', 'moveReplyGeometry'])
        count(avatar, method, method);
      count(composer, 'update', 'composerUpdate');
      count(composer.window, 'setBounds', 'composerSetBounds');
      count(composer.window, 'setPosition', 'composerSetPosition');
      count(composer.window, 'getBounds', 'composerGetBounds');
      count(composer.window, 'getPosition', 'composerGetPosition');
      count(avatar.overlay.webContents, 'executeJavaScript', 'avatarExecuteJavaScript');
      count(composer.window.webContents, 'send', 'composerStateIpc');
      const initialCpu = process.cpuUsage();
      electronApp.getAppMetrics();
      // Verification disables the real pointer watcher. Reproduce its 16 ms
      // scheduling using an owned constant coordinate, without reading or
      // moving the real cursor and without installing any native input hook.
      const originalScreen = avatar.screen;
      const fixedPointer = {
        x: avatar.session.area.x + avatar.session.area.width - 2,
        y: avatar.session.area.y + 2,
      };
      avatar.screen = new Proxy(originalScreen, {
        get(target, key) {
          if (key === 'getCursorScreenPoint') return () => fixedPointer;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const pointerTimer = setInterval(() => avatar.updatePointer(), 16);
      const start = performance.now(),
        startAt = Date.now(),
        target = [],
        host = [],
        mini = [];
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          const elapsed = performance.now() - start;
          if (elapsed >= duration) {
            clearInterval(timer);
            resolve();
            return;
          }
          settings.setPosition(
            initial.x + Math.round(80 * Math.sin((elapsed * Math.PI * 2) / 3000)),
            initial.y + Math.round(35 * (1 - Math.cos((elapsed * Math.PI * 2) / 3000))),
            false,
          );
          const at = Date.now(),
            bounds = settings.getBounds();
          target.push({ at, x: Math.round(bounds.x + bounds.width * 0.66), y: bounds.y });
          const point = avatar.desktopPoint;
          if (point) host.push({ at, x: point.x, y: point.y });
          if (composer.window?.isVisible()) {
            const value = readMiniBounds();
            mini.push({ at, x: value.x, y: value.y });
          }
          // Windows may quantize Node timers to ~15.6 ms. An 8 ms request keeps
          // the measured owned target near 60 Hz without changing OS resolution.
        }, 8);
      });
      clearInterval(pointerTimer);
      avatar.screen = originalScreen;
      const cpu = process.cpuUsage(initialCpu),
        metrics = electronApp
          .getAppMetrics()
          .map((value) => ({ type: value.type, percent: value.cpu.percentCPUUsage }));
      const elapsed = performance.now() - start;
      for (const restore of originals) restore();
      return {
        startAt,
        endAt: Date.now(),
        elapsed,
        target,
        host,
        mini,
        counters,
        cpu,
        metrics,
        initial,
        initialMini,
        visible: { avatar: avatar.overlay.isVisible(), composer: composer.window.isVisible() },
      };
    }, duration);
    const avatar = await overlay.evaluate(() => globalThis.fixtureMotion.stop());
    const mini = await composer.evaluate(() => {
      globalThis.fixtureMotion.running = false;
      return globalThis.fixtureMotion.samples;
    });
    const inRange = (samples) =>
      samples.filter(({ at }) => at >= native.startAt && at <= native.endAt);
    const avatarSamples = inRange(avatar.samples),
      composerSamples = inRange(mini);
    // Mini-input geometry has a stable pose-dependent offset from the perch anchor.
    const offset = {
      x: native.initialMini.x - Math.round(native.initial.x + native.initial.width * 0.66),
      y: native.initialMini.y - native.initial.y,
    };
    const miniTarget = native.target.map((sample) => ({
      at: sample.at,
      x: sample.x + offset.x,
      y: sample.y + offset.y,
    }));
    const spacingErrors = composerSamples.map((sample) => {
      const avatarPoint = nearest(avatarSamples, sample.at);
      return Math.hypot(sample.x - avatarPoint.x - offset.x, sample.y - avatarPoint.y - offset.y);
    });
    const result = {
      label: variant.label,
      durationMs: round(native.elapsed),
      target: cadence(native.target, native.elapsed),
      avatar: {
        ...cadence(avatarSamples, native.elapsed),
        ...lag(avatarSamples, native.target),
        ...avatar.counters,
      },
      composer: {
        ...cadence(composerSamples, native.elapsed),
        ...lag(composerSamples, miniTarget),
        medianSpacingErrorDip: round(percentile(spacingErrors, 0.5)),
        p95SpacingErrorDip: round(percentile(spacingErrors, 0.95)),
      },
      host: { ...cadence(native.host, native.elapsed), ...lag(native.host, native.target) },
      counters: native.counters,
      cpu: {
        mainCpuMs: round((native.cpu.user + native.cpu.system) / 1000),
        mainCpuMsPerTargetChange: round(
          (native.cpu.user + native.cpu.system) /
            (1000 * Math.max(1, changes(native.target).length - 1)),
        ),
        mainSingleCorePercent: round((native.cpu.user + native.cpu.system) / (native.elapsed * 10)),
        processPercentSamples: native.metrics.map(({ type, percent }) => ({
          type,
          percent: round(percent),
        })),
      },
      visible: native.visible,
      modelRequests: posts,
      errors,
      perchChecks,
    };
    result.motionChecks = {
      avatarKeepsUp: result.avatar.updatesPerSecond >= result.target.updatesPerSecond * 0.75,
      composerKeepsUp:
        result.composer.updatesPerSecond >= Math.min(25, result.target.updatesPerSecond * 0.6),
      noLongVisibleStalls: result.avatar.p95IntervalMs <= 80 && result.composer.p95IntervalMs <= 80,
      limitedFollowDelay: result.avatar.lagMs <= 80 && result.composer.lagMs <= 100,
      stableComposerSpacing: result.composer.p95SpacingErrorDip <= 15,
    };
    assert.ok(
      native.target.length >= duration / 45,
      'Owned target window animation must run regularly',
    );
    assert.ok(
      result.avatar.changedFrames > 10 && result.composer.changedFrames > 10,
      'Both visible surfaces must follow the owned window',
    );
    assert.deepEqual(native.visible, { avatar: true, composer: true });
    assert.equal(posts, 0, 'No inference request is allowed');
    assert.deepEqual(errors, []);
    writeFileSync(
      path.join(reportDirectory, `${variant.label}-samples.json`),
      JSON.stringify({ native, avatar: avatarSamples, composer: composerSamples }, null, 2),
    );
    return result;
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const report = {
  scope:
    'Actual isolated Capri main: owned Settings HWND -> detached avatar -> pinned mini-input. CPU is a local comparative observation, not a hardware-independent benchmark. This Settings test does not exercise the foreign-PID native window hook.',
  results: [],
};
try {
  for (const variant of variants) {
    const result = await runVariant(variant);
    report.results.push(result);
    console.log(JSON.stringify(result));
  }
  report.passed = report.results.every(
    (result) =>
      Object.values(result.motionChecks ?? {}).every(Boolean) &&
      Object.values(result.perchChecks ?? {}).every(Boolean),
  );
  assert.ok(
    report.passed,
    'Owned avatar/composer motion must meet the reported cadence, spacing, and latency checks',
  );
} finally {
  writeFileSync(path.join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Motion report: ${path.relative(root, path.join(reportDirectory, 'report.json'))}`);
}
