// SPDX-License-Identifier: GPL-3.0-only
// Owned normal WinForms window + TopMost Electron owner. No user applications,
// screenshots, provider requests, clipboard or personal files are involved.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

const parent = path.join(root, '.runtime/control-window-layer-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const executable = path.join(folder, 'NormalApplicationFixture.exe');
const log = path.join(folder, 'input.log');
const probeFile = path.join(folder, 'WindowLayerProbe.cs'),
  probeExe = path.join(folder, 'WindowLayerProbe.exe');
const framework = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319');
execFileSync(
  path.join(framework, 'csc.exe'),
  [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/out:' + executable,
    path.join(root, 'tools/verify/native/ComputerControlFixture.cs'),
  ],
  { windowsHide: true },
);
writeFileSync(
  probeFile,
  `using System;using System.Runtime.InteropServices;
class WindowLayerProbe{
[StructLayout(LayoutKind.Sequential)]struct Point{public int X,Y;}
[DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point p);
[DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint f);
[DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll")]static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
[DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
static void Main(string[] a){SetThreadDpiAwarenessContext(new IntPtr(-4));var owned=new IntPtr(long.Parse(a[2]));uint expected;GetWindowThreadProcessId(owned,out expected);if(expected!=uint.Parse(a[3]))throw new Exception("Owned fixture changed");SetWindowPos(owned,IntPtr.Zero,0,0,0,0,0x13);var window=GetAncestor(WindowFromPoint(new Point{X=int.Parse(a[0]),Y=int.Parse(a[1])}),2);uint pid;GetWindowThreadProcessId(window,out pid);Console.WriteLine("{\\"windowId\\":\\""+window.ToInt64()+"\\",\\"processId\\":"+pid+"}");}}
`,
);
execFileSync(
  path.join(framework, 'csc.exe'),
  ['/nologo', '/target:exe', '/platform:x64', '/out:' + probeExe, probeFile],
  { windowsHide: true },
);
let child;
const report = {
  passed: false,
  ownerApplicationsTouched: false,
  screenshotsCaptured: false,
  checks: [],
};
let application;
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const env = {
    ...process.env,
    CAPRI_DESKTOP_VERIFICATION_DIR: folder,
    CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
    CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
    CAPRI_DESKTOP_VERIFICATION_WAKE: '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });
  child = spawn(executable, [log, '--normal-layer'], { windowsHide: false, stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await callApplicationBridge(root, { action: 'catalog_launch', executable });
  const target = await callApplicationBridge(root, { action: 'computer_state' });
  assert.equal(Number(target.processId), child.pid);
  const button = target.untrustedControls.find(
    (item) => item.untrustedName === 'Verification click',
  );
  assert(button);
  await application.evaluate(
    async ({ BrowserWindow, screen }, { root, x, y }) => {
      const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
      const { ControlWindowLayer } = require(root + '/apps/desktop/main/control-window-layer.mjs');
      const center = screen.screenToDipPoint({ x, y });
      globalThis.owner = new BrowserWindow({
        title: 'Capri isolated layer fixture',
        x: center.x - 110,
        y: center.y - 50,
        width: 220,
        height: 100,
        frame: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      globalThis.preferences = { saved: true };
      globalThis.preferenceEvents = [];
      globalThis.layer = new ControlWindowLayer({
        getWindow: () => owner,
        desired: () => preferences.preview ?? preferences.saved,
      });
      owner.on('always-on-top-changed', () => {
        if (!layer.active) preferenceEvents.push(owner.isAlwaysOnTop());
      });
      globalThis.settings = new BrowserWindow({
        parent: owner,
        title: 'Capri Settings layer fixture',
        width: 120,
        height: 80,
        x: center.x + 200,
        y: center.y,
        show: false,
        alwaysOnTop: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      owner.on('always-on-top-changed', () => settings.setAlwaysOnTop(owner.isAlwaysOnTop()));
      await owner.loadURL(
        'data:text/html,<body style="margin:0;background:rgb(234,40,155);color:white">Capri owner covers the fixture button</body>',
      );
      owner.showInactive();
    },
    { root, x: button.x, y: button.y },
  );
  const ownerPid = await application.evaluate(() => process.pid);
  const hit = () =>
    JSON.parse(
      execFileSync(
        probeExe,
        [String(button.x), String(button.y), target.windowId, target.processId],
        { windowsHide: true, encoding: 'utf8' },
      ),
    );
  assert.equal(hit().processId, ownerPid);
  assert(!readFileSync(log, 'utf8').includes('\nclick\n'));
  report.checks.push(
    'Native WindowFromPoint confirms TopMost Capri covers the normal app target even though the normal app is at the top of its own z-order band',
  );
  await application.evaluate(() => layer.begin());
  assert.deepEqual(
    await application.evaluate(() => ({
      owner: owner.isAlwaysOnTop(),
      settings: settings.isAlwaysOnTop(),
      saved: preferences.saved,
      events: preferenceEvents,
    })),
    { owner: false, settings: false, saved: true, events: [] },
  );
  assert.deepEqual(hit(), { windowId: target.windowId, processId: child.pid });
  assert(!readFileSync(log, 'utf8').includes('\nclick\n'));
  report.checks.push(
    'Temporary owner/Settings lowering exposes the actual normal-layer HWND at the target point, without a click, focus request or screenshot',
  );
  await application.evaluate(() => layer.end());
  assert.deepEqual(
    await application.evaluate(() => ({
      owner: owner.isAlwaysOnTop(),
      settings: settings.isAlwaysOnTop(),
      saved: preferences.saved,
      events: preferenceEvents,
    })),
    { owner: true, settings: true, saved: true, events: [true] },
  );
  await application.evaluate(() => {
    layer.begin();
    preferences.saved = false;
    layer.sync();
    layer.end();
  });
  assert.equal(await application.evaluate(() => owner.isAlwaysOnTop()), false);
  await application.evaluate(() => {
    layer.begin();
    preferences.preview = true;
    layer.sync();
    layer.end();
  });
  assert.equal(await application.evaluate(() => owner.isAlwaysOnTop()), true);
  assert.equal(await application.evaluate(() => preferences.saved), false);
  report.checks.push(
    'End/cancel restores the latest saved/draft preference, not the old value; no false unpin event is published',
  );
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await application?.close();
  child?.kill();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(folder, 'report.json'));
}
console.log(JSON.stringify(report));
