// SPDX-License-Identifier: GPL-3.0-only
// Drives the real companion's renderer and IPC without moving the owner's cursor.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { saveSettings, settingsView } from './settings-view.mjs';

if (process.platform !== 'win32') throw new Error('This verification requires Windows.');
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'resize-'));
const server = createServer((_request, response) => response.end('{"data":[]}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const args = [path.join(root, 'apps/desktop/main.mjs'), '--verification'];
const forcedScale = process.argv.includes('--dpi=150');
if (forcedScale) args.unshift('--force-device-scale-factor=1.5');
const launch = () =>
  _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args, env });
const testBounds = { x: 0, y: 0, width: 780, height: 540 };
const edges = ['w', 'n', 'nw', 's', 'e', 'se', 'ne', 'sw'];
let application;
const report = [];

async function bounds() {
  return application.evaluate(() => {
    const { win } = globalThis.resizeFixture;
    return { host: win.getContentBounds(), view: win.contentView.children[0].getBounds() };
  });
}

async function position(point) {
  return application.evaluate((_unused, point) => {
    globalThis.resizeFixture.cursor = point;
  }, point);
}

async function prepare() {
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BaseWindow, screen }) => {
    const win = BaseWindow.getAllWindows().find(
      (window) => window.webContents?.getURL() === 'capri://desktop/index.html',
    );
    const state = { win, cursor: screen.getCursorScreenPoint() };
    globalThis.resizeFixture = state;
    screen.getCursorScreenPoint = () => state.cursor;
    win.setIgnoreMouseEvents(false);
    win.showInactive();
  });
  return page;
}

