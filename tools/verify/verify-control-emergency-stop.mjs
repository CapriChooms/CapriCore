// SPDX-License-Identifier: GPL-3.0-only
// Actual main process, broker, overlay and Escape handlers with a local synthetic
// gateway. No observation, application bridge, model or owner-app input is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { computerModeRequest } from '../../apps/desktop/computer-mode-request.mjs';

const parent = path.join(root, '.runtime/control-emergency-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
mkdirSync(path.join(folder, 'desktop'));
writeFileSync(
  path.join(folder, 'desktop/full-computer-access.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: { enabled: true, drives: [] },
  }),
);
const entry = path.join(folder, 'entry.mjs');
writeFileSync(
  entry,
  `
import { globalShortcut } from 'electron';
import { ComputerControl } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/computer-control.mjs')).href)};
import { NativeEscapeStop } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/native-escape-stop.mjs')).href)};
globalThis.__fixtureNativeEscapes = 0;
globalThis.__fixtureGlobalEscapes = 0;
const register = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (accelerator, callback) => register(accelerator, (...args) => {
  if (accelerator === 'Escape') globalThis.__fixtureGlobalEscapes++;
  return callback(...args);
});
const start = NativeEscapeStop.prototype.start;
NativeEscapeStop.prototype.start = function(options) {
  return start.call(this, { ...options, onEscape: (...args) => {
    globalThis.__fixtureNativeEscapes++;
    return options.onEscape(...args);
  } });
};
const begin = ComputerControl.prototype.begin;
ComputerControl.prototype.begin = function(...args) {
  globalThis.__controlFixture = this;
  return begin.apply(this, args);
};
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);
const nativeSource = path.join(folder, 'OwnedEscape.cs');
const nativeExecutable = path.join(folder, 'OwnedEscape.exe');
writeFileSync(
  nativeSource,
  String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
class OwnedEscape {
    [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union data; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint one,uint two,bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
    static void Foreground(uint expected) { uint actual; GetWindowThreadProcessId(GetForegroundWindow(),out actual); if(actual!=expected)throw new Exception("Owned fixture is not foreground."); }
    static void FocusOwned(uint expected,IntPtr owned) {
        uint actual,foreground; uint targetThread=GetWindowThreadProcessId(owned,out actual);
        if(actual!=expected || targetThread==0)throw new Exception("Owned fixture handle mismatch.");
        uint foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out foreground),current=GetCurrentThreadId();
        bool attachForeground=foregroundThread!=0 && foregroundThread!=current && AttachThreadInput(current,foregroundThread,true);
        bool attachTarget=targetThread!=current && targetThread!=foregroundThread && AttachThreadInput(current,targetThread,true);
        try { BringWindowToTop(owned);SetForegroundWindow(owned);SetFocus(owned); }
        finally {
            if(attachTarget)AttachThreadInput(current,targetThread,false);
            if(attachForeground)AttachThreadInput(current,foregroundThread,false);
        }
        for(int i=0;i<10;i++) { GetWindowThreadProcessId(GetForegroundWindow(),out actual);if(actual==expected)return;Thread.Sleep(20); }
        Foreground(expected);
    }
    static void Key(ushort vk,bool up) {
        var input=new Input { type=1, data=new Union { keyboard=new Keyboard { vk=vk, flags=up?2u:0u } } };
        if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1)throw new Win32Exception();
    }
    static int Main(string[] args) {
        var held=new List<ushort>(); bool released=true; string stage="foreground";
        try {
            uint expected=UInt32.Parse(args[0]);
            stage="held-modifier";
            foreach(int key in new[]{0x10,0x11,0x12,0x5b,0x5c,0x1b})
                if((GetAsyncKeyState(key)&0x8000)!=0)throw new Exception("A modifier or Escape is already held.");
            stage="foreground";
            FocusOwned(expected,new IntPtr(Int64.Parse(args[1])));
            try {
                stage="inject-modifiers";
                foreach(ushort key in new ushort[]{0xa2,0xa0,0xa4}) { Key(key,false); held.Add(key); }
                stage="foreground-after-modifiers";
                Foreground(expected);
                stage="inject-escape";
                Key(0x1b,false);held.Add(0x1b);
                Thread.Sleep(160);
            } finally {
                for(int i=held.Count-1;i>=0;i--)try{Key(held[i],true);}catch{released=false;}
            }
            stage="release";
            if(!released)throw new Exception("Fixture key release failed.");
            Console.WriteLine("{\"passed\":true,\"released\":true}");return 0;
        } catch { Console.WriteLine("{\"passed\":false,\"stage\":\""+stage+"\",\"released\":"+(released?"true":"false")+"}");return 1; }
    }
}
`,
);
execFileSync(
  path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  ['/nologo', '/platform:x64', '/target:exe', '/out:' + nativeExecutable, nativeSource],
  { windowsHide: true },
);
const report = { passed: false, checks: [], ownerApplicationsTouched: false, observations: 0 };
const pending = [];
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  for await (const chunk of req) {
    void chunk;
  }
  pending.push(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
async function until(read, accept, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(25);
  }
  throw Error(message);
}
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const credentials = JSON.parse(
    readFileSync(path.join(folder, 'data/secrets/desktop-actions.json'), 'utf8'),
  );
  const status = () =>
    application.evaluate(({ BrowserWindow, globalShortcut }) => ({
      borders: BrowserWindow.getAllWindows().filter(
        (view) =>
          !view.isDestroyed() && view.webContents.getURL().endsWith('/control-overlay.html'),
      ).length,
      escapeRegistered: globalShortcut.isRegistered('Escape'),
      active: globalThis.__controlFixture?.snapshot().active ?? false,
      inputCount: globalThis.__controlFixture?.session?.inputs?.size ?? 0,
    }));
  const ownerText =
    'For this isolated verification, full computer control is authorized, but do not send any keyboard or mouse input.';
  assert.equal(computerModeRequest(ownerText, { fullComputerAccess: true }), null);
  const beginTurn = async () => {
    const count = pending.length;
    const id = randomUUID();
    await page.evaluate(
      ({ id, text }) => {
        window.__controlResult = null;
        void window.capri.send({ id, text }).then(
          () => (window.__controlResult = { done: true }),
          () => (window.__controlResult = { done: true }),
        );
      },
      { id, text: ownerText },
    );
    await until(
      () => pending.length,
      (length) => length > count,
      'Synthetic gateway turn did not start.',
    );
    const response = await fetch(credentials.url + '/action', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + credentials.token, 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'desktop_control',
        id: randomBytes(32).toString('hex'),
        args: { action: 'begin_control', goal: ownerText },
      }),
    });
    const result = await response.json();
    assert.equal(result.ok, true, result.error);
    const active = await until(
      status,
      (value) => value.active && value.borders > 0,
      'Control border did not start.',
    );
    assert.equal(active.escapeRegistered, true);
    assert.equal(active.inputCount, 0);
    return pending.at(-1);
  };
  const stopped = async () => {
    await until(
      status,
      (value) => !value.active && value.borders === 0 && !value.escapeRegistered,
      'Control border or Escape registration survived stop.',
    );
    await page.waitForFunction(() => window.__controlResult?.done === true);
  };
  const failure = await beginTurn();
  failure
    .writeHead(503, { 'content-type': 'application/json' })
    .end('{"error":"Synthetic provider failure"}');
  await stopped();
  report.checks.push(
    'A real gateway failure immediately removes all control borders and Escape registration.',
  );
  await beginTurn();
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    owner.show();
    owner.focus();
    globalThis.__fixtureEscapeEvents = 0;
    owner.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'Escape') globalThis.__fixtureEscapeEvents++;
    });
    owner.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    owner.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await stopped();
  assert.ok(await application.evaluate(() => globalThis.__fixtureEscapeEvents > 0));
  report.checks.push(
    'Escape sent only to Capri WebContents cancels the chat and tears down the active overlay.',
  );
  await beginTurn();
  await application.evaluate(({ BrowserWindow }) => {
    const control = globalThis.__controlFixture;
    clearTimeout(control.session.timer);
    control.session = null;
    const owner = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    owner.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    owner.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await stopped();
  report.checks.push(
    'Focused Escape also removes an orphan overlay with no remaining controller session.',
  );
  await beginTurn();
  const nativeCase = await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    owner.show();
    owner.focus();
    globalThis.__fixtureInputListeners = owner.webContents.listeners('before-input-event');
    owner.webContents.removeAllListeners('before-input-event');
    owner.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape') event.preventDefault();
    });
    return {
      pid: process.pid,
      handle: owner.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      native: globalThis.__fixtureNativeEscapes,
      global: globalThis.__fixtureGlobalEscapes,
    };
  });
  try {
    const gesture = JSON.parse(
      execFileSync(nativeExecutable, [String(nativeCase.pid), nativeCase.handle], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 3000,
      }),
    );
    assert.equal(gesture.passed, true);
    assert.equal(gesture.released, true);
    await stopped();
    const callbacks = await application.evaluate(() => ({
      native: globalThis.__fixtureNativeEscapes,
      global: globalThis.__fixtureGlobalEscapes,
    }));
    assert.equal(callbacks.native, nativeCase.native + 1);
    assert.equal(
      callbacks.global,
      nativeCase.global,
      'The plain Escape accelerator must not receive the modified chord.',
    );
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        const owner = BrowserWindow.getAllWindows().find((view) =>
          view.webContents.getURL().endsWith('/index.html'),
        );
        owner.webContents.removeAllListeners('before-input-event');
        for (const listener of globalThis.__fixtureInputListeners ?? [])
          owner.webContents.on('before-input-event', listener);
        delete globalThis.__fixtureInputListeners;
      })
      .catch(() => {});
  }
  report.checks.push(
    'The independent native watcher catches physical Escape while Ctrl+Shift+Alt are held, without the plain accelerator or focused fallback.',
  );
  report.passed = true;
  console.log(JSON.stringify({ ...report, folder }));
} finally {
  await application?.close().catch(() => {});
  for (const response of pending) if (!response.destroyed) response.end();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
