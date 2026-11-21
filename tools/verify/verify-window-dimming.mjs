/** Own isolated Electron window only; no physical input, screen capture or model calls. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/dimming-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-')),
  errors = [],
  graphicsWarnings = [];
const server = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: server.address().port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const require = createRequire(import.meta.url),
  checks = [];
const report = {
  passed: false,
  folder,
  checks,
  physicalMicrophone: false,
  userScreenCapture: false,
  ownerHistoryChanged: false,
};
let application, page;
async function launch() {
  application = await electron.launch({
    executablePath: require('electron'),
    env,
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    timeout: 60000,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning' && message.text().startsWith('Capri portrait graphics: '))
      graphicsWarnings.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () => document.body.dataset.phase === 'ready' && document.body.dataset.initialized === 'true',
    null,
    {
      timeout: 30000,
    },
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function settings(value) {
  await page.evaluate((value) => window.capri.setDimming(value), value);
  await page.waitForFunction((value) => {
    const shade = document.getElementById('window-shade');
    return (
      Math.abs(Number(getComputedStyle(shade).opacity) - (value.enabled ? value.level / 100 : 0)) <
      0.001
    );
  }, value);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function presence(mode) {
  if ((await page.evaluate(() => document.body.dataset.presence)) !== mode)
    await page.evaluate(() => document.getElementById('presence-toggle').click());
  await page.waitForFunction((mode) => document.body.dataset.presence === mode, mode);
  // Presence changes the layout immediately, but backdrop bounds are published
  // on the next animation frame (including ResizeObserver work). Read painted
  // geometry, not the preceding portrait bounds on a busy Windows runner.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function layer() {
  return page.locator('#window-shade').evaluate((el) => {
    const box = el.getBoundingClientRect(),
      style = getComputedStyle(el);
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      viewport: [innerWidth, innerHeight],
      opacity: Number(style.opacity),
      pointerEvents: style.pointerEvents,
    };
  });
}
function assertGeometry(shade, compact) {
  const [width, height] = shade.viewport;
  if (!compact) {
    assert.deepEqual([shade.x, shade.y, shade.width, shade.height], [0, 0, width, height]);
    return;
  }
  assert.ok(
    shade.x >= 0 && shade.y > 0 && shade.width > 0 && shade.height > 0,
    JSON.stringify(shade),
  );
  assert.ok(shade.x + shade.width <= width + 1 && shade.y + shade.height <= height + 1);
  assert.ok(shade.height < height, 'Signal core must not shade the unused portrait area');
}
async function shadePixels() {
  const sample = await page.evaluate(() => {
    const owner = document.getElementById('companion');
    const layer = document.getElementById('window-shade');
    const clone = layer.cloneNode(true);
    const box = layer.getBoundingClientRect();
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const portrait = rect('#portrait-panel');
    const composer = rect('.composer');
    const reply = rect('#subtitle-frame');
    const support = rect('#support-author');
    const reportButton = rect('#report-bug');
    const centerY = (r) => r.top + r.height / 2;
    const panelGap = document.body.hasAttribute('data-horizontal-portrait')
      ? [portrait.right + 5, centerY(portrait)]
      : [portrait.left + portrait.width / 2, (portrait.top + reply.bottom) / 2];
    const points = {
      center: [portrait.left + portrait.width / 2, centerY(portrait)],
      edge: [portrait.left + 2, centerY(portrait)],
      corner: [1, 1],
      composer: [composer.left + composer.width / 2, centerY(composer)],
      cut: [composer.left + 2, composer.top + 2],
      button: [support.left + support.width / 2, centerY(support)],
      buttonGap: [(support.right + reportButton.left) / 2, centerY(support)],
      panelGap,
    };
    clone.dataset.fixture = '';
    Object.assign(clone.style, {
      position: 'fixed',
      left: box.x + 'px',
      top: box.y + 'px',
      width: box.width + 'px',
      height: box.height + 'px',
    });
    document.body.append(clone);
    owner.style.opacity = '0';
    return { points, width: innerWidth, height: innerHeight };
  });
  let bytes;
  try {
    bytes = await page.screenshot({ omitBackground: true });
  } finally {
    await page.evaluate(() => {
      document.querySelector('#window-shade[data-fixture]').remove();
      document.getElementById('companion').style.removeProperty('opacity');
    });
  }
  return application.evaluate(
    ({ nativeImage }, { base64, points, width, height }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
      const size = image.getSize();
      const pixels = image.toBitmap();
      const alpha = ([x, y]) =>
        pixels[
          (Math.floor((y * size.height) / height) * size.width +
            Math.floor((x * size.width) / width)) *
            4 +
            3
        ];
      return Object.fromEntries(
        Object.entries(points).map(([name, point]) => [name, alpha(point)]),
      );
    },
    { ...sample, base64: bytes.toString('base64') },
  );
}
try {
  await launch();
  await settings({ enabled: true, level: 65, softness: 140 });
  for (const mode of ['core', 'portrait', 'core']) {
    await presence(mode);
    const shade = await layer();
    assert.equal(shade.opacity, 0.65);
    assert.equal(shade.pointerEvents, 'none');
    assertGeometry(shade, mode === 'core');
  }
  checks.push('Backdrop stays visible in signal core and portrait without intercepting clicks');
  const drift = await page.evaluate(() => {
    const companion = document.getElementById('companion');
    const mask = document.querySelector('#window-shade .dimming-plane');
    const composer = document.querySelector('.composer');
    const positions = () => [mask, composer].map((node) => node.getBoundingClientRect().y);
    const before = positions();
    companion.style.translate = '0 -7px';
    const after = positions();
    companion.style.removeProperty('translate');
    return after.map((value, index) => value - before[index]);
  });
  assert.deepEqual(drift, [-7, -7]);
  checks.push('The mask moves with the floating controls');
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getParentWindow(),
    ),
    null,
  );
  const movements = await application.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0],
      area = screen.getDisplayMatching(win.getBounds()).workArea;
    return [
      { x: area.x + 12, y: area.y + 12 },
      {
        x: area.x + Math.max(12, area.width - win.getBounds().width - 20),
        y: area.y + Math.max(12, area.height - win.getBounds().height - 20),
      },
    ];
  });
  for (const position of movements) {
    const bounds = await application.evaluate(({ BrowserWindow }, position) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setPosition(position.x, position.y);
      return win.getBounds();
    }, position);
    assert.equal(bounds.x, position.x);
    assert.equal(bounds.y, position.y);
    const shade = await layer();
    assertGeometry(shade, true);
  }
  checks.push(
    'Moving to opposite corners retains one window and a compact backdrop inside its viewport',
  );
  const drag = await application.evaluate(
    async ({ BrowserWindow, screen }, modulePath) => {
      const load = process.getBuiltinModule('node:module').createRequire(process.execPath);
      const { PointerController } = load(modulePath);
      const win = BrowserWindow.getAllWindows()[0];
      const initial = win.getBounds();
      let cursor = { x: initial.x + 20, y: initial.y + 20 };
      const controller = new PointerController({
        window: win,
        screen: { getCursorScreenPoint: () => cursor },
        getRegions: () => null,
      });
      controller.beginWindow();
      for (let index = 0; index < 100; index++) {
        cursor = { x: initial.x + 20 + (index % 20), y: initial.y + 20 + (index % 10) };
        controller.tick();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const after = win.getBounds();
      win.setBounds(initial, false);
      return { initial, after, scale: screen.getDisplayMatching(after).scaleFactor };
    },
    path.join(root, 'apps/desktop/main/pointer-controller.mjs'),
  );
  assert.ok(
    Math.abs(drag.initial.width - drag.after.width) <= 1 &&
      Math.abs(drag.initial.height - drag.after.height) <= 1,
    'Repeated native dragging must not grow the companion',
  );
  checks.push('Repeated native pointer movement preserves window size');
  await presence('portrait');
  const originalBounds = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  const smallContent = await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setResizable(true);
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setBounds({ ...win.getBounds(), width: 320, height: 480 });
    return win.getContentBounds();
  });
  await page.waitForFunction(
    (bounds) =>
      Math.abs(innerWidth - bounds.width) <= 1 && Math.abs(innerHeight - bounds.height) <= 1,
    smallContent,
  );
  await settings({ enabled: true, level: 65, softness: 320 });
  const resized = await layer();
  assert.deepEqual([resized.width, resized.height], resized.viewport);
  assert.ok(resized.width < originalBounds.width && resized.height < originalBounds.height);
  const limited = await shadePixels();
  assert.ok(Math.abs(limited.composer - 166) <= 3 && limited.cut < 5, JSON.stringify(limited));
  const restoredContent = await application.evaluate(({ BrowserWindow }, bounds) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds(bounds);
    win.setResizable(false);
    win.setIgnoreMouseEvents(true, { forward: true });
    return win.getContentBounds();
  }, originalBounds);
  await page.waitForFunction(
    (bounds) =>
      Math.abs(innerWidth - bounds.width) <= 1 && Math.abs(innerHeight - bounds.height) <= 1,
    restoredContent,
  );
  await settings({ enabled: true, level: 65, softness: 140 });
  checks.push('Resizing and maximum feather width preserve the composer contour');
  const soft = await shadePixels();
  assert.ok(Math.abs(soft.center - 166) <= 3);
  assert.ok(soft.edge < 80 && soft.corner < 5, JSON.stringify(soft));
  assert.ok(soft.buttonGap < 5 && soft.panelGap < 5, JSON.stringify(soft));
  await settings({ enabled: true, level: 85, softness: 0 });
  const hard = await shadePixels();
  assert.ok(Math.abs(hard.center - 217) <= 3);
  assert.ok(Math.abs(hard.edge - 217) <= 3 && Math.abs(hard.button - 217) <= 3);
  assert.ok(hard.corner < 5 && hard.cut < 5 && hard.buttonGap < 5 && hard.panelGap < 5);
  await settings({ enabled: false, level: 85, softness: 140 });
  const disabled = await shadePixels();
  assert.equal(disabled.center, 0);
  await settings({ enabled: true, level: 0, softness: 140 });
  assert.equal((await shadePixels()).center, 0);
  checks.push(
    'Pixel alpha verifies clipped corners, clear gaps, feathered edges, disable and zero strength',
  );

  await page.evaluate(async () => {
    const { companion } = await window.capri.bootstrap();
    await window.capri.setCompanionSettings({ ...companion, windowLayout: 'horizontal' });
  });
  await page.waitForFunction(() => document.body.hasAttribute('data-horizontal-portrait'));
  await settings({ enabled: true, level: 85, softness: 0 });
  const horizontal = await shadePixels();
  assert.ok(Math.abs(horizontal.center - 217) <= 3, JSON.stringify(horizontal));
  assert.ok(horizontal.panelGap < 5 && horizontal.buttonGap < 5, JSON.stringify(horizontal));
  await page.evaluate(async () => {
    const { companion } = await window.capri.bootstrap();
    await window.capri.setCompanionSettings({ ...companion, windowLayout: 'vertical' });
  });
  await page.waitForFunction(() => !document.body.hasAttribute('data-horizontal-portrait'));
  checks.push('Horizontal portrait keeps the space beside the portrait transparent');

  await settings({ enabled: true, level: 57, softness: 95 });
  const configuration = await settingsView(application, 'window');
  const softness = configuration.locator('#dimming-softness');
  assert.equal(await softness.getAttribute('aria-valuetext'), '9.5 px');
  await softness.fill('320');
  await page.waitForFunction(
    () => document.getElementById('dimming-softness').getAttribute('aria-valuetext') === '32 px',
  );
  const preview = await shadePixels();
  assert.ok(preview.edge < 60 && preview.panelGap < 5, JSON.stringify(preview));
  await configuration.locator('#settings-window-close').click();
  await configuration.locator('#settings-discard').click();
  await page.waitForFunction(
    () => document.getElementById('dimming-softness').getAttribute('aria-valuetext') === '9.5 px',
  );
  await configuration.evaluate(() => window.capri.closeSettings());
  checks.push('Settings displays the new feather width, live preview and discard restore the mask');

  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .hide(),
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => win.isVisible()),
    ),
    false,
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  assert.equal((await layer()).opacity, 0.57);
  await page.screenshot({ path: path.join(folder, 'signal-core.png'), omitBackground: true });
  await presence('portrait');
  await page.screenshot({ path: path.join(folder, 'portrait.png'), omitBackground: true });
  checks.push('Hide/show has no orphan shade window');
  await application.close();
  application = null;
  await launch();
  assert.deepEqual((await page.evaluate(() => window.capri.bootstrap())).dimming, {
    enabled: true,
    level: 57,
    softness: 95,
  });
  assert.equal((await layer()).opacity, 0.57);
  checks.push('Existing preferences persist on restart');

  await presence('portrait');
  await page.waitForFunction(() => document.body.dataset.crt === 'webgl');
  const contextLostLog = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('"event":"context-lost"'),
  });
  await page.locator('#crt-screen').evaluate((canvas) => {
    const contextLoss = canvas.getContext('webgl').getExtension('WEBGL_lose_context');
    canvas.addEventListener('capri-test-restore-context', () => contextLoss.restoreContext(), {
      once: true,
    });
    contextLoss.loseContext();
  });
  await contextLostLog;
  await page.waitForFunction(() => document.body.dataset.crt === 'fallback');
  assert.equal(await page.locator('#crt-screen').isVisible(), false);
  assert.equal(
    await page.locator('#sprite').evaluate((node) => getComputedStyle(node).opacity),
    '1',
  );
  const contextRestoredLog = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('"event":"context-restored"'),
  });
  await page.locator('#crt-screen').dispatchEvent('capri-test-restore-context');
  await contextRestoredLog;
  await page.waitForFunction(() => document.body.dataset.crt === 'webgl');
  checks.push('WebGL context loss reveals the sprite and Chromium can restore the effect');

  await application.evaluate(({ app }) => {
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', exitCode: 1 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit', exitCode: 0 });
  });
  assert.equal(await page.locator('body').getAttribute('data-crt'), 'webgl');
  const fallbackLog = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('"event":"gpu-process-exit-fallback"'),
  });
  await application.evaluate(({ app }) =>
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: -1073741819 }),
  );
  await fallbackLog;
  await page.waitForFunction(() => document.body.dataset.crt === 'fallback');
  assert.equal(await page.locator('#crt-screen').isVisible(), false);
  assert.equal(
    await page.locator('#sprite').evaluate((node) => getComputedStyle(node).opacity),
    '1',
  );
  await page.locator('#crt-screen').dispatchEvent('webglcontextrestored');
  assert.equal(await page.locator('body').getAttribute('data-crt'), 'fallback');
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).portraitFallback, true);
  checks.push('Unexpected GPU exit switches to the DOM sprite and disables WebGL for this session');

  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.pageErrors = errors;
  report.graphicsWarnings = graphicsWarnings;
  report.renderer = await page
    ?.evaluate(() => ({
      phase: document.body.dataset.phase,
      initialized: document.body.dataset.initialized,
      presence: document.body.dataset.presence,
      visibility: document.visibilityState,
      shade: document.getElementById('window-shade')?.getBoundingClientRect().toJSON(),
    }))
    .catch(() => null);
  console.error('Dimming verification state:', JSON.stringify(report));
  throw error;
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(root, 'logs/dimming-verification.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
