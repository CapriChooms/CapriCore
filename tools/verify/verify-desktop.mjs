import { saveSettings } from './settings-view.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { _electron as electron } from 'playwright-core';
import {
  root,
  settings,
  runtime,
  initialize,
  environment,
  stopManaged,
  chat as coreChat,
} from '../../packages/runtime/src/index.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
import { ensureDesktopIdentity } from '../../packages/runtime/src/host/desktop-identity.mjs';

const real = process.argv.includes('--real');
const routing = process.argv.includes('--routing');
const folderRoot = path.join(root, '.runtime/desktop-verification');
mkdirSync(folderRoot, { recursive: true });
const folder = mkdtempSync(path.join(folderRoot, real ? 'real-' : 'fixture-'));
const require = createRequire(import.meta.url);
const executablePath = process.argv.includes('--unbranded')
  ? require('electron')
  : await ensureDesktopIdentity(require('electron'));
const report = { timestamp: new Date().toISOString(), realModel: real, checks: [], folder };
const record = (name, detail = {}) => {
  report.checks.push({ name, passed: true, ...detail });
  console.log(`PASS ${name}`);
};
let application, server;
let fixtureAvailable = true;
let port = 18790;
const seen = [];
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));
const longReply =
  'Neon outside. A quiet corner in here. You do not have to fill every silence, you know. ' +
  'I can stay a while, watch the city with you, and pretend we have nowhere else to be. ' +
  'When you are ready, tell me what has been on your mind. No hurry, no countdown. ' +
  'Even Night City can wait five minutes for us.';

if (!real) {
  server = createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(fixtureAvailable ? 200 : 503, { 'content-type': 'application/json' });
      res.end(fixtureAvailable ? '{"data":[]}' : '{"error":"unavailable"}');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    seen.push({
      session: req.headers['x-openclaw-session-key'],
      thinking: req.headers['x-capri-thinking-once'],
      body: input,
    });
    const ownerText = input.messages.at(-1).content.split('\n\nDESKTOP STATE FOR THIS TURN', 1)[0];
    if (ownerText === 'server-error') {
      res.writeHead(503);
      res.end('private diagnostic data');
      return;
    }
    const slow = ownerText === 'slow';
    const captionTest = ownerText === 'subtitles';
    const requested = ownerText.match(/^avatar:([a-z0-9_-]+)$/)?.[1];
    const sprite =
      catalog.sprites.find((item) => item.id === requested) ??
      catalog.sprites.find((item) => item.id === (slow ? 'thinking' : 'happy'));
    const frame = `[avatar:${sprite.id}]`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const sendChunk = (content) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    sendChunk('[ava');
    const prefix = setTimeout(() => {
      sendChunk(frame.slice(4));
      sendChunk(
        captionTest ? '\n' + longReply.slice(0, 40) : slow ? '\nA partial reply.' : '\nHello. ',
      );
    }, 40);
    const timer = setTimeout(
      () => {
        res.end(
          `data: ${JSON.stringify({ choices: [{ delta: { content: captionTest ? longReply.slice(40) : slow ? 'Still going.' : '<img src=x onerror=alert(1)> — only text.' } }] })}\n\ndata: [DONE]\n\n`,
        );
      },
      slow ? 15000 : 1000,
    );
    res.on('close', () => {
      clearTimeout(prefix);
      clearTimeout(timer);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
}
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
  logPrefix: 'desktop-verification',
});
initialize(rt);

async function launch() {
  const env = {
    ...environment(rt),
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_ROUTER: routing ? '1' : '0',
    CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: real ? '0' : '1',
  };
  // Electron treats even an empty ELECTRON_RUN_AS_NODE as enabled.
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath,
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.process().stderr.on('data', (data) => {
    const text = data.toString();
    if (/Desktop startup failed|Core startup failed|Unable to load preload/i.test(text))
      console.error(text.trim());
  });
  const page = await application.firstWindow();
  assert.equal(
    path.basename(await application.evaluate(() => process.execPath)).toLowerCase(),
    path.basename(executablePath).toLowerCase(),
  );
  await page.waitForSelector('#message', { timeout: 20000 });
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 180000,
  });
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (win) => win.webContents.getURL() === 'capri://desktop/index.html',
    );
    win.webContents.setBackgroundThrottling(false);
    win.showInactive();
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(() => Boolean(document.querySelector('#sprite').dataset.avatar));
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    window.__avatarEvents = [];
    window.capri.onEvent((event) => {
      if (event.type === 'avatar.selection') window.__avatarEvents.push(event);
    });
  });
  return page;
}