try {
  application = await launch();
  const page = await prepare();
  if (!(await page.locator('body[data-presence="portrait"]').count()))
    await page.locator('#presence-toggle').click({ force: true });
  await page.locator('body[data-window-resizable]').waitFor();
  await page.evaluate(() => {
    window.resizeHidRenderer = false;
    const root = document.documentElement;
    window.resizeOpacityObserver = new MutationObserver((changes) => {
      window.resizeHidRenderer ||=
        root.style.opacity === '0' ||
        changes.some(({ oldValue }) => /(?:^|;)\s*opacity:\s*0(?:;|$)/u.test(oldValue ?? ''));
    });
    window.resizeOpacityObserver.observe(root, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    });
  });
  const scale = await page.evaluate(() => devicePixelRatio);
  const nativeScale = await application.evaluate(({ screen }) => {
    const bounds = globalThis.resizeFixture.win.getBounds();
    return screen.dipToScreenRect(null, bounds).width / bounds.width;
  });
  const pixelRatio = nativeScale / scale;
  const waitForViewport = (size) =>
    page.waitForFunction(
      ({ width, height }) =>
        Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1,
      { width: size.width * pixelRatio, height: size.height * pixelRatio },
      { timeout: 5000 },
    );

  for (const layout of ['vertical', 'horizontal']) {
    if (layout === 'horizontal') {
      const settings = await settingsView(application, 'window');
      await settings.locator('#companion-window-layout').selectOption(layout);
      await saveSettings(settings);
      await settings.locator('#settings-window-close').click();
    }
    await page.locator(`body[data-window-layout="${layout}"]`).waitFor();
    for (const edge of edges) {
      console.log(`Checking ${layout} ${edge}`);
      const initial = await application.evaluate(({ screen }, size) => {
        const win = globalThis.resizeFixture.win;
        const area = screen.getDisplayMatching(win.getBounds()).workArea;
        win.setBounds({ ...size, x: area.x + 100, y: area.y + 95 });
        return win.getBounds();
      }, testBounds);
      await waitForViewport(initial).catch(async (error) => {
        const viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
        throw new Error(
          `Viewport setup did not settle: ${JSON.stringify({ viewport, ...(await bounds()), pixelRatio })}`,
          {
            cause: error,
          },
        );
      });
      const grip = page.locator(`[data-resize-edge="${edge}"]`);
      const box = await grip.boundingBox();
      assert.ok(box, `${layout} ${edge} should have a visible resize grip`);
      const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      const pressed = {
        x: initial.x + Math.round(point.x / pixelRatio),
        y: initial.y + Math.round(point.y / pixelRatio),
      };
      await position(pressed);
      if (forcedScale) {
        // The Windows DPI stays unchanged when only Chromium's scale is forced.
        // Inject the IPC gesture at this scale to avoid CDP's physical mouse emulation.
        assert.equal(await page.evaluate((edge) => window.capri.startDrag(edge), edge), true);
      } else {
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
      }
      const steps = [13, 25, 38];
      let workspace;
      for (const step of steps) {
        const dragX = edge.includes('e') ? step : edge.includes('w') ? -step : 0;
        const dragY = edge.includes('s') ? step : edge.includes('n') ? -step : 0;
        await position({ x: pressed.x + dragX, y: pressed.y + dragY });
        if (forcedScale) assert.equal(await page.evaluate(() => window.capri.dragFrame()), true);
        else await page.mouse.move(point.x + steps.indexOf(step) + 1, point.y + 1);
        await waitForViewport({
          width: initial.width + Math.abs(dragX),
          height: initial.height + Math.abs(dragY),
        });
        const { host, view } = await bounds();
        workspace ??= host;
        assert.deepEqual(host, workspace, 'Native host must remain stationary during live reflow');
        const x = host.x + view.x;
        const y = host.y + view.y;
        assert.equal(x, initial.x + Math.min(0, dragX));
        assert.equal(y, initial.y + Math.min(0, dragY));
        if (dragX <= 0) assert.equal(x + view.width, initial.x + initial.width);
        if (dragY <= 0) assert.equal(y + view.height, initial.y + initial.height);
      }
      if (forcedScale) await page.evaluate(() => window.capri.endDrag(true));
      else await page.mouse.up();
      // Finishing the gesture returns the native HWND to the visible rectangle.
      const until = Date.now() + 3000;
      let result = await bounds();
      while (
        (result.view.x ||
          result.view.y ||
          result.view.width !== result.host.width ||
          result.view.height !== result.host.height) &&
        Date.now() < until
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        result = await bounds();
      }
      assert.deepEqual(result.view, {
        x: 0,
        y: 0,
        width: result.host.width,
        height: result.host.height,
      });
      await page.waitForTimeout(100);
      report.push(`${layout} ${edge}`);
    }
  }
  assert.equal(await page.evaluate(() => window.resizeHidRenderer), false);
  const beforeMove = (await bounds()).host;
  const title = await page.locator('#capri-header-version').boundingBox();
  assert.ok(title);
  const x = Math.round(title.x + title.width / 2);
  const y = Math.round(title.y + title.height / 2);
  const pressed = {
    x: beforeMove.x + Math.round(x / pixelRatio),
    y: beforeMove.y + Math.round(y / pixelRatio),
  };
  await position(pressed);
  if (forcedScale) assert.equal(await page.evaluate(() => window.capri.startDrag()), true);
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  await position({ x: pressed.x + 37, y: pressed.y - 21 });
  if (forcedScale) await page.evaluate(() => window.capri.endDrag(true));
  else {
    await page.mouse.move(x + 2, y + 2);
    await page.mouse.up();
  }
  await page.waitForTimeout(120);
  assert.deepEqual((await bounds()).host, {
    ...beforeMove,
    x: beforeMove.x + 37,
    y: beforeMove.y - 21,
  });
  const saved = JSON.parse(readFileSync(path.join(folder, 'desktop/window.json'), 'utf8'));
  await application.close();
  application = await launch();
  await prepare();
  const { host } = await bounds();
  assert.equal(host.x, saved.x);
  assert.equal(host.y, saved.y);
  console.log(
    JSON.stringify({ passed: true, gestures: report, move: true, restored: true, scale, folder }),
  );
} finally {
  await application?.close();
  server.close();
}
