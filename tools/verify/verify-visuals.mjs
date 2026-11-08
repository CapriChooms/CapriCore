/** Real renderer, fixture dialogue; no production messages or model calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { loadAvatarCatalog, ACTIVE_AVATAR_CATALOG } from '../../apps/desktop/avatar-catalog.mjs';
const catalog = loadAvatarCatalog(path.join(root, ACTIVE_AVATAR_CATALOG));

const parent = path.join(root, '.runtime/visual-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const report = { timestamp: new Date().toISOString(), folder, checks: [] };
const record = (name, detail = {}) => {
  report.checks.push({ name, ...detail });
  console.log(`PASS ${name}`);
};
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
    return;
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const requested = JSON.parse(body)
    .messages.at(-1)
    .content.match(/^avatar:([a-z0-9_-]+)$/)?.[1];
  const id = catalog.sprites.some((sprite) => sprite.id === requested) ? requested : 'smirk';
  res.setHeader('content-type', 'text/event-stream');
  res.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: `[avatar:${id}]\nThere you are, choom. The future looks better from here.` } }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = initialize(
  runtime({
    stateDir: path.join(folder, 'openclaw'),
    workspace: path.join(folder, 'workspace'),
    gatewayPort: server.address().port,
  }),
);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(rt.gatewayPort),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application, page;
const errors = [];
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (win) => win.webContents.getURL() === 'capri://desktop/index.html',
    );
    // The production companion may occlude the fixture at the same corner.
    // Keep this isolated renderer ticking without stealing the user's focus.
    win.webContents.setBackgroundThrottling(false);
    win.showInactive();
  });
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(
    () => document.body.dataset.presence === 'portrait' && document.body.dataset.crt === 'webgl',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.body.dataset.glitch === 'quiet');
  const contours = await page.evaluate(() =>
    [...document.querySelectorAll('[data-panel-cut]')]
      .filter(
        (node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden',
      )
      .map((node) => {
        const outline = node.querySelector(':scope > svg .panel-outline'),
          cut = Number(node.dataset.panelCut);
        const width = node.clientWidth,
          height = node.clientHeight,
          stroke = Number.parseFloat(getComputedStyle(outline).strokeWidth);
        const c = Math.min(cut, width / 4, height / 3),
          total = outline.getTotalLength();
        let inside = true;
        for (let length = 0; length < total; length += 0.5) {
          const p = outline.getPointAtLength(length),
            margin = stroke / 2 - 0.1;
          inside &&= Math.min(p.x, p.y, width - p.x, height - p.y) >= margin;
          if (c)
            inside &&=
              (p.x + p.y - c) / Math.SQRT2 >= margin &&
              (width + height - c - p.x - p.y) / Math.SQRT2 >= margin;
        }
        return {
          id: node.id || node.className,
          closed: outline.getAttribute('d').endsWith('Z'),
          stroke,
          inside,
        };
      }),
  );
  assert.ok(
    contours.length >= 6 &&
      contours.every((node) => node.closed && node.inside && node.stroke >= 2.5),
  );
  record('Closed 2.5px contours including diagonal cuts stay inside panel clips', { contours });
  await page.evaluate(() => {
    document.body.style.background = '#0c121c';
  });
  await page.screenshot({ path: path.join(folder, 'portrait-crt.png') });
  const gl = await page.evaluate(() => {
    const gl = document.querySelector('#crt-screen').getContext('webgl');
    return {
      version: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      error: gl.getError(),
      sourceOpacity: getComputedStyle(document.querySelector('#sprite')).opacity,
    };
  });
  assert.equal(gl.error, 0);
  assert.equal(gl.sourceOpacity, '0');
  record('CRT distortion shader compiles and renders the sprite', gl);
  const assets = await page.evaluate(async () => {
    const { animation, avatars } = await window.capri.bootstrap();
    for (let i = 0; i < animation.frames.length; i += 4)
      await Promise.all(
        animation.frames.slice(i, i + 4).map(async (frame) => {
          const image = new Image();
          image.src = frame.url;
          await image.decode();
          if (image.naturalWidth !== 1254 || image.naturalHeight !== 1254)
            throw new Error('Bad sprite canvas');
        }),
      );
    return {
      frames: animation.frames.length,
      choices: avatars.length,
      walking: animation.frames.some((f) => f.id.includes('walk')),
    };
  });
  assert.equal(assets.frames, catalog.portraitFrames.length);
  assert.equal(assets.choices, catalog.sprites.length);
  assert.equal(assets.walking, false);
  record('Active portrait PNGs decode through the runtime resource allowlist', assets);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#message').fill('Are you ready, Capri?');
  await page.locator('#message').press('Enter');
  await page.waitForFunction(() => document.querySelector('#sprite').dataset.avatar === 'smirk');
  await page.waitForFunction(
    () => Number(getComputedStyle(document.body).getPropertyValue('--glitch-strength')) > 0.5,
  );
  await page.screenshot({ path: path.join(folder, 'pose-glitch.png') });
  record('Actual dialogue/expression transition triggers strong multicolor glitch');
  await page.locator('#message').blur();
  await page.mouse.move(-10, -10);
  await page.waitForFunction(() => document.body.dataset.glitch === 'quiet');
  // No new message: an expanded pinned portrait must still produce ambient bursts.
  await page.waitForFunction(() => document.body.dataset.glitch === 'active', null, {
    timeout: 11000,
  });
  assert.equal(await page.evaluate(() => document.body.dataset.presence), 'portrait');
  record('Periodic glitch continues with portrait visible, without standby');
  await page.waitForFunction(() => document.body.dataset.activity === 'looking-around', null, {
    timeout: 30000,
  });
  const autonomousFrame = await page.locator('#sprite').getAttribute('data-frame');
  await page.screenshot({ path: path.join(folder, 'autonomous-activity.png') });
  record('Without new prompts Capri starts her own visual activity and stays visible', {
    frame: autonomousFrame,
  });
  if (process.argv.includes('--record')) {
    const frames = path.join(folder, 'frames');
    mkdirSync(frames);
    const begin = performance.now();
    for (let frame = 0; frame < 90; frame++) {
      await page.waitForTimeout(Math.max(0, frame * 100 - (performance.now() - begin)));
      await page.screenshot({ path: path.join(frames, `${String(frame).padStart(4, '0')}.png`) });
    }
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        '10',
        '-i',
        path.join(frames, '%04d.png'),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '19',
        '-movflags',
        '+faststart',
        path.join(folder, 'capri-signal.mp4'),
      ],
      { windowsHide: true, timeout: 60000 },
    );
    report.preview = path.join(folder, 'capri-signal.mp4');
  }
  const select = async (id) => {
    await page.locator('#message').fill(`avatar:${id}`);
    await page.locator('#message').press('Enter');
    await page.waitForFunction((id) => document.querySelector('#sprite').dataset.avatar === id, id);
  };
  await select('wink');
  await page.waitForFunction(
    () => document.querySelector('#sprite').dataset.frame?.startsWith('idle-wink'),
    null,
    { timeout: 5000 },
  );
  await page.screenshot({ path: path.join(folder, 'wink.png') });
  record('Wink shows its authored facial frames');
  await select('thinking');
  await page.waitForFunction(
    () => document.querySelector('#sprite').dataset.frame === 'thinking',
    null,
    { timeout: 6000 },
  );
  assert.equal(await page.locator('#avatar-effect').isHidden(), true);
  await page.screenshot({ path: path.join(folder, 'thinking.png') });
  record('New context preempts a facial reaction and preserves the standing portrait');
  await page.locator('#message').blur();
  await page.mouse.move(-10, -10);
  // Sample real animation-frame delivery while the effect layers are running.
  report.animation = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let previous = performance.now();
        const tick = (now) => {
          samples.push(now - previous);
          previous = now;
          if (samples.length < 120) requestAnimationFrame(tick);
          else
            resolve({
              frames: samples.length,
              medianMs: [...samples].sort((a, b) => a - b)[60],
              maxMs: Math.max(...samples),
            });
        };
        requestAnimationFrame(tick);
      }),
  );
  const positions = [];
  for (let sample = 0; sample < 12; sample++) {
    positions.push(
      await page.evaluate(() => document.querySelector('#companion').getBoundingClientRect().y),
    );
    await page.waitForTimeout(100);
  }
  assert.ok(positions.every((y) => Math.abs(y) < 2.5));
  assert.ok(Math.max(...positions) - Math.min(...positions) > 0.03);
  record('Floating stays below 2.5px and keeps moving while untouched');
  await page.locator('#message').focus();
  const locked = await page.evaluate(
    () => document.querySelector('#companion').getBoundingClientRect().y,
  );
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => document.querySelector('#companion').getBoundingClientRect().y),
    locked,
  );
  record('Floating freezes during text input');
  await page.locator('#history-toggle').click({ force: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.body.dataset.glitch === 'quiet');
  await page.screenshot({ path: path.join(folder, 'history-frame.png') });
  await page.locator('#history-close').click({ force: true });
  const staticState = await page.evaluate(() => ({
    strength: getComputedStyle(document.body).getPropertyValue('--glitch-strength'),
    float: document.querySelector('#companion').getBoundingClientRect().y,
  }));
  assert.equal(Number(staticState.strength), 0);
  assert.equal(staticState.float, 0);
  record('Reduced motion stops glitch and floating while keeping static CRT');
  await page.evaluate(() =>
    document
      .querySelector('#crt-screen')
      .getContext('webgl')
      .getExtension('WEBGL_lose_context')
      .loseContext(),
  );
  await page.waitForFunction(() => document.body.dataset.crt === 'fallback');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('#sprite')).opacity),
    '1',
  );
  await page.screenshot({ path: path.join(folder, 'crt-fallback.png') });
  record('GPU context loss restores visible original sprite instead of a blank portrait');
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  process.exitCode = 1;
  report.rendererErrors = errors;
  report.state = await page
    ?.evaluate(() => ({
      dataset: { ...document.body.dataset },
      hidden: document.hidden,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }))
    .catch(() => null);
  await page?.screenshot({ path: path.join(folder, 'failure.png'), timeout: 3000 }).catch(() => {});
  console.error(error.message);
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, 'logs/visual-verification-latest.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      folder,
      animation: report.animation,
      preview: report.preview,
    }),
  );
}
