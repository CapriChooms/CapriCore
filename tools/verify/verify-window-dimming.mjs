/** Own isolated Electron window only; no physical input, screen capture or model calls. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/dimming-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-')),
  errors = [];
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
  // Hide our fixture's interface briefly so the PNG contains only our backdrop.
  await page.locator('#companion').evaluate((el) => (el.style.visibility = 'hidden'));
  let bytes;
  try {
    bytes = await page.screenshot({ omitBackground: true });
  } finally {
    await page.locator('#companion').evaluate((el) => el.style.removeProperty('visibility'));
  }
  return application.evaluate(({ nativeImage }, base64) => {
    const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64')),
      size = image.getSize(),
      pixels = image.toBitmap();
    const alpha = (x, y) => pixels[(y * size.width + x) * 4 + 3];
    return {
      center: alpha(Math.floor(size.width / 2), Math.floor(size.height / 2)),
      edge: alpha(0, Math.floor(size.height / 2)),
      corner: alpha(0, 0),
    };
  }, bytes.toString('base64'));
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
  // Full-portrait pixel checks retain the complete backdrop; compact bounds were checked above.
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
  assert.ok(Math.abs(limited.center - 166) <= 3 && limited.edge < 5);
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
  checks.push(
    'Resizing and maximum feather width keep the center shaded and edges inside the viewport',
  );
  const soft = await shadePixels();
  assert.ok(Math.abs(soft.center - 166) <= 3);
  assert.ok(soft.edge < 5 && soft.corner < 5);
  await settings({ enabled: true, level: 85, softness: 0 });
  const hard = await shadePixels();
  assert.ok(Math.abs(hard.center - 217) <= 3);
  assert.ok(Math.abs(hard.corner - 217) <= 3);
  await settings({ enabled: false, level: 85, softness: 140 });
  const disabled = await shadePixels();
  assert.equal(disabled.center, 0);
  await settings({ enabled: true, level: 0, softness: 140 });
  assert.equal((await shadePixels()).center, 0);
  checks.push(
    'Pixel alpha verifies feathered edges, the maximum strength, hard edges, disable and zero strength',
  );
  await settings({ enabled: true, level: 57, softness: 95 });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => win.isVisible()),
    ),
    false,
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
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
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.pageErrors = errors;
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
