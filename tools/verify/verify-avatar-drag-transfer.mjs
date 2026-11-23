// SPDX-License-Identifier: GPL-3.0-only
/** Real Electron drag IPC with hidden windows and no physical pointer input. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime', 'avatar-drag-transfer-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `
import { app } from 'electron';
app.on('browser-window-created', (_, window) => {
  let shown = false;
  window.isVisible = () => shown;
  window.show = window.showInactive = () => {
    if (!shown) { shown = true; window.emit('show'); }
  };
  window.hide = () => {
    if (shown) { shown = false; window.emit('hide'); }
  };
  window.focus = () => {};
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);

const server = createServer((_request, response) => response.end('{"data":[]}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
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
const companionUrl = 'capri://desktop/index.html';
const overlayUrl = 'capri://desktop/avatar-detach.html';

function artworkPoint({ selector, hit }) {
  const image = document.querySelector(selector);
  const rect = image.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  for (let v = 0.45; v <= 0.65; v += 0.01) {
    for (let u = 0.4; u <= 0.6; u += 0.01) {
      const x = Math.round(rect.x + u * rect.width),
        y = Math.round(rect.y + v * rect.height);
      if (
        hit &&
        !document.getElementById('sprite-region').contains(document.elementFromPoint(x, y))
      )
        continue;
      const pixels = ctx.getImageData(u * canvas.width - 14, v * canvas.height - 14, 28, 28).data;
      if (!pixels.some((value, index) => index % 4 === 3 && value < 230)) return { x, y };
    }
  }
  throw new Error('No opaque drag point on the test sprite');
}

let app;
try {
  app = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
  });
  const companion = await app.firstWindow();
  await companion.emulateMedia({ reducedMotion: 'reduce' });
  await companion.waitForFunction(
    () =>
      document.body.dataset.phase === 'ready' && !document.getElementById('avatar-detach').disabled,
  );
  await app.evaluate(
    ({ BrowserWindow }, url) =>
      BrowserWindow.getAllWindows()
        .find((view) => view.webContents.getURL() === url)
        .showInactive(),
    companionUrl,
  );
  const errors = [];
  companion.on('pageerror', (error) => errors.push(error.message));
  const drag = async (y) => {
    const point = await companion.evaluate(artworkPoint, { selector: '#sprite', hit: true });
    await companion.mouse.move(point.x, point.y);
    await companion.mouse.down();
    await companion.mouse.move(point.x, typeof y === 'function' ? y(point) : y, { steps: 6 });
    await companion.waitForFunction(
      () => document.getElementById('sprite-region').dataset.dragging === 'true',
    );
    await companion.mouse.up();
    await companion.waitForFunction(
      () => document.getElementById('sprite-region').dataset.dragging === 'false',
    );
  };
  const layout = () =>
    companion.evaluate(async () => (await window.capri.bootstrap()).avatarLayout);
  await companion.evaluate(async () => {
    const { companion } = await window.capri.bootstrap();
    await window.capri.setCompanionSettings({
      ...companion,
      avatarDragTether: true,
      avatarDragTetherIntensity: 70,
      avatarDragTetherDeadZone: 90,
    });
  });
  // A real framed drag must keep the music drawing, rigid motion and notes.
  // Feed only a detector receipt; never open system audio or a microphone.
  await companion.emulateMedia({ reducedMotion: 'no-preference' });
  const emitMusic = (enabled) =>
    app.evaluate(
      ({ BrowserWindow }, { url, enabled }) => {
        BrowserWindow.getAllWindows()
          .find((view) => view.webContents.getURL() === url)
          .webContents.send('capri:event', {
            type: 'music.status',
            enabled,
            hearingMusic: enabled,
            phase: enabled ? 'listening' : 'off',
            supported: true,
            energy: 0.75,
            tempo: 120,
            tempoConfidence: 1,
            settings: { enabled: true, notes: true, motion: true, autoBpm: true },
          });
      },
      { url: companionUrl, enabled },
    );
  await emitMusic(true);
  await companion.waitForFunction(() => {
    const notes = [...document.querySelectorAll('#avatar-viewport canvas')].find(
      (canvas) => canvas.style.zIndex === '14',
    );
    return document.getElementById('sprite').dataset.frame === 'music-floor' && !notes?.hidden;
  });
  await companion.evaluate(async () => {
    const sprite = document.getElementById('sprite');
    const notes = [...document.querySelectorAll('#avatar-viewport canvas')].find(
      (canvas) => canvas.style.zIndex === '14',
    );
    const trace = (window.musicDragTrace = { frames: [], notesHidden: false, angles: [] });
    trace.observer = new MutationObserver(() => {
      trace.frames.push(sprite.dataset.frame);
      trace.notesHidden ||= notes.hidden;
    });
    trace.observer.observe(sprite, { attributes: true, attributeFilter: ['data-frame'] });
    trace.observer.observe(notes, { attributes: true, attributeFilter: ['hidden'] });
    const { MusicPoseLayer } = await import('./music-animation.mjs');
    const image = MusicPoseLayer.prototype.image;
    MusicPoseLayer.prototype.image = function (source, state) {
      if (state?.active) trace.angles.push(state.angle);
      return image.call(this, source, state);
    };
    trace.restore = () => {
      trace.observer.disconnect();
      MusicPoseLayer.prototype.image = image;
    };
  });
  const musicPoint = await companion.evaluate(artworkPoint, { selector: '#sprite', hit: true });
  await companion.mouse.move(musicPoint.x, musicPoint.y);
  await companion.mouse.down();
  for (const [dx, dy] of [
    [12, -8],
    [24, -16],
    [10, -25],
  ]) {
    await companion.mouse.move(musicPoint.x + dx, musicPoint.y + dy, { steps: 5 });
    await companion.waitForTimeout(140);
  }
  await companion.waitForFunction(
    () => document.getElementById('sprite-region').dataset.dragging === 'true',
  );
  await companion.waitForTimeout(650);
  await companion.screenshot({ path: path.join(folder, 'framed-music-drag.png') });
  await companion.mouse.up();
  await companion.waitForTimeout(180);
  const handlePoint = await companion.locator('#handle').evaluate((handle) => {
    const box = handle.getBoundingClientRect();
    for (let x = box.left + 4; x < box.right; x += 5) {
      const y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (handle.contains(hit) && !hit.closest('button')) return { x, y };
    }
    throw new Error('No unoccupied header drag target');
  });
  await companion.mouse.move(handlePoint.x, handlePoint.y);
  await companion.mouse.down();
  await companion.waitForTimeout(400);
  await companion.mouse.up();
  await companion.waitForTimeout(120);
  const musicDrag = await companion.evaluate(() => {
    const trace = window.musicDragTrace;
    trace.restore();
    delete window.musicDragTrace;
    return {
      frames: [...trace.frames, document.getElementById('sprite').dataset.frame],
      notesHidden: trace.notesHidden,
      angles: trace.angles,
      attached: document.body.dataset.avatarDetach,
    };
  });
  assert(
    musicDrag.frames.every((frame) => frame === 'music-floor'),
    'Framed drag changed the music pose',
  );
  assert.equal(musicDrag.notesHidden, false, 'Framed drag hid the music notes');
  assert(new Set(musicDrag.angles).size > 2, 'Music body motion stopped during framed drag');
  assert.equal(musicDrag.attached, 'attached');
  writeFileSync(
    path.join(folder, 'music-drag.json'),
    JSON.stringify({ passed: true, ...musicDrag }),
  );
  await emitMusic(false);
  await companion.emulateMedia({ reducedMotion: 'reduce' });
  await companion.waitForFunction(
    () => document.getElementById('sprite').dataset.frame !== 'music-floor',
  );
  await companion.evaluate(() => window.capri.windowAction('reset-avatar'));
  console.log(
    'PASS framed music pose, moving notes and body rhythm survive hold, pan and release.',
  );
  const before = await layout();
  await drag((point) => point.y - 20);
  assert.ok((await layout()).y < before.y, 'The dead zone does not block panning inside the frame');
  await drag(-8);
  assert.ok((await layout()).y < before.y);
  assert.equal(await companion.locator('body').getAttribute('data-avatar-detach'), 'attached');
  assert.equal(
    app.windows().some((view) => view.url() === overlayUrl),
    false,
  );

  await companion.evaluate(() => window.capri.windowAction('reset-avatar'));
  await companion.waitForFunction(
    async () => (await window.capri.bootstrap()).avatarLayout.y === 1,
  );
  const opaque = await companion.evaluate(artworkPoint, { selector: '#sprite', hit: true });
  const nearEdge = await companion.evaluate((point) => {
    const image = document.getElementById('sprite');
    const rect = image.getBoundingClientRect();
    const u = (point.x - rect.x) / rect.width;
    const v = (point.y - rect.y) / rect.height;
    // Preserve a real opaque artwork point, but place its validated hit region
    // near the content edge so a 60-DIP vector crosses the native 24-DIP margin.
    return {
      frameId: image.dataset.frame,
      sprite: { x: 0, y: 0, width: 100, height: 30 / v },
      point: { x: u * 100, y: 30 },
    };
  }, opaque);
  await companion.evaluate(() => {
    window.verificationDragPhases = [];
    window.capri.onEvent((event) => {
      if (event.type === 'avatar.detach') window.verificationDragPhases.push(event.phase);
    });
  });
  const releaseNearEdge = (distance) =>
    companion.evaluate(
      async ({ start, distance }) => {
        if (!(await window.capri.startAvatarDrag(start))) return false;
        return window.capri.endAvatarDrag({
          click: false,
          drop: { x: start.point.x, y: start.point.y - distance },
        });
      },
      { start: nearEdge, distance },
    );
  for (const distance of [60, 90]) {
    assert.equal(await releaseNearEdge(distance), true);
    assert.equal(await companion.locator('body').getAttribute('data-avatar-detach'), 'attached');
    assert.equal(
      app.windows().some((view) => view.url() === overlayUrl),
      false,
      `A ${distance}-DIP release must not create a teleport/lightning layer for a 90-DIP dead zone`,
    );
    assert.deepEqual(await companion.evaluate(() => window.verificationDragPhases), []);
  }
  assert.equal(await releaseNearEdge(91), true);
  await companion.waitForFunction(() => document.body.dataset.avatarDetach === 'detached');
  assert.deepEqual(await companion.evaluate(() => window.verificationDragPhases), [
    'leaving',
    'detached',
  ]);
  const overlay = app.windows().find((view) => view.url() === overlayUrl);
  assert.ok(overlay);
  await overlay.waitForSelector('#parked-avatar:not([hidden])');
  const grab = () => overlay.evaluate(artworkPoint, { selector: '#parked-avatar img', hit: false });
  const target = await companion.locator('.composer').evaluate((composer) => {
    const rect = composer.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.7, y: rect.top + rect.height / 2 };
  });
  const dropDetached = (start, target) =>
    app.evaluate(
      ({ BrowserWindow }, { companionUrl, overlayUrl, start, target }) => {
        const views = BrowserWindow.getAllWindows();
        const owner = views
          .find((view) => view.webContents.getURL() === companionUrl)
          .getContentBounds();
        const overlay = views.find((view) => view.webContents.getURL() === overlayUrl);
        const area = overlay.getBounds();
        const farSide = owner.x + owner.width / 2 < area.x + area.width / 2 ? 0.75 : 0.25;
        const globalX = target ? owner.x + target.x : Math.round(area.x + area.width * farSide);
        const globalY = target ? owner.y + target.y : area.y + area.height - 2;
        overlay.webContents.emit(
          'before-mouse-event',
          {},
          { ...start, type: 'mouseDown', button: 'left' },
        );
        overlay.webContents.emit(
          'before-mouse-event',
          {},
          {
            x: globalX - area.x,
            y: globalY - area.y,
            globalX,
            globalY,
            type: 'mouseUp',
            button: 'left',
          },
        );
      },
      { companionUrl, overlayUrl, start, target },
    );
  await dropDetached(await grab(), null);
  const seated = overlay.locator('#parked-avatar[data-pose-frame="pose-sit-floor"]');
  await seated.waitFor();
  assert.ok(
    await seated.locator('img').evaluate((sprite) => {
      const { top, height } = sprite.getBoundingClientRect();
      return Math.abs(top + (height * 1167) / 1254 - innerHeight) <= 2;
    }),
    'The seated sprite rests on the bottom edge of the usable display',
  );
  await dropDetached(await grab(), target);
  await companion.waitForFunction(() => document.body.dataset.avatarDetach === 'attached');
  await companion.waitForFunction(() => document.body.dataset.presence === 'portrait');
  assert.equal(
    app.windows().some((view) => view.url() === overlayUrl),
    false,
  );
  assert.notEqual((await layout()).x, before.x);
  assert.deepEqual(errors, []);
  console.log(
    'PASS framed panning, configured 90-DIP drag dead zone (60/90 blocked, 91 teleports), floor seating and drag back onto the compact dock.',
  );
  if (process.argv.includes('--motion')) {
    const newPage = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const view = new BrowserWindow({
        show: false,
        x: 60,
        y: 60,
        width: 960,
        height: 600,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
      });
      await view.loadURL(url);
      BrowserWindow.prototype.showInactive.call(view);
    }, overlayUrl);
    const motionView = await newPage;
    await motionView.emulateMedia({ reducedMotion: 'no-preference' });
    await motionView.waitForFunction(() => !document.hidden);
    const motion = await motionView.evaluate(async () => {
      const canvas = document.getElementById('teleport-effect');
      const context = canvas.getContext('2d');
      const clear = context.clearRect.bind(context);
      const ticks = [];
      let surface = 0;
      context.clearRect = (...bounds) => {
        ticks.push(performance.now());
        surface = Math.max(surface, bounds[2] * bounds[3]);
        clear(...bounds);
      };
      const prepared = await window.capriAvatarDetach.prepare({
        from: { x: 110, y: 300, scale: 105 },
        to: { x: 410, y: 350, scale: 105 },
        seed: 74,
        spriteUrl: 'capri://desktop/sprites/neutral.png',
      });
      if (!prepared || !(await window.capriAvatarDetach.play())) throw new Error('Flight failed');
      const reply = document.getElementById('avatar-reply');
      const arrow = document.getElementById('avatar-reply-toggle');
      window.capriAvatarDetach.setReply({ text: 'Test detached reply', turnId: 'motion-test' });
      window.capriAvatarDetach.toggleReply();
      const collapsed = reply.hidden && arrow.hidden;
      window.capriAvatarDetach.setReplyNear(true);
      const revealed = !arrow.hidden && arrow.getAttribute('aria-label') === 'Show reply';
      window.capriAvatarDetach.toggleReply();
      return {
        paints: ticks.length,
        elapsed: ticks.at(-1) - ticks[0],
        surface,
        screen: innerWidth * innerHeight,
        replyReopened: collapsed && revealed && !reply.hidden,
      };
    });
    const paintsPerSecond = ((motion.paints - 1) * 1000) / motion.elapsed;
    assert.ok(paintsPerSecond > 40, `Expected a refresh-rate flight, got ${paintsPerSecond}`);
    assert.ok(motion.surface < motion.screen / 2);
    assert.equal(motion.replyReopened, true);
    console.log(JSON.stringify({ ...motion, paintsPerSecond }));
  }
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
