// SPDX-License-Identifier: GPL-3.0-only
// Own disposable windows only. No OS mouse movement, button input, keys or API calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

assert.equal(process.platform, 'win32');
const sourceRoot = path.resolve(process.argv[2] ?? root);
const parent = path.join(sourceRoot, '.runtime/avatar-native-show');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const copy = path.join(sourceRoot, 'apps/desktop/.avatar-native-show-' + randomUUID() + '.mjs');
const title = 'Capri owned visibility target ' + randomUUID().slice(0, 8);
const report = {
  passed: false,
  folder,
  nativeInput: false,
  ownerDataAccessed: false,
  modelPosts: 0,
  samples: [],
};
let main = readFileSync(path.join(sourceRoot, 'apps/desktop/main.mjs'), 'utf8');
assert(main.includes("!verification && process.platform === 'win32'"));
main = main.replace(
  "!verification && process.platform === 'win32'",
  "process.platform === 'win32'",
);
const start = main.indexOf('avatarDetach = new AvatarDetach({');
const end = main.indexOf('\n  });', start);
assert(start >= 0 && end > start);
const constructor = main.slice(start, end);
assert.equal((constructor.match(/\bverification,/gu) ?? []).length, 1);
main =
  main.slice(0, start) +
  constructor
    .replace(
      'avatarDetach = new AvatarDetach({',
      'avatarDetach = globalThis.fixtureAvatar = new AvatarDetach({',
    )
    .replace(/\bverification,/u, 'verification: false,') +
  main.slice(end);
main +=
  '\nglobalThis.fixturePerch = () => perch && ({ hidden: perch.hidden, seated: perch.seated, seatPoint: perch.seatPoint, pending: perch.pending });\n';
