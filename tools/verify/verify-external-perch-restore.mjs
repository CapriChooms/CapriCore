// SPDX-License-Identifier: GPL-3.0-only
// Native cross-process hide/restore and Windows hit routing; isolated Capri state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const sourceRoot = path.resolve(
  process.argv.find((arg, i) => i > 1 && !arg.startsWith('--')) ?? root,
);
const parent = path.join(sourceRoot, '.runtime/external-perch-restore');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const copy = path.join(sourceRoot, 'apps/desktop/.perch-verification-' + randomUUID() + '.mjs');
const report = {
  passed: false,
  checks: [],
  samples: [],
  ownerDataAccessed: false,
  modelStarted: false,
};
const nativeInput = process.argv.includes('--native-input');
report.nativeInput = nativeInput;
// Keep verification isolation, but exercise the production native window tracker.
// The registry writer is stubbed below: no desktop context-menu registration.
const main = readFileSync(path.join(sourceRoot, 'apps/desktop/main.mjs'), 'utf8');
assert(
  main.includes("!verification && process.platform === 'win32'\n".replaceAll('\n', '\r\n')) ||
    main.includes("!verification && process.platform === 'win32'\n"),
);
writeFileSync(
  copy,
  main.replace("!verification && process.platform === 'win32'", "process.platform === 'win32'"),
);
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `
import { AvatarDetach } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'apps/desktop/main/avatar-detach.mjs')).href)};
import { DesktopTeleportMenu } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'apps/desktop/main/desktop-teleport-menu.mjs')).href)};
const show = DesktopTeleportMenu.prototype.show;
DesktopTeleportMenu.prototype.show = function (...args) { this.run = () => ({ status: 0, stdout: '' }); globalThis.testNativeTracker = this; return show.apply(this, args); };
const start = AvatarDetach.prototype.startPointer;
AvatarDetach.prototype.startPointer = function () { globalThis.testAvatar = this; return start.call(this); };
${
  process.argv.includes('--legacy-recovery')
    ? `AvatarDetach.prototype.raiseOverlay = function (overlay = this.overlay) {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return false;
  overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.moveTop(); this.onRaised(); return true;
};`
    : ''
}
await import(${JSON.stringify(pathToFileURL(copy).href)});
`,
);
const targetEntry = path.join(folder, 'target.cjs');
const title = 'Capri external perch verification';
writeFileSync(
  targetEntry,
  `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(folder, 'target-profile'))});
app.whenReady().then(async () => {
const win = new BrowserWindow({x: 240, y: 360, width: 600, height: 420, title: ${JSON.stringify(title)}, webPreferences: {sandbox: true}});
await win.loadURL('data:text/html,<title>${title}</title><h1>Owned external window</h1>');
win.showInactive();
});
`,
);
const server = createServer((_request, response) =>
  response.setHeader('content-type', 'application/json').end('{"data":[]}'),
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let app, target, page;
function native(point, expected, click = false) {
  assert.match(expected, /^\d+$/);
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PerchProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPhysicalPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
 [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int index);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
$p = New-Object PerchProbe+Point
$p.X = ${Math.round(point.x)}; $p.Y = ${Math.round(point.y)}
$expected = [IntPtr]::new([long]${expected})
$old = New-Object PerchProbe+Point
[void][PerchProbe]::GetCursorPos([ref]$old)
if (${click ? '$true' : '$false'}) {
 [void][PerchProbe]::SetCursorPos($p.X,$p.Y)
 Start-Sleep -Milliseconds 100
}
$hit = [PerchProbe]::GetAncestor([PerchProbe]::WindowFromPhysicalPoint($p), 2)
$style = [PerchProbe]::GetWindowLongW($expected, -20)
if (${click ? '$true' : '$false'}) {
 if ($hit -ne $expected) { throw 'Only the owned avatar may receive a test click' }
 try {
  if ([PerchProbe]::GetAncestor([PerchProbe]::WindowFromPhysicalPoint($p),2) -ne $expected) { throw 'Owned input target changed' }
  [PerchProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [PerchProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
 } finally { [void][PerchProbe]::SetCursorPos($old.X,$old.Y) }
}
[pscustomobject]@{hit=$hit.ToInt64().ToString();expected=$expected.ToInt64().ToString();style=$style} | ConvertTo-Json -Compress
`;
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
}
const poll = async (callback, label) => {
  for (let i = 0; i < 200; i++) {
    if (await callback()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(label);
};
try {
  const env = {
    ...process.env,
    TEMP: folder,
    TMP: folder,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_ASR: '0',
    CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = createRequire(import.meta.url)('electron');
  target = await _electron.launch({ executablePath, args: [targetEntry], env, timeout: 30000 });
  app = await _electron.launch({
    executablePath,
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().endsWith('/index.html'))
      .showInactive(),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().endsWith('/index.html'))
      .webContents.send('capri:event', { type: 'startup-intro.skip' }),
  );
  const seat = async () => {
    const before = (await page.evaluate(() => window.capri.bootstrap())).messages.length;
    await page.locator('#message').fill('Sit on the ' + title + ' window');
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    await page.locator('#message').press('Enter');
    await poll(async () => {
      const value = await page.evaluate(() => window.capri.bootstrap());
      return (
        value.messages.length === before + 2 &&
        !value.activeTurnId &&
        value.messages.at(-1).status === 'complete'
      );
    }, 'External perching command did not complete');
    await poll(
      () =>
        app.evaluate(() =>
          Boolean(globalThis.testAvatar?.available && globalThis.testNativeTracker?.windowWatch),
        ),
      'Native external perch not established',
    );
  };
  await seat();
  await app.evaluate(() => {
    const avatar = globalThis.testAvatar;
    avatar.verification = false;
    const headpat = avatar.onHeadpat,
      click = avatar.onClick;
    avatar.onHeadpat = (...args) => {
      globalThis.testPatCount = (globalThis.testPatCount ?? 0) + 1;
      return headpat(...args);
    };
    avatar.onClick = (...args) => {
      globalThis.testClickCount = (globalThis.testClickCount ?? 0) + 1;
      return click(...args);
    };
    const mouse = avatar.mouse;
    globalThis.testMouseEvents = [];
    avatar.mouse = function (input) {
      if (input.type !== 'mouseMove')
        globalThis.testMouseEvents.push({
          ...input,
          frame: this.session?.spriteUrl,
          point: this.session?.point,
          canGrab: this.canGrab(input),
          kind: this.spriteTarget(input),
        });
      return mouse.call(this, input);
    };
    avatar.startPointer();
  });
  for (let cycle = 0; cycle < 5; cycle++) {
    if (cycle) {
      await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
      await poll(
        () => app.evaluate(() => !globalThis.testAvatar.overlay.isVisible()),
        'Avatar must hide with external window',
      );
      await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await poll(
        () => app.evaluate(() => globalThis.testAvatar.overlay.isVisible()),
        'Avatar must return with external window',
      );
    }
    const state = await app.evaluate(({ screen }) => {
      const avatar = globalThis.testAvatar;
      const rect = avatar.spriteRect();
      for (let v = 0.1; v <= 0.6; v += 0.02)
        for (let u = 0.15; u <= 0.8; u += 0.02) {
          const p = {
            x: Math.round(rect.x + rect.width * u),
            y: Math.round(rect.y + rect.height * v),
          };
          if (!avatar.canGrab(p) || avatar.spriteTarget(p) !== 'head') continue;
          globalThis.testCursor = {
            x: p.x + avatar.session.area.x,
            y: p.y + avatar.session.area.y,
          };
          const handle = avatar.overlay.getNativeWindowHandle();
          return {
            point: screen.dipToScreenPoint(globalThis.testCursor),
            windowId: String(handle.readBigUInt64LE()),
            pointer: !!avatar.pointerTimer,
            accepts: avatar.acceptsPointer,
            frame: avatar.session.spriteUrl,
            headpats: globalThis.testPatCount ?? 0,
          };
        }
      throw Error('No head hitbox');
    });
    await page.waitForTimeout(200);
    if (nativeInput) {
      const hit = native(state.point, state.windowId, true);
      report.samples.push({ cycle, ...state, native: hit });
      assert.equal(
        hit.hit,
        hit.expected,
        'Windows must route the real head click to Capri after restore',
      );
      await poll(
        () => app.evaluate((_, before) => (globalThis.testPatCount ?? 0) > before, state.headpats),
        'Native headpat event missing',
      );
      report.checks.push('Native headpat after restore cycle ' + cycle);
    } else {
      // Do not move the user's mouse. Corrupt the owned HWND's native style
      // while its JS hover cache still says "interactive", then inspect the
      // actual Windows route after the existing recovery heartbeat.
      await app.evaluate(({ screen }) => {
        const avatar = globalThis.testAvatar;
        globalThis.originalCursor = screen.getCursorScreenPoint;
        screen.getCursorScreenPoint = () => globalThis.testCursor;
        avatar.updatePointer();
        avatar.overlay.setIgnoreMouseEvents(true);
      });
      await page.waitForTimeout(850);
      try {
        const hit = native(state.point, state.windowId);
        report.samples.push({ cycle, ...state, native: hit });
        assert.equal(
          hit.hit,
          hit.expected,
          'The recovery heartbeat must restore the actual Windows hit route',
        );
        const overlay = app.windows().find((view) => view.url().endsWith('/avatar-detach.html'));
        const local = await app.evaluate(() => ({
          x: globalThis.testCursor.x - globalThis.testAvatar.session.area.x,
          y: globalThis.testCursor.y - globalThis.testAvatar.session.area.y,
        }));
        await overlay.mouse.click(local.x, local.y);
        await poll(
          () =>
            app.evaluate((_, before) => (globalThis.testPatCount ?? 0) > before, state.headpats),
          'Headpat event missing after restore',
        );
        report.checks.push('Windows hit route and renderer headpat after restore cycle ' + cycle);
        const before = await app.evaluate(() => globalThis.testAvatar.desktopPoint);
        await overlay.mouse.move(local.x, local.y);
        await overlay.mouse.down();
        assert(
          await app.evaluate(() => !!globalThis.testAvatar.press),
          'LMB hold must reach the restored avatar',
        );
        await app.evaluate(() => {
          globalThis.testCursor = {
            x: globalThis.testCursor.x + 180,
            y: globalThis.testCursor.y + 170,
          };
        });
        await overlay.mouse.move(local.x + 180, local.y + 170, { steps: 5 });
        await overlay.mouse.up();
        await poll(
          () =>
            app.evaluate((_, before) => {
              const avatar = globalThis.testAvatar;
              return (
                avatar.available &&
                Math.hypot(avatar.desktopPoint.x - before.x, avatar.desktopPoint.y - before.y) > 30
              );
            }, before),
          'LMB teleport did not finish after restore',
        );
        report.checks.push('LMB teleport after restore cycle ' + cycle);
      } finally {
        await app.evaluate(({ screen }) => {
          screen.getCursorScreenPoint = globalThis.originalCursor;
          globalThis.testAvatar.updatePointer(true);
        });
      }
      if (cycle < 4) await seat();
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  if (app)
    report.state = await app
      .evaluate(() => {
        const avatar = globalThis.testAvatar;
        return (
          avatar && {
            available: avatar.available,
            phase: avatar.phase,
            visible: avatar.overlay?.isVisible(),
            pointer: !!avatar.pointerTimer,
            accepts: avatar.acceptsPointer,
            press: avatar.press,
            frame: avatar.session?.spriteUrl,
            point: avatar.session?.point,
            area: avatar.session?.area,
            events: globalThis.testMouseEvents,
          }
        );
      })
      .catch(() => null);
  throw error;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
  await target?.close();
  server.close();
  rmSync(copy, { force: true });
  console.log(JSON.stringify({ folder, ...report }));
}