async function send(page, text) {
  await page.locator('#message').fill(text);
  await page.locator('#send').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  await page.locator('#message').press('Enter');
  await page.waitForFunction(
    () => document.querySelectorAll('.message[data-role="user"]').length > 0,
  );
}

async function closeApplication() {
  if (!application) return;
  const current = application;
  application = null;
  let timer;
  try {
    await Promise.race([
      current.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Desktop verification did not exit')), 15000);
      }),
    ]);
  } catch {
    // Only the test GUI process is terminated; Gateway cleanup below always
    // uses its supported lifeline to release databases gracefully.
    current.process().kill();
  } finally {
    clearTimeout(timer);
  }
}

try {
  let page = await launch();
  const native = await application.evaluate(async ({ BrowserWindow, screen, app }) => {
    const win = BrowserWindow.getAllWindows().find(
        (win) => win.webContents.getURL() === 'capri://desktop/index.html',
      ),
      bounds = win.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const prefs = win.webContents.getLastWebPreferences();
    return {
      bounds,
      workArea,
      topmost: win.isAlwaysOnTop(),
      background: win.getBackgroundColor(),
      isolated: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      nodeIntegration: prefs.nodeIntegration,
      profile: app.getPath('userData'),
      argv: process.argv,
    };
  });
  assert.ok(native.isolated && native.sandbox && !native.nodeIntegration, JSON.stringify(native));
  if (!native.topmost && process.argv.includes('--allow-topmost-gap')) {
    report.limitations = [
      'Always-on-top is unavailable in this host session, also reproduced in a bare Electron window.',
    ];
  } else assert.ok(native.topmost, JSON.stringify(native));
  assert.ok(native.bounds.x >= native.workArea.x && native.bounds.y >= native.workArea.y);
  assert.ok(native.bounds.x + native.bounds.width <= native.workArea.x + native.workArea.width);
  assert.ok(native.bounds.y + native.bounds.height <= native.workArea.y + native.workArea.height);
  assert.ok(
    Math.abs(
      native.bounds.x + native.bounds.width + 16 - native.workArea.x - native.workArea.width,
    ) <= 1,
  );
  record('Native transparent corner window and isolated renderer', native);
  const isolation = await page.evaluate(async () => ({
    require: typeof window.require,
    process: typeof window.process,
    bootstrap: await window.capri.bootstrap(),
    loaded: document.querySelector('#sprite').naturalWidth,
  }));
  assert.equal(isolation.require, 'undefined');
  assert.equal(isolation.process, 'undefined');
  assert.equal(isolation.loaded, 1254);
  assert.ok(
    !JSON.stringify(isolation.bootstrap).includes(readFileSync(rt.tokenPath, 'utf8').trim()),
  );
  record('Sprite loaded and Gateway token stays outside renderer');
  const presentation = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      fontLoaded: [...document.fonts].some(
        (font) => font.family === 'Exo 2' && font.status === 'loaded',
      ),
      subtitleBackground: getComputedStyle(document.querySelector('#subtitle-stage'))
        .backgroundColor,
      historyHidden: document.querySelector('#history-panel').hidden,
      textPointerEvents: getComputedStyle(document.querySelector('#subtitle-frame')).pointerEvents,
    };
  });
  assert.ok(presentation.fontLoaded && presentation.historyHidden);
  assert.equal(presentation.subtitleBackground, 'rgba(0, 0, 0, 0)');
  assert.equal(presentation.textPointerEvents, 'none');
  record('Local cyberpunk font, framed subtitles and history hidden by default', presentation);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .close(),
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
        .isVisible(),
    ),
    false,
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  record('Closing the window hides it without terminating the companion');
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .hide(),
  );

  if (!real) {
    const initial = await page.locator('#sprite-region').boundingBox();
    const placement = () =>
      page.evaluate(async () => (await window.capri.bootstrap()).avatarLayout);
    const originalPlacement = await placement();
    assert.ok(Math.abs(initial.x + initial.width / 2 - native.bounds.width / 2) < 1);
    assert.ok(
      initial.width > 200 && initial.width < 430,
      'Full-body canvas fits the portrait before zooming',
    );
    const { start, gap } = await page.evaluate(async () => {
      const { CRT_CURVATURE, screenSample } = await import('./screen-geometry.mjs');
      const sprite = document.getElementById('sprite');
      await sprite.decode();
      const region = document.getElementById('sprite-region');
      const box = region.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      canvas.width = sprite.naturalWidth;
      canvas.height = sprite.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(sprite, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const portrait = document.getElementById('portrait-panel').getBoundingClientRect();
      const lens =
        document.body.dataset.crt === 'webgl'
          ? {
              x: portrait.x + 12,
              y: portrait.y + 14,
              width: portrait.width - 24,
              height: portrait.height - 44,
              curve: CRT_CURVATURE,
            }
          : null;
      const alpha = (point) => {
        const sample = screenSample(point, lens);
        const x = Math.floor(((sample.x - box.x) / box.width) * canvas.width);
        const y = Math.floor(((sample.y - box.y) / box.height) * canvas.height);
        return pixels[(y * canvas.width + x) * 4 + 3];
      };
      const pick = (opaque, desiredY) => {
        let best;
        for (let iy = 25; iy <= 70; iy++) {
          for (let ix = 20; ix <= 80; ix++) {
            const point = { x: box.x + (box.width * ix) / 100, y: box.y + (box.height * iy) / 100 };
            if (document.elementFromPoint(point.x, point.y) !== region) continue;
            const samples = [0, -2, 2].flatMap((dx) =>
              [0, -2, 2].map((dy) => alpha({ x: point.x + dx, y: point.y + dy })),
            );
            if (!samples.every((value) => (opaque ? value >= 240 : value === 0))) continue;
            const distance = Math.hypot(ix - 52, iy - desiredY);
            if (!best || distance < best.distance) best = { point, distance };
          }
        }
        return best?.point;
      };
      return { start: pick(true, 50), gap: pick(false, 36) };
    });
    assert.ok(gap && start, 'The test must reach transparent and opaque pixels in the same sprite');
    await page.mouse.move(gap.x, gap.y);
    await page.mouse.down();
    await page.mouse.move(gap.x - 25, gap.y - 50, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(await placement(), originalPlacement);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 25, start.y - 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(async (initial) => {
      const layout = (await window.capri.bootstrap()).avatarLayout;
      return layout.x < initial.x && layout.y < initial.y && layout.zoom === initial.zoom;
    }, originalPlacement);
    const moved = await page.locator('#sprite-region').boundingBox();
    assert.deepEqual(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
          .getBounds(),
      ),
      native.bounds,
    );
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(
      () => Number(document.querySelector('#sprite-region').dataset.zoom) > 1.15,
    );
    await page.evaluate(() => window.capri.windowAction('reset-avatar'));
    await page.waitForFunction(
      () => Number(document.querySelector('#sprite-region').dataset.zoom) === 1.15,
    );
    assert.deepEqual(await placement(), originalPlacement);
    assert.equal(
      await page.evaluate(() =>
        window.capri.setAvatarLayout({ x: Infinity, y: 0, zoom: 100 }).then(
          () => true,
          () => false,
        ),
      ),
      false,
    );
    record(
      'Capri starts centred and larger; only opaque pixels start dragging; wheel zoom and Settings reset stay independent of the window',
    );
  }

  if (real) {
    const code = `ORBIT-${randomBytes(3).toString('hex').toUpperCase()}`;
    const seeded = await coreChat(
      `Verification only. Our test code is ${code}. Do not write files or save long-term memory. Acknowledge briefly.`,
      { rt, channel: 'telegram' },
    );
    assert.ok(seeded.choices[0].message.content);
    await send(page, 'What is our test code? Reply with only the code. Do not write any files.');
    await page.waitForFunction(
      (expected) =>
        [
          ...document.querySelectorAll(
            '.message[data-role="assistant"][data-status="complete"] .message-text',
          ),
        ].some((element) => element.textContent.includes(expected)),
      code,
      { timeout: 180000 },
    );
    record('Real model replies through UI and shares Telegram-channel API context', {
      answer: await page
        .locator('.message[data-role="assistant"] .message-text')
        .last()
        .textContent(),
    });
    const reactions = [];
    for (const [text, expected] of [
      [
        'I finally got the job I have been dreaming of! I am so excited and wanted you to be the first to know. Reply naturally in at most two sentences. Do not write files.',
        'happy',
      ],
      [
        'I need to tell you something painful. My cat died this morning after fourteen years together, and the house feels horribly empty. Reply naturally in at most two sentences. Do not write files.',
        'concerned',
      ],
    ]) {
      const before = await page
        .locator('.message[data-role="assistant"][data-status="complete"]')
        .count();
      await send(page, text);
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
            .length > count,
        before,
        { timeout: 180000 },
      );
      await page.waitForFunction(
        (id) => document.querySelector('#sprite').dataset.avatar === id,
        expected,
        { timeout: 10000 },
      );
      const selection = await page.evaluate(
        (id) =>
          window.__avatarEvents.findLast(
            (event) => event.selection.id === id && event.source === 'model',
          ),
        expected,
      );
      assert.ok(selection, 'Expression must come from the model, not fallback');
      reactions.push({
        expression: expected,
        source: selection.source,
        answer: await page
          .locator('.message[data-role="assistant"] .message-text')
          .last()
          .textContent(),
      });
    }
    record('Real Qwen chooses joyful and empathetic faces from conversation context', {
      reactions,
    });
  } else {
    await send(page, routing ? 'Hey Capri, how are you?' : 'Hello');
    await page.waitForSelector('.message[data-role="assistant"][data-status="streaming"]', {
      state: 'attached',
    });
    await page.waitForFunction(() =>
      document
        .querySelector('.message[data-role="assistant"][data-status="streaming"] .message-text')
        ?.textContent.includes('Hello'),
    );
    assert.match(
      await page.locator('.message[data-role="assistant"] .message-text').last().textContent(),
      /Hello/,
    );
    await page.waitForSelector('.message[data-role="assistant"][data-status="complete"]', {
      state: 'attached',
    });
    assert.equal(await page.locator('.message img').count(), 0);
    assert.match(
      await page.locator('.message[data-role="assistant"] .message-text').last().textContent(),
      /<img src=x onerror=alert\(1\)>/,
    );
    assert.equal(seen[0].session, settings.sessionKey);
    assert.equal(seen[0].body.messages.length, 2);
    if (routing) {
      assert.equal(seen[0].thinking, 'off');
      record('Real prewarmed CPU router selects one-shot fast mode from Electron');
    }
    assert.match(seen[0].body.messages[0].content, /AVATAR CONTROL/);
    await page.waitForFunction(() => document.querySelector('#sprite').dataset.avatar === 'happy');
    assert.ok(!(await page.locator('#messages').textContent()).includes('[avatar:'));
    record('Incremental reply, shared session and HTML treated as literal text');
    // SignalFX deliberately pauses animations while a window is hidden. The
    // earlier native close/hide check must not pause the subsequent portrait check.
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
        .showInactive(),
    );
    for (const sprite of catalog.sprites) {
      const count = await page
        .locator('.message[data-role="assistant"][data-status="complete"]')
        .count();
      await send(page, `avatar:${sprite.id}`);
      await page.waitForFunction(
        (value) =>
          document.querySelector('#sprite').dataset.avatar === value.id &&
          document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
            .length > value.count,
        { id: sprite.id, count },
      );
      if (!sprite.animation) {
        try {
          await page.waitForFunction(
            (id) => document.querySelector('#sprite').dataset.frame === id,
            sprite.frameId,
            { timeout: 8000 },
          );
        } catch (error) {
          throw new Error(
            `Expression ${sprite.id}: ${JSON.stringify(await page.evaluate(() => ({ sprite: { ...document.querySelector('#sprite').dataset }, body: { ...document.body.dataset }, hidden: document.hidden, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, notice: document.querySelector('#notice').textContent })))}; ${error.message}`,
          );
        }
      }
      const frameId = await page.locator('#sprite').getAttribute('data-frame');
      assert.ok(catalog.portraitFrames.some((frame) => frame.id === frameId));
      assert.equal(
        await page.locator('#sprite').getAttribute('data-expression'),
        sprite.expression,
      );
    }
    record('All active facial expressions and reactions switch in the native companion', {
      expressions: catalog.sprites.map((sprite) => sprite.id),
    });
    const current = await page.evaluate(() => window.capri.bootstrap());
    assert.equal(
      await page.evaluate(
        (value) => window.capri.avatarReady({ ...value, id: 'unknown' }),
        current.avatar,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(
        (value) => window.capri.avatarReady({ ...value, revision: value.revision - 1 }),
        current.avatar,
      ),
      false,
    );
    for (const id of ['walk_left-1', 'walk_right-1', 'effect-heart', 'remote.png']) {
      assert.equal(
        await page.evaluate(
          ({ id, revision }) => window.capri.avatarFrameReady({ id, revision, sequence: 999999 }),
          { id, revision: current.avatar.revision },
        ),
        false,
      );
    }
    assert.equal(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = 'capri://desktop/sprites/not-approved.png';
          }),
      ),
      false,
    );
    record(
      'Renderer cannot commit invented sprites or stale revisions; unknown resources are blocked',
    );
    await send(page, 'slow');
    await page.waitForFunction(() =>
      document
        .querySelector('.message[data-role="assistant"][data-status="streaming"] .message-text')
        ?.textContent.includes('partial'),
    );
    await page.locator('#stop').focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('.message[data-role="assistant"][data-status="interrupted"]', {
      state: 'attached',
    });
    await page.waitForFunction(() => !document.querySelector('#send').hidden);
    const completedBeforeRecovery = await page
      .locator('.message[data-role="assistant"][data-status="complete"]')
      .count();
    await send(page, 'Recovered');
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
          .length > count,
      completedBeforeRecovery,
    );
    record('Stop releases the turn and the following reply succeeds');
    // A failed turn with a healthy Gateway must leave basic chat available.
    await page.evaluate((value) => window.capri.send(value), {
      id: randomUUID(),
      text: 'server-error',
    });
    assert.equal(await page.locator('body').getAttribute('data-phase'), 'ready');
    assert.equal(await page.locator('#reconnect').isVisible(), false);
    record('A recoverable turn failure does not mark the healthy core offline');
    fixtureAvailable = false;
    await send(page, 'server-error');
    await page.waitForSelector('#reconnect:not([hidden])');
    assert.ok(!(await page.locator('#notice').textContent()).includes('private diagnostic data'));
    fixtureAvailable = true;
    await page.locator('#reconnect').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'ready');
    record('Upstream failure is visible and reconnect restores availability');
    const beforeSubtitles = await page
      .locator('.message[data-role="assistant"][data-status="complete"]')
      .count();
    await send(page, 'subtitles');
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
          .length > count,
      beforeSubtitles,
    );
    await page.waitForSelector('#subtitle-controls:not([hidden])');
    assert.match(await page.locator('#subtitle-text').textContent(), /^Neon outside/);
    await page.locator('#subtitle-next').click();
    assert.equal(await page.locator('#subtitle-text').getAttribute('data-index'), '1');
    assert.equal(await page.locator('#subtitle-pause').count(), 0);
    await page.locator('#subtitle-previous').click();
    assert.equal(await page.locator('#subtitle-text').getAttribute('data-index'), '0');
    await page.locator('#history-toggle').click();
    assert.equal(await page.locator('#history-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(
      await page.locator('.message[data-role="assistant"] .message-text').last().textContent(),
      longReply,
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-panel').isVisible(), false);
    record(
      'Long replies play as readable cues, support pause/back and retain the complete history',
    );
    const originalBounds = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
        .getBounds(),
    );
    for (const [width, height] of [
      [460, 580],
      [320, 480],
      [320, 360],
    ]) {
      await application.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()
            .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
            .setBounds(size),
        { ...originalBounds, width, height },
      );
      await page
        .locator('#message')
        .fill('A draft\nwith several\nlines of text\nto continue later.');
      const layout = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return ['#handle', '#subtitle-text', '#process-graphs-hud', '.composer'].map((selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return {
            selector,
            top: box.top,
            bottom: box.bottom,
            right: box.right,
            height: innerHeight,
            width: innerWidth,
          };
        });
      });
      for (const item of layout)
        assert.ok(
          item.top >= 0 && item.bottom <= item.height + 1 && item.right <= item.width + 1,
          `Layout overflow: ${JSON.stringify(item)}`,
        );
      assert.notEqual(
        await page
          .locator('#avatar-viewport')
          .evaluate((element) => getComputedStyle(element).clipPath),
        'none',
      );
    }
    await page.locator('#message').fill('');
    await application.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
          .setBounds(bounds),
      originalBounds,
    );
    record('Subtitles and input stay on screen at compact sizes, including multiline drafts');
    const placement = { x: 0.47, y: 0.62, zoom: 1.3 };
    // Save through the public capability and deliver the same layout event
    // used by the native menu, without relying on a physical menu click.
    await page.evaluate((value) => window.capri.setAvatarLayout(value), placement);
    await application.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
        .webContents.send('capri:event', { type: 'avatar.layout', layout: value });
    }, placement);
    await page.waitForFunction(
      () => Number(document.querySelector('#sprite-region').dataset.zoom) === 1.3,
    );
    const placed = await page.locator('#sprite-region').boundingBox();
    await application.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
          .setPosition(bounds.x - 20, bounds.y - 15),
      originalBounds,
    );
    const afterWindowMove = await page.locator('#sprite-region').boundingBox();
    assert.ok(
      Math.abs(placed.x - afterWindowMove.x) < 1 && Math.abs(placed.y - afterWindowMove.y) < 1,
    );
    await application.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
          .setBounds(bounds),
      originalBounds,
    );
    record('Native window movement leaves Capri’s internal placement unchanged');
    // Capture actual UI against two test backdrops; runtime remains transparent.
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
        .showInactive(),
    );
    for (const [name, background] of [
      ['light', '#e6e9e8'],
      ['dark', '#101923'],
    ]) {
      await page.evaluate((value) => {
        document.body.style.background = value;
      }, background);
      await page.screenshot({ path: path.join(folder, `subtitles-${name}.png`) });
    }
    await page.evaluate(() => {
      document.body.style.background = '';
    });
  }
  if (!real) {
    const [preferences] = await Promise.all([
      application.waitForEvent('window'),
      page.locator('#support-author').click({ force: true }),
    ]);
    await preferences.waitForURL('capri://desktop/settings.html');
    await preferences.locator('[data-section="support"][aria-current="page"]').waitFor();
    assert.equal(
      await preferences
        .locator('.support-orbit')
        .evaluate((el) => getComputedStyle(el).animationName),
      'support-orbit',
    );
    await preferences.screenshot({ path: path.join(folder, 'support.png'), omitBackground: true });
    await preferences.locator('[data-section="appearance"]').click();
    await preferences.locator('#companion-glitch-enabled').check();
    await preferences.locator('#companion-glitch-strength').fill('35');
    await preferences.locator('#companion-glitch-interval').fill('90');
    await preferences.locator('#companion-glitch-enabled').uncheck();
    await saveSettings(preferences);
    await page.waitForFunction(
      async () => (await window.capri.bootstrap()).companion.glitchIntervalSeconds === 90,
    );
    assert.equal(
      (await page.evaluate(() => window.capri.bootstrap())).companion.glitchStrength,
      35,
    );
    await page.waitForFunction(() => document.body.dataset.glitch === 'quiet');
    await preferences.locator('#settings-window-close').click();
    // Exercise ordinary UI actions after disabling glitches, with no microphone/model work.
    await page.locator('#history-toggle').click({ force: true });
    await page.locator('#history-close').click({ force: true });
    assert.equal(await page.locator('body').getAttribute('data-glitch'), 'quiet');
    await page.screenshot({ path: path.join(folder, 'toolbar.png'), omitBackground: true });
    const overlaps = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#handle button,#quick-actions button')]
        .filter(
          (el) =>
            !el.hidden &&
            el.getClientRects().length &&
            getComputedStyle(el).visibility !== 'hidden',
        )
        .map((el) => ({ id: el.id || el.dataset.quick, rect: el.getBoundingClientRect() }));
      return buttons.flatMap((a, i) =>
        buttons
          .slice(i + 1)
          .filter(
            (b) =>
              a.rect.left < b.rect.right &&
              a.rect.right > b.rect.left &&
              a.rect.top < b.rect.bottom &&
              a.rect.bottom > b.rect.top,
          )
          .map((b) => [a.id, b.id]),
      );
    });
    assert.deepEqual(overlaps, []);
    await page.locator('#presence-toggle').click({ force: true });
    await page.waitForFunction(() => document.body.dataset.presence === 'core');
    assert.equal(await page.locator('#presence-toggle').isVisible(), true);
    await page.evaluate(() => {
      document.getElementById('screen-indicator').hidden = false;
    });
    assert.equal(await page.locator('#screen-indicator').isVisible(), true);
    await page.evaluate(() => {
      document.getElementById('screen-indicator').hidden = true;
    });
    await page.locator('#presence-toggle').click({ force: true });
    await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
    record(
      'Toolbar groups do not overlap; core keeps presence/capture controls; support and glitch settings work',
    );
  }
  const count = await page.locator('.message').count();
  const selectedBeforeRestart = await page.locator('#sprite').getAttribute('data-avatar');
  const layoutBeforeRestart = (await page.evaluate(() => window.capri.bootstrap())).avatarLayout;
  const transcript = JSON.parse(readFileSync(path.join(folder, 'desktop/transcript.json'), 'utf8'));
  assert.ok(!transcript.messages.some((message) => message.text.includes('[avatar:')));
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: path.join(folder, 'companion.png'), omitBackground: true });
  await closeApplication();
  const requestsBeforeRestart = seen.length;
  page = await launch();
  assert.equal(await page.locator('.message').count(), count);
  assert.equal(await page.locator('#sprite').getAttribute('data-avatar'), selectedBeforeRestart);
  assert.deepEqual(
    (await page.evaluate(() => window.capri.bootstrap())).avatarLayout,
    layoutBeforeRestart,
  );
  assert.ok(
    Math.abs(
      Number(await page.locator('#sprite-region').getAttribute('data-zoom')) -
        layoutBeforeRestart.zoom,
    ) < 0.001,
  );
  if (!real) assert.equal(seen.length, requestsBeforeRestart);
  record(
    'Transcript, expression, Capri position and zoom survive restart without replaying messages into the model',
    { messages: count, expression: selectedBeforeRestart, avatarLayout: layoutBeforeRestart },
  );
  await page.screenshot({ path: path.join(folder, 'restored.png'), omitBackground: true });
  if (!real) {
    assert.equal(
      (await page.evaluate(() => window.capri.bootstrap())).companion.glitchIntervalSeconds,
      90,
    );
    await page.locator('#quit').click({ force: true });
    await page.waitForSelector('#confirmation-dialog[open]');
    await page.locator('[data-choice="cancel"]').click({ force: true });
    assert.equal(application.windows().length, 1);
    await page.locator('#quit').click({ force: true });
    await page.waitForSelector('#confirmation-dialog[open]');
    const closed = application.waitForEvent('close', { timeout: 10000 });
    const started = performance.now();
    await page.locator('[data-choice="confirm"]').click({ force: true });
    await closed;
    application = null;
    record('Close button uses the confirmed unload action; preferences survive restart', {
      fixtureExitMs: Math.round(performance.now() - started),
    });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(`FAIL ${error.message}`);
  if (application) {
    const pages = application.windows();
    if (pages[0])
      await pages[0]
        .screenshot({ path: path.join(folder, 'failure.png'), omitBackground: true, timeout: 5000 })
        .catch(() => {});
  }
} finally {
  await closeApplication();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (real) await stopManaged(rt.logPrefix).catch((error) => console.error(error.message));
  mkdirSync(path.join(root, 'logs'), { recursive: true });
  writeFileSync(
    path.join(
      root,
      'logs',
      real ? 'desktop-verification-real-latest.json' : 'desktop-verification-latest.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
}
