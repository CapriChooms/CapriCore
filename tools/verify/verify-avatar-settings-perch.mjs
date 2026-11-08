// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';
import { requireCapriAvatar } from '../../apps/desktop/avatar-catalog.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const fixture = mkdtempSync(path.join(parent, 'settings-perch-'));
const entry = path.join(fixture, 'test-main.mjs');
writeFileSync(
  entry,
  `
import { Tray, BrowserWindow } from 'electron';
import { AvatarDetach } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main/avatar-detach.mjs')).href)};
const startPointer = AvatarDetach.prototype.startPointer;
AvatarDetach.prototype.startPointer = function () { globalThis.testPerchedAvatar = this; return startPointer.call(this); };
const ignoreMouse = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (value, ...args) { this.testIgnoresMouse = value; return ignoreMouse.call(this, value, ...args); };
const on = Tray.prototype.on;
Tray.prototype.on = function (event, handler) {
  if (event === 'right-click') { globalThis.testCapriTray = this; Tray.prototype.on = on; }
  return on.call(this, event, handler);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
const requests = [];
const gateway = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models')
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
  if (request.method === 'POST') requests.push(request.url);
  response.writeHead(503).end('Avatar movement must not reach a model.');
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const port = gateway.address().port;
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
const require = createRequire(import.meta.url);
const ownerUrl = 'capri://desktop/index.html';
const settingsUrl = 'capri://desktop/settings.html';
const overlayUrl = 'capri://desktop/avatar-detach.html';
const catalog = requireCapriAvatar(root);
const frame = catalog.desktopPoseFrames.find(({ id }) => id === 'pose-sit-edge');
const errors = [];
let app;
let page;
function nativeStacking(above, below) {
  for (const handle of [above, below]) assert.match(handle, /^\d+$/);
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CapriStackingProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint direction);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr hwnd, int index);
  public static bool Above(IntPtr above, IntPtr below) {
    for (int i = 0; i < 10000 && below != IntPtr.Zero; i++) {
      below = GetWindow(below, 3);
      if (below == above) return true;
    }
    return false;
  }
}
'@
$avatarHandle = [IntPtr]::new([long]${above})
$targetHandle = [IntPtr]::new([long]${below})
[pscustomobject]@{
  above = [CapriStackingProbe]::Above($avatarHandle, $targetHandle)
  foreground = [CapriStackingProbe]::GetForegroundWindow().ToInt64().ToString()
  style = [CapriStackingProbe]::GetWindowLongW($avatarHandle, -20)
  targetStyle = [CapriStackingProbe]::GetWindowLongW($targetHandle, -20)
} | ConvertTo-Json -Compress
`;
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
}