writeFileSync(copy, main);
const entry = path.join(folder, 'entry.mjs');
writeFileSync(
  entry,
  `
import { DesktopTeleportMenu } from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'apps/desktop/main/desktop-teleport-menu.mjs')).href)};
const show = DesktopTeleportMenu.prototype.show;
DesktopTeleportMenu.prototype.show = function (...args) { this.run = () => ({status:0,stdout:''}); return show.apply(this,args); };
await import(${JSON.stringify(pathToFileURL(copy).href)});
`,
);
const targetEntry = path.join(folder, 'target.cjs');
writeFileSync(
  targetEntry,
  `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(folder, 'target-profile'))});
app.whenReady().then(async()=>{const w=new BrowserWindow({x:240,y:360,width:700,height:470,title:${JSON.stringify(title)},show:false,webPreferences:{sandbox:true}});await w.loadURL('data:text/html,<title>${title}</title><h1>Owned visibility target</h1>');w.showInactive();});
`,
);
const server = createServer((request, response) => {
  if (request.method === 'POST') report.modelPosts++;
  response.setHeader('content-type', 'application/json').end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let app, target, page, ownedPid, ownedHwnd, probePoint;
const poll = async (callback, label) => {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (await callback()) return;
    await delay(25);
  }
  throw new Error(label);
};
function native(show = false, move = false) {
  assert.match(ownedHwnd, /^\d+$/u);
  assert(Number.isInteger(ownedPid) && ownedPid > 0);
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OwnVisibility {
 public delegate bool EnumProc(IntPtr w, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr w,int c);
 [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr w,uint m,IntPtr p,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr w);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
 [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr w,int i);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr w,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr w,EnumProc e,IntPtr p);
 public static string Class(IntPtr w){var b=new StringBuilder(256);GetClassNameW(w,b,256);return b.ToString();}
 public static List<object> Children(IntPtr w){var a=new List<object>();EnumChildWindows(w,(c,p)=>{a.Add(new {hwnd=c.ToInt64().ToString(),name=Class(c),visible=IsWindowVisible(c),enabled=IsWindowEnabled(c),style=GetWindowLongW(c,-16),exStyle=GetWindowLongW(c,-20)});return true;},IntPtr.Zero);return a;}
}
'@
$w=[IntPtr]::new([long]${ownedHwnd}); $p=[uint32]0
[void][OwnVisibility]::GetWindowThreadProcessId($w,[ref]$p)
if ($p -ne ${ownedPid}) { throw 'Fixture HWND identity changed' }
${show ? '[void][OwnVisibility]::ShowWindow($w,4)' : ''}
${move ? `[void][OwnVisibility]::PostMessageW($w,512,[IntPtr]::Zero,[IntPtr]::new([long]${(probePoint.y << 16) | (probePoint.x & 65535)}))` : ''}
[pscustomobject]@{hwnd=$w.ToInt64().ToString();pid=$p;visible=[OwnVisibility]::IsWindowVisible($w);enabled=[OwnVisibility]::IsWindowEnabled($w);minimized=[OwnVisibility]::IsIconic($w);style=[OwnVisibility]::GetWindowLongW($w,-16);exStyle=[OwnVisibility]::GetWindowLongW($w,-20);children=[OwnVisibility]::Children($w)} | ConvertTo-Json -Depth 5 -Compress
`;
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    }),
  );
}
async function capture(label) {
  const beforeMoves = await app.evaluate(() => globalThis.fixtureMouseMoves ?? 0);
  native(false, true);
  await delay(120);
  const state = await app.evaluate(async () => {
    const a = globalThis.fixtureAvatar;
    const renderer = await a.overlay.webContents.executeJavaScript(
      `(() => {const e=document.getElementById('parked-avatar');const i=e.querySelector('img');const r=e.getBoundingClientRect();return {hidden:document.hidden,visibility:document.visibilityState,parkedHidden:e.hidden,display:getComputedStyle(e).display,rect:{x:r.x,y:r.y,width:r.width,height:r.height},imageLoaded:i.complete&&i.naturalWidth>0,events:globalThis.fixtureVisibilityEvents};})()`,
    );
    return {
      visible: a.overlay.isVisible(),
      minimized: a.overlay.isMinimized(),
      pointer: Boolean(a.pointerTimer),
      accepts: a.acceptsPointer,
      available: a.available,
      phase: a.phase,
      point: a.session.point,
      spriteRect: a.spriteRect(),
      perch: globalThis.fixturePerch(),
      renderer,
      mouseMoves: globalThis.fixtureMouseMoves ?? 0,
      normalShows: globalThis.fixtureNormalShows ?? 0,
    };
  });
  const sample = { label, state, routedMoves: state.mouseMoves - beforeMoves, native: native() };
  report.samples.push(sample);
  return sample;
}
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
    CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = createRequire(path.join(sourceRoot, 'package.json'))('electron');
  target = await _electron.launch({ executablePath, args: [targetEntry], env, timeout: 30000 });
  app = await _electron.launch({
    executablePath,
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html'),
    );
    owner.showInactive();
    owner.webContents.send('capri:event', { type: 'startup-intro.skip' });
  });
  await page.evaluate(
    (text) =>
      window.capri.send({ id: crypto.randomUUID(), text, thinking: false, internet: false }),
    'Sit on the ' + title + ' window',
  );
  await poll(
    () =>
      app.evaluate(
        () =>
          globalThis.fixtureAvatar?.available &&
          globalThis.fixturePerch()?.seated &&
          globalThis.fixtureAvatar.overlay?.isVisible(),
      ),
    'Owned perch did not settle',
  );
  ({
    pid: ownedPid,
    hwnd: ownedHwnd,
    point: probePoint,
  } = await app.evaluate(({ screen }) => {
    const a = globalThis.fixtureAvatar,
      bounds = a.overlay.getBounds(),
      rect = a.spriteRect();
    const origin = screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
    const point = screen.dipToScreenPoint({
      x: a.session.area.x + rect.x + rect.width / 2,
      y: a.session.area.y + rect.y + rect.height / 3,
    });
    const local = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 3 };
    globalThis.fixtureMouseMoves = 0;
    a.overlay.webContents.on('before-mouse-event', (_event, input) => {
      if (
        input.type === 'mouseMove' &&
        Math.abs(input.x - local.x) < 3 &&
        Math.abs(input.y - local.y) < 3
      )
        globalThis.fixtureMouseMoves++;
    });
    globalThis.fixtureNormalShows = 0;
    const normalShow = a.overlay.showInactive.bind(a.overlay);
    a.overlay.showInactive = (...args) => {
      globalThis.fixtureNormalShows++;
      return normalShow(...args);
    };
    return {
      pid: process.pid,
      hwnd: String(a.overlay.getNativeWindowHandle().readBigUInt64LE()),
      point: { x: Math.round(point.x - origin.x), y: Math.round(point.y - origin.y) },
    };
  }));
  await app.evaluate(async () => {
    await globalThis.fixtureAvatar.overlay.webContents.executeJavaScript(
      `globalThis.fixtureVisibilityEvents=[];document.addEventListener('visibilitychange',()=>globalThis.fixtureVisibilityEvents.push({at:Date.now(),state:document.visibilityState}));`,
    );
  });
  await delay(250);
  const baseline = await capture('baseline');
  assert(baseline.routedMoves > 0, 'Baseline native mouse-move message must reach the renderer');
  await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await poll(
    () => app.evaluate(() => !globalThis.fixtureAvatar.overlay.isVisible()),
    'Owned Avatar did not hide',
  );
  const hidden = await capture('host-hidden');
  assert.equal(hidden.routedMoves, 0, 'Hidden content must not receive native mouse moves');
  report.rawShowResult = native(true);
  const rawShown = await capture('avatar-externally-shown-before-host');
  assert.equal(rawShown.state.visible, true);
  assert.equal(
    rawShown.state.pointer,
    true,
    'Native showing must reproduce an already running pointer timer',
  );
  assert.equal(
    rawShown.state.normalShows,
    0,
    'The raw native show must bypass Chromium normal show',
  );
  assert.equal(
    rawShown.routedMoves,
    0,
    'Raw native showing must reproduce hidden content input routing',
  );
  await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await poll(
    () =>
      app.evaluate(
        () =>
          globalThis.fixturePerch()?.hidden === false &&
          globalThis.fixtureAvatar.overlay.isVisible() &&
          Boolean(globalThis.fixtureAvatar.pointerTimer),
      ),
    'Host restore did not restart pointer',
  );
  const restored = await capture('host-restored-production-recovery');
  assert(
    restored.state.normalShows > 0,
    'Host restore must use Chromium normal show despite an already visible HWND',
  );
  assert(
    restored.routedMoves > 0,
    'Normal host restore must repair native mouse routing without manual recovery',
  );
  assert.deepEqual(restored.state.renderer.rect, baseline.state.renderer.rect);
  assert.equal(restored.state.renderer.imageLoaded, true);
  assert.equal(report.modelPosts, 0, 'No model request is permitted');
  report.passed = true;
  report.checks = [
    'Baseline native move reaches renderer',
    'Raw native show reproduces input loss with a live pointer timer',
    'Host restore repairs input through normal Chromium show',
    'Loaded image geometry stays unchanged',
    'No OS mouse input or API requests',
  ];
  report.conclusion = 'Production host restore repaired input without a manual recovery call.';
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close();
  await target?.close();
  server.close();
  unlinkSync(copy);
  console.log(
    JSON.stringify({
      folder,
      passed: report.passed,
      error: report.error,
      samples: report.samples.map(({ label, state, routedMoves }) => ({
        label,
        visible: state.visible,
        pointer: state.pointer,
        routedMoves,
        renderer: state.renderer,
      })),
    }),
  );
}
