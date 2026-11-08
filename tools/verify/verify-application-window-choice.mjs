// SPDX-License-Identifier: GPL-3.0-only
// Native activation only, against three generated disposable windows. No owner
// application receives text, keyboard shortcuts, clicks or activation requests.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { chooseApplicationWindow } from '../../apps/desktop/application-window-choice.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

assert.equal(process.platform, 'win32', 'This optional verification requires Windows.');
const parent = path.join(root, '.runtime/application-window-choice-verification');
mkdirSync(parent, { recursive: true });
mkdirSync(path.join(root, '.runtime/tmp'), { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const source = path.join(folder, 'WindowFixture.cs');
const executable = path.join(folder, 'OwnedWindowFixture.exe');
const otherExecutable = path.join(folder, 'OtherOwnedFixture.exe');
const environment = { ...process.env, TEMP: folder, TMP: folder };
const owned = [];
const report = {
  passed: false,
  folder,
  ownerApplicationsTouched: false,
  inputSent: false,
  checks: [],
};

writeFileSync(
  source,
  `using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
class WindowFixture {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [STAThread] static void Main(string[] args) {
    var json = new JavaScriptSerializer();
    if (args.Length == 1 && args[0] == "--foreground") {
      var window = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(window, out pid);
      Console.WriteLine(json.Serialize(new { windowId=window.ToInt64().ToString(), processId=pid }));
      return;
    }
    var form = new Form { Text=args[1], Width=460, Height=200 };
    form.Controls.Add(new Label { Text="Capri disposable window selection verification", AutoSize=true, Left=20, Top=25 });
    form.Shown += (s,e) => {
      SetForegroundWindow(form.Handle);
      File.WriteAllText(args[0], json.Serialize(new {
        windowId=form.Handle.ToInt64().ToString(),
        processId=Process.GetCurrentProcess().Id
      }));
    };
    var timer = new Timer { Interval=60000 }; timer.Tick += (s,e) => form.Close(); timer.Start();
    Application.Run(form);
  }
}
`,
);

const foreground = () =>
  JSON.parse(
    execFileSync(executable, ['--foreground'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
      env: environment,
    }),
  );

async function start(exe, name) {
  const ready = path.join(folder, name + '.json');
  const child = spawn(exe, [ready, 'Capri owned verification ' + name], {
    windowsHide: false,
    stdio: 'ignore',
    env: environment,
  });
  owned.push(child);
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  for (let attempt = 0; attempt < 60 && !existsSync(ready); attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error('Owned fixture exited before its window was ready.');
    await delay(100);
  }
  assert(existsSync(ready), 'Owned fixture did not create a window.');
  const window = JSON.parse(readFileSync(ready, 'utf8'));
  assert.equal(window.processId, child.pid);
  return window;
}

try {
  execFileSync(
    path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      '/r:System.Windows.Forms.dll',
      '/r:System.Drawing.dll',
      '/r:System.Web.Extensions.dll',
      '/out:' + executable,
      source,
    ],
    { windowsHide: true, env: environment, timeout: 20000 },
  );
  copyFileSync(executable, otherExecutable);
  const first = await start(executable, 'first');
  const second = await start(executable, 'second');
  const other = await start(otherExecutable, 'other-foreground');
  const before = await callApplicationBridge(root, {
    action: 'catalog_launch',
    executable: otherExecutable,
    windowId: other.windowId,
  });
  assert.equal(before.windowId, other.windowId);
  assert.equal(before.focused, true, 'The unrelated owned fixture must take focus first.');
  assert.equal(foreground().windowId, other.windowId);

  const initial = await callApplicationBridge(root, { action: 'catalog_launch', executable });
  assert.equal(initial.needsWindow, true);
  assert.equal(initial.inputPerformed, false);
  assert.equal(initial.windows.length, 2);
  assert.deepEqual(
    new Set(initial.windows.map((window) => window.windowId)),
    new Set([first.windowId, second.windowId]),
    'Native selection may expose only the two exact-image owned windows.',
  );
  assert.equal(foreground().windowId, other.windowId, 'Ambiguous launch must not change focus.');
  report.checks.push('real native launch exposes two verified same-image candidates without input');

  for (const action of ['browser_input', 'browser_search', 'open_url'])
    assert.equal(
      chooseApplicationWindow(initial, { action, observedWindowId: other.windowId }),
      null,
    );
  assert.equal(
    chooseApplicationWindow(initial, { action: 'launch', observedWindowId: second.windowId })
      .windowId,
    second.windowId,
  );
  report.checks.push(
    'ambiguous text/navigation remains blocked; observed candidate takes priority',
  );

  const chosen = chooseApplicationWindow(initial, {
    action: 'launch',
    observedWindowId: other.windowId,
  });
  assert.equal(chosen, initial.windows[0]);
  assert([first.windowId, second.windowId].includes(chosen.windowId));
  const launched = await callApplicationBridge(root, {
    action: 'catalog_launch',
    executable,
    windowId: chosen.windowId,
  });
  assert.equal(launched.windowVerified, true);
  assert.equal(launched.focused, true);
  assert.equal(launched.windowId, chosen.windowId);
  assert(owned.some((child) => child.pid === Number(launched.processId)));
  assert.equal(foreground().windowId, chosen.windowId);
  report.checks.push(
    'exact native candidate activation succeeds and actual foreground is verified',
  );
  report.candidateCount = initial.windows.length;
  report.chosenWindowId = chosen.windowId;
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  for (const child of owned) if (child.exitCode === null) child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
