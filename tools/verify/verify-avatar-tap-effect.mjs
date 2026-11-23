// SPDX-License-Identifier: GPL-3.0-only
/** Real Electron click/IPC parity, with isolated state and no models, audio or owner data. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime', 'desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'avatar-tap-effect-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `
import { app } from 'electron';
app.on('browser-window-created', (_, window) => {
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
let unexpectedRequests = 0;
const server = createServer((request, response) => {
  if (request.url !== '/v1/models') unexpectedRequests++;
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
const companionUrl = 'capri://desktop/index.html';
const overlayUrl = 'capri://desktop/avatar-detach.html';
const colors = {
  affectionate: 'rgb(255, 143, 174)',
  curious: 'rgb(143, 245, 255)',
  neutral: 'rgb(217, 255, 150)',
  boundary: 'rgb(255, 0, 61)',
};
const polygon =
  'polygon(50% 0px, 60% 35%, 100% 50%, 65% 60%, 50% 100%, 37% 62%, ' +
  '0px 50%, 35% 40%, 50% 0px, 50% 36%, 42% 48%, 50% 61%, 60% 51%, 50% 36%)';

async function bodyPoint(page, attached) {
  return page.evaluate(async (attached) => {
    const { avatarBodyPartAt } = await import('../avatar-body-regions.mjs');
    const { CRT_CURVATURE, screenSample } = await import('./screen-geometry.mjs');
    const image = document.querySelector(attached ? '#sprite' : '#parked-avatar img');
    const rect = image.getBoundingClientRect();
    let lens;
    if (attached && document.body.dataset.crt === 'webgl') {
      const frame = document.getElementById('portrait-panel').getBoundingClientRect();
      lens = {
        x: frame.x + 12,
        y: frame.y + 14,
        width: frame.width - 24,
        height: frame.height - 44,
        curve: CRT_CURVATURE,
      };
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let v = 0.4; v < 0.7; v += 0.008) {
      for (let u = 0.3; u < 0.7; u += 0.008) {
        const point = {
          x: Math.round(rect.x + u * rect.width),
          y: Math.round(rect.y + v * rect.height),
        };
        if (
          attached &&
          !document
            .getElementById('sprite-region')
            .contains(document.elementFromPoint(point.x, point.y))
        )
          continue;
        const source = screenSample(point, lens);
        const sourceX = (source.x - rect.x) / rect.width;
        const sourceY = (source.y - rect.y) / rect.height;
        const at = (dx, dy) =>
          alpha[
            (Math.floor((sourceY + dy) * canvas.height) * canvas.width +
              Math.floor((sourceX + dx) * canvas.width)) *
              4 +
              3
          ];
        if (![-0.008, 0, 0.008].every((dy) => [-0.008, 0, 0.008].every((dx) => at(dx, dy) >= 230)))
          continue;
        if (avatarBodyPartAt(sourceX, sourceY, () => true) === 'torso') return point;
      }
    }
    throw new Error('No opaque torso point in the fixture avatar');
  }, attached);
}

async function observeStars(page, hostSelector) {
  await page.evaluate((hostSelector) => {
    const host = document.querySelector(hostSelector);
    const fixture = (window.tapEffectFixture = { stars: [], taps: [] });
    fixture.unsubscribe = window.capri?.onEvent((event) => {
      if (event.type === 'avatar.tap') fixture.taps.push(event);
    });
    fixture.measure = (star) => {
      const style = getComputedStyle(star);
      const rect = star.getBoundingClientRect();
      const box = host.getBoundingClientRect();
      return {
        tag: star.tagName,
        tone: star.dataset.tone,
        width: parseFloat(style.width),
        height: parseFloat(style.height),
        color: style.backgroundColor,
        clipPath: style.clipPath,
        pointerEvents: style.pointerEvents,
        translate: style.translate,
        animation: style.animationName,
        duration: style.animationDuration,
        easing: style.animationTimingFunction,
        left: parseFloat(style.left),
        top: parseFloat(style.top),
        hostX: box.x,
        hostY: box.y,
        centerX: rect.x + rect.width / 2,
        centerY: rect.y + rect.height / 2,
        visible: rect.width > 0 && rect.height > 0 && Number(style.opacity) > 0,
        hidden: star.getAttribute('aria-hidden'),
      };
    };
    fixture.observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element) || !node.matches('.avatar-tap-spark')) continue;
          // Freeze only the animation clock, preserving the production shape, colors and layout.
          getComputedStyle(node).animationName;
          for (const animation of node.getAnimations()) {
            animation.pause();
            animation.currentTime = 100;
          }
          fixture.stars.push(fixture.measure(node));
        }
    });
    fixture.observer.observe(host, { childList: true });
  }, hostSelector);
}

function assertStar(star, count, tone) {
  assert.equal(star.tag, 'SPAN');
  assert.equal(star.width, Math.min(56, 24 + count * 4));
  assert.equal(star.height, star.width);
  assert.equal(star.color, colors[tone]);
  assert.equal(star.clipPath, polygon);
  assert.equal(star.pointerEvents, 'none');
  assert.equal(star.translate, '-50% -50%');
  assert.equal(star.duration, '0.23s');
  assert.equal(star.easing, 'steps(4)');
  assert.equal(star.hidden, 'true');
  assert.ok(star.visible);
}

function assertPlacement(star, point) {
  for (const [actual, expected] of [
    [star.left, point.x - star.hostX],
    [star.top, point.y - star.hostY],
    [star.centerX, point.x],
    [star.centerY, point.y],
  ])
    assert.ok(Math.abs(actual - expected) < 0.1, `${actual} should be centered at ${expected}`);
}

async function finishStar(page) {
  await page.evaluate(() => {
    for (const star of document.querySelectorAll('.avatar-tap-spark'))
      for (const animation of star.getAnimations()) animation.play();
  });
  await page.locator('.avatar-tap-spark').waitFor({ state: 'detached', timeout: 1500 });
}

async function helperMatrix(page, hostSelector) {
  return page.evaluate(
    async ({ hostSelector, tones }) => {
      const { showAvatarTapEffect } = await import('./avatar-tap-effect.mjs');
      const host = document.querySelector(hostSelector);
      const fixture = window.tapEffectFixture;
      fixture.observer.disconnect();
      const samples = [];
      let replaced = null;
      for (const tone of tones)
        for (const count of [1, 2, 8, 1000]) {
          const star = showAvatarTapEffect(host, { x: 83, y: 107, count, tone });
          getComputedStyle(star).animationName;
          for (const animation of star.getAnimations()) {
            animation.pause();
            animation.currentTime = 100;
          }
          if (replaced?.isConnected)
            throw new Error('A repeated pulse left the previous star attached');
          if (host.querySelectorAll('.avatar-tap-spark').length !== 1)
            throw new Error('A repeated pulse created more than one star');
          samples.push({ count, tone, ...fixture.measure(star) });
          replaced = star;
        }
      for (const coordinates of [
        { x: NaN, y: 0 },
        { x: 0, y: Infinity },
        { x: '1', y: 1 },
      ])
        if (showAvatarTapEffect(host, coordinates) !== null)
          throw new Error('Invalid coordinates created a star');
      if (!replaced.isConnected) throw new Error('Invalid coordinates replaced the valid pulse');
      replaced.remove();
      return samples;
    },
    { hostSelector, tones: Object.keys(colors) },
  );
}

let app;
try {
  initialize(rt);
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await app.evaluate(({ BrowserWindow }, url) => {
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL() === url)
      .showInactive();
  }, companionUrl);
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(() => {
    const image = document.getElementById('sprite');
    return (
      document.body.dataset.presence === 'portrait' &&
      image.complete &&
      image.naturalWidth &&
      parseFloat(document.body.style.getPropertyValue('--reveal')) >= 0.99
    );
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeStars(page, '#avatar-viewport');
  const homePoint = await bodyPoint(page, true);
  await page.mouse.click(homePoint.x, homePoint.y);
  await page.waitForFunction(() => window.tapEffectFixture.stars.length === 1);
  const home = await page.evaluate(() => ({
    star: window.tapEffectFixture.stars[0],
    tap: window.tapEffectFixture.taps.at(-1),
  }));
  assert.equal(home.tap.part, 'torso');
  assert.equal(home.tap.pulse, true);
  assertStar(home.star, home.tap.count, home.tap.tone);
  assertPlacement(home.star, homePoint);
  await page.screenshot({ path: path.join(folder, 'framed-star.png') });
  await finishStar(page);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#avatar-detach').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
  const overlay = app.windows().find((view) => view.url() === overlayUrl);
  assert.ok(overlay);
  overlay.on('pageerror', (error) => errors.push(error.message));
  await overlay.waitForFunction(() => {
    const image = document.querySelector('#parked-avatar img');
    return (
      image?.complete && image.naturalWidth && !document.getElementById('parked-avatar').hidden
    );
  });
  await overlay.emulateMedia({ reducedMotion: 'no-preference' });
  await observeStars(overlay, 'body');
  const detachedPoint = await bodyPoint(overlay, false);
  await app.evaluate(
    ({ BrowserWindow }, { url, point }) => {
      const contents = BrowserWindow.getAllWindows().find(
        (view) => view.webContents.getURL() === url,
      ).webContents;
      // Native desktop picking is click-through; deliver its real registered callbacks in the fixture.
      contents.emit('before-mouse-event', {}, { ...point, type: 'mouseDown', button: 'left' });
      contents.emit('before-mouse-event', {}, { ...point, type: 'mouseUp', button: 'left' });
    },
    { url: overlayUrl, point: detachedPoint },
  );
  await overlay.waitForFunction(() => window.tapEffectFixture.stars.length === 1);
  const detached = await overlay.evaluate(() => window.tapEffectFixture.stars[0]);
  const detachedTap = await page.evaluate(() => window.tapEffectFixture.taps.at(-1));
  assert.equal(detachedTap.part, 'torso');
  assert.equal(detachedTap.pulse, false);
  assertStar(detached, detachedTap.count, detachedTap.tone);
  assertPlacement(detached, detachedPoint);
  assert.equal(detached.animation, home.star.animation);
  assert.equal(detached.clipPath, home.star.clipPath);
  assert.equal(detached.color, home.star.color);
  await overlay.screenshot({ path: path.join(folder, 'detached-star.png') });
  await finishStar(overlay);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const [homeSamples, detachedSamples] = await Promise.all([
    helperMatrix(page, '#avatar-viewport'),
    helperMatrix(overlay, 'body'),
  ]);
  for (const samples of [homeSamples, detachedSamples])
    for (const sample of samples) assertStar(sample, sample.count, sample.tone);
  const appearance = ({
    width,
    height,
    color,
    clipPath,
    animation,
    duration,
    easing,
    translate,
    pointerEvents,
  }) => ({ width, height, color, clipPath, animation, duration, easing, translate, pointerEvents });
  assert.deepEqual(homeSamples.map(appearance), detachedSamples.map(appearance));

  await Promise.all(
    [page, overlay].map(async (view) => {
      await view.emulateMedia({ reducedMotion: 'reduce' });
      const motion = await view.evaluate(
        async (hostSelector) => {
          const { showAvatarTapEffect } = await import('./avatar-tap-effect.mjs');
          const star = showAvatarTapEffect(document.querySelector(hostSelector), {
            x: 83,
            y: 107,
            count: 1,
            tone: 'neutral',
          });
          return {
            name: getComputedStyle(star).animationName,
            duration: getComputedStyle(star).animationDuration,
            frames: star.getAnimations()[0].effect.getKeyframes(),
          };
        },
        view === page ? '#avatar-viewport' : 'body',
      );
      assert.equal(motion.name, 'avatar-tap-static');
      assert.equal(motion.duration, '0.23s');
      assert.ok(motion.frames.every((frame) => frame.scale === undefined));
      await view.locator('.avatar-tap-spark').waitFor({ state: 'detached', timeout: 1500 });
    }),
  );
  assert.deepEqual(errors, []);
  assert.equal(unexpectedRequests, 0, 'The visual fixture never requested model inference');
  console.log(
    `PASS framed click/IPC and native detached star parity; four tones, capped sizes, replacement, positioning, reduced motion and cleanup. Screenshots: ${folder}`,
  );
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