async function assertAboveSettings() {
  // If Windows refuses a synthetic focus request, recovery is deliberately
  // bounded by the low-rate heartbeat instead of forcing foreground access.
  await page.waitForTimeout(900);
  const settings = await info(settingsUrl);
  const avatar = await info(overlayUrl);
  const actual = nativeStacking(avatar.windowId, settings.windowId);
  assert.equal(
    actual.above,
    true,
    'The native avatar HWND must be above Settings, including her legs',
  );
  assert.ok(actual.style & 0x8, 'The avatar keeps its native WS_EX_TOPMOST flag');
  assert.ok(actual.style & 0x08000000, 'The avatar keeps WS_EX_NOACTIVATE and cannot steal focus');
}
async function info(url) {
  return app.evaluate(({ BrowserWindow, screen }, url) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL() === url);
    if (!window) return null;
    const handle = window.getNativeWindowHandle();
    return {
      windowId: String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()),
      processId: String(process.pid),
      bounds: window.getBounds(),
      visible: window.isVisible(),
      workArea: screen.getDisplayMatching(window.getBounds()).workArea,
    };
  }, url);
}
async function send(text) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
      .focus(),
  );
  const before = (await page.evaluate(() => window.capri.bootstrap())).messages.length;
  await page.locator('#message').fill(text);
  await page.waitForFunction(() => !document.getElementById('send').disabled);
  await page.locator('#message').press('Enter');
  for (let i = 0; i < 240; i++) {
    const { activeTurnId, messages } = await page.evaluate(() => window.capri.bootstrap());
    if (!activeTurnId && messages.length === before + 2 && messages.at(-1).status === 'complete')
      return;
    await page.waitForTimeout(50);
  }
  throw new Error('The avatar command did not complete');
}
async function nativeSettings() {
  const target = await info(settingsUrl);
  return callApplicationBridge(root, {
    action: 'avatar_window',
    ignoreProcessId: target.processId,
    allowedWindowId: target.windowId,
    windowId: target.windowId,
  });
}
async function assertSeat(fraction = 0.66) {
  const native = await nativeSettings();
  assert.ok(native.windowId, 'The visible Settings HWND is an allowed perching target');
  const settings = await info(settingsUrl);
  const point = {
    x: Math.round(settings.bounds.x + settings.bounds.width * fraction),
    y: settings.bounds.y,
  };
  const overlay = app.windows().find((item) => item.url() === overlayUrl);
  assert.ok(overlay, 'Capri has left her frame');
  const { bounds } = await info(overlayUrl);
  await overlay
    .waitForFunction(
      ({ point, bounds, frame, canvas }) => {
        const parked = document.getElementById('parked-avatar');
        const image = parked.querySelector('img');
        if (parked.hidden || !image.complete || !image.naturalWidth || image.src !== frame.url)
          return false;
        const rect = image.getBoundingClientRect();
        return (
          Math.abs(bounds.x + rect.x + (rect.width * frame.anchor.x) / canvas.width - point.x) <=
            1 &&
          Math.abs(bounds.y + rect.y + (rect.height * frame.anchor.y) / canvas.height - point.y) <=
            1
        );
      },
      { point, bounds, frame, canvas: catalog.canvas },
      { timeout: 8000 },
    )
    .catch(async (error) => {
      const actual = await overlay.evaluate(
        ({ frame, canvas }) => {
          const parked = document.getElementById('parked-avatar');
          const image = parked.querySelector('img');
          const rect = image.getBoundingClientRect();
          return {
            hidden: parked.hidden,
            frame: parked.dataset.poseFrame,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            contact: {
              x: rect.x + (rect.width * frame.anchor.x) / canvas.width,
              y: rect.y + (rect.height * frame.anchor.y) / canvas.height,
            },
          };
        },
        { frame, canvas: catalog.canvas },
      );
      console.log(
        JSON.stringify({
          point,
          bounds,
          native,
          settings: (await info(settingsUrl)).bounds,
          actual,
        }),
      );
      await overlay.screenshot({ path: path.join(fixture, 'settings-perch-failure.png') });
      throw error;
    });
  return overlay;
}
async function chooseMenu(label) {
  await app.evaluate(async (_electron, text) => {
    const tray = globalThis.testCapriTray;
    const popup = tray.popUpContextMenu;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tray menu timed out')), 5000);
        tray.popUpContextMenu = (menu) => {
          clearTimeout(timer);
          const item = menu.items.find((entry) => entry.label === text);
          if (!item?.enabled) return reject(new Error('Menu action unavailable: ' + text));
          item.click();
          resolve();
        };
        tray.emit('right-click');
      });
    } finally {
      tray.popUpContextMenu = popup;
    }
  }, label);
}
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [
      entry,
      '--verification',
      ...(process.argv.includes('--scale=1.5') ? ['--force-device-scale-factor=1.5'] : []),
    ],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await page.evaluate(() => {
    window.__detachPhases = [];
    window.capri.onEvent((event) => {
      if (event.type === 'avatar.detach') window.__detachPhases.push(event.phase);
    });
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  const settings = await settingsView(app, 'general');
  const area = (await info(settingsUrl)).workArea;
  const initial = {
    x: area.x + Math.round(area.width * 0.16),
    y: area.y + Math.round(area.height * 0.4),
    width: Math.min(620, area.width - 80),
    height: Math.min(480, Math.round(area.height * 0.5)),
  };
  const position = async (bounds) =>
    app.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL() === 'capri://desktop/settings.html')
          .setBounds(bounds),
      bounds,
    );
  await position(initial);
  assert.ok(
    (await nativeSettings()).windowId,
    'The explicit Settings exception reaches native window discovery',
  );
  await send('Sit on the Settings window');
  const messages = (await page.evaluate(() => window.capri.bootstrap())).messages;
  assert.match(
    messages.at(-1).text,
    /perched on the window/u,
    'The exact Settings request must select the real Settings window',
  );
  let overlay = await assertSeat();
  if (process.argv.includes('--stacking')) {
    await app.evaluate(({ BrowserWindow }) => {
      const settings = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
      );
      settings.focus();
    });
    await assertSeat();
    await assertAboveSettings();
    await app.evaluate(async ({ BrowserWindow }) => {
      const settings = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
      );
      const bounds = settings.getBounds();
      const other = new BrowserWindow({
        x: bounds.x + 50,
        y: bounds.y + 50,
        width: 280,
        height: 180,
        title: 'Capri stacking verification',
        alwaysOnTop: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await other.loadURL('data:text/html,<h1>Topmost application fixture</h1>');
      other.show();
      other.focus();
      // Simulate an unrelated application promoting itself after its focus event.
      other.moveTop();
      globalThis.testTopmostFixture = other;
    });
    await page.waitForTimeout(1000);
    const state = await app.evaluate(() => {
      const other = globalThis.testTopmostFixture;
      const handle = other.getNativeWindowHandle();
      return {
        focused: other.isFocused(),
        windowId: String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()),
      };
    });
    const order = nativeStacking((await info(overlayUrl)).windowId, state.windowId);
    assert.equal(order.above, true, 'Capri recovers above another topmost application');
    await app.evaluate(() => globalThis.testPerchedAvatar.raiseOverlay());
    const after = nativeStacking((await info(overlayUrl)).windowId, state.windowId);
    assert.equal(
      after.foreground,
      order.foreground,
      'Restacking preserves the current keyboard focus, even if Windows refused a fixture focus request',
    );
    assert.notEqual(after.foreground, (await info(overlayUrl)).windowId);
    assert.equal(
      await app.evaluate(() => globalThis.testTopmostFixture.isFocused()),
      state.focused,
    );
    await app.evaluate(() => globalThis.testTopmostFixture.destroy());
  }
  await send('Сядь на окно настроек');
  overlay = await assertSeat();
  await position({ ...initial, x: initial.x + 90, y: initial.y - 40, width: initial.width - 70 });
  overlay = await assertSeat();
  await settings.locator('#settings-window-close').evaluate((button) => button.click());
  for (let i = 0; i < 100 && (await info(settingsUrl)).visible; i++) await page.waitForTimeout(50);
  assert.equal(
    (await info(settingsUrl)).visible,
    false,
    'Closing Settings hides its reusable window',
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === 'capri://desktop/avatar-detach.html',
    );
    for (let i = 0; i < 160 && target?.isVisible(); i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (target?.isVisible()) throw new Error('Avatar did not hide with Settings');
  });
  await settingsView(app, 'general');
  overlay = await assertSeat();
  if (process.argv.includes('--stacking')) await assertAboveSettings();
  if (process.argv.includes('--drag-restore')) {
    const waitState = async (visible) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await app.evaluate(() => {
          const avatar = globalThis.testPerchedAvatar;
          return {
            visible: avatar.overlay.isVisible(),
            pointer: Boolean(avatar.pointerTimer),
            ignored: avatar.overlay.testIgnoresMouse,
            press: Boolean(avatar.press),
          };
        });
        if (state.visible === visible && state.pointer === visible) return state;
        await page.waitForTimeout(50);
      }
      throw new Error('Perched avatar did not restore its pointer tracking');
    };
    for (let iteration = 0; iteration < 2; iteration++) {
      if (iteration) {
        await send('Sit on the Settings window');
        overlay = await assertSeat();
      }
      const grab = await app.evaluate(({ screen }) => {
        const avatar = globalThis.testPerchedAvatar;
        const rect = avatar.spriteRect();
        for (let v = 0.3; v <= 0.7; v += 0.05)
          for (let u = 0.3; u <= 0.7; u += 0.05) {
            const point = {
              x: Math.round(rect.x + rect.width * u),
              y: Math.round(rect.y + rect.height * v),
            };
            if (!avatar.canGrab(point)) continue;
            globalThis.testAvatarCursor = {
              x: avatar.session.area.x + point.x,
              y: avatar.session.area.y + point.y,
            };
            screen.getCursorScreenPoint = () => globalThis.testAvatarCursor;
            avatar.verification = false;
            avatar.startPointer();
            return point;
          }
        throw new Error('No grab point on seated Capri');
      });
      await overlay.mouse.move(grab.x, grab.y);
      await overlay.mouse.down();
      assert.equal(await app.evaluate(() => Boolean(globalThis.testPerchedAvatar.press)), true);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((view) => view.webContents.getURL() === 'capri://desktop/settings.html')
          .minimize(),
      );
      const hidden = await waitState(false);
      assert.equal(hidden.ignored, true);
      assert.equal(hidden.press, false, 'Minimizing cancels an unfinished LMB hold');
      await overlay.mouse.up();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((view) => view.webContents.getURL() === 'capri://desktop/settings.html')
          .restore(),
      );
      const restored = await waitState(true);
      assert.equal(
        restored.ignored,
        false,
        'A stationary cursor can grab Capri immediately after restore',
      );
      await assertSeat();
      const before = await app.evaluate(() => globalThis.testPerchedAvatar.desktopPoint);
      await app.evaluate(() => {
        const avatar = globalThis.testPerchedAvatar;
        const drop = avatar.onDragDrop;
        avatar.onDragDrop = (...args) => {
          globalThis.testAvatarDrop = args;
          return drop(...args);
        };
      });
      await overlay.mouse.move(grab.x, grab.y);
      await overlay.mouse.down();
      assert.equal(await app.evaluate(() => Boolean(globalThis.testPerchedAvatar.press)), true);
      // Leave the original snap zone; a small move can correctly seat her back
      // on the same edge and look stationary despite a successful drag.
      await overlay.mouse.move(grab.x + 220, grab.y + 200, { steps: 5 });
      await overlay.mouse.up();
      for (let attempt = 0; attempt < 120; attempt++) {
        const moved = await app.evaluate((_electron, before) => {
          const avatar = globalThis.testPerchedAvatar;
          return (
            avatar.available &&
            Math.hypot(avatar.desktopPoint.x - before.x, avatar.desktopPoint.y - before.y) > 30
          );
        }, before);
        if (moved) break;
        if (attempt === 119)
          throw new Error(
            'LMB drag did not move Capri after restore: ' +
              JSON.stringify(
                await app.evaluate(() => ({
                  phase: globalThis.testPerchedAvatar.phase,
                  current: globalThis.testPerchedAvatar.desktopPoint,
                  press: globalThis.testPerchedAvatar.press,
                  drop: globalThis.testAvatarDrop,
                  ownerVisible: globalThis.testPerchedAvatar.owner.isVisible(),
                  ownerMinimized: globalThis.testPerchedAvatar.owner.isMinimized(),
                })),
              ),
          );
        await page.waitForTimeout(50);
      }
    }
    await send('Sit on the Settings window');
    overlay = await assertSeat();
  }
  await overlay.screenshot({ path: path.join(fixture, 'settings-perch-avatar.png') });
  await settings.screenshot({ path: path.join(fixture, 'settings-perch-window.png') });

  const target = await info(settingsUrl);
  for (const url of [ownerUrl, overlayUrl]) {
    const excluded = await info(url);
    const result = await callApplicationBridge(root, {
      action: 'avatar_window',
      ignoreProcessId: target.processId,
      allowedWindowId: target.windowId,
      windowId: excluded.windowId,
    });
    assert.equal(result.windowId, null, 'Only Settings may bypass the same-process exclusion');
  }
  assert.equal(
    (
      await callApplicationBridge(root, {
        action: 'avatar_window',
        ignoreProcessId: target.processId,
        windowId: target.windowId,
      })
    ).windowId,
    null,
  );

  await chooseMenu('Return to frame');
  await page.waitForFunction(
    () => window.__detachPhases.at(-1) === 'attached' && !document.body.dataset.avatarArriving,
  );
  const native = await nativeSettings();
  const cursor = await app.evaluate(
    ({ screen }, native) =>
      screen.screenToDipPoint({ x: Math.round(native.x + native.width * 0.5), y: native.y }),
    native,
  );
  await app.evaluate(({ screen }, point) => {
    screen.getCursorScreenPoint = () => point;
  }, cursor);
  await chooseMenu('Teleport Capri');
  await page.waitForFunction(() => window.__detachPhases.at(-1) === 'detached');
  overlay = await assertSeat(0.5);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/settings.html')
      .destroy(),
  );
  await overlay.waitForFunction(
    () => !document.querySelector('#parked-avatar img').src.endsWith('/pose-sit-edge.png'),
    undefined,
    { timeout: 8000 },
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Settings command and menu perching, movement, resize, close/reopen, destruction and same-process exclusions.' +
      (process.argv.includes('--drag-restore')
        ? ' Repeated minimize/restore reinstates LMB drag and native mouse hit testing.'
        : '') +
      (process.argv.includes('--stacking')
        ? ' Native avatar z-order stays above Settings and another topmost app without taking keyboard focus.'
        : ''),
  );
  console.log('Settings perch screenshots: ' + fixture);
} finally {
  try {
    if (app) await app.close();
  } finally {
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
  }
}
