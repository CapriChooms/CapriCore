// SPDX-License-Identifier: GPL-3.0-only
// Opt-in real public-homepage verification, with a disposable Chrome profile and
// deterministic decisions. No model/provider call or owner tab is used.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { browserNavigationObstacle } from '../../apps/desktop/browser-search-state.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

assert.equal(process.platform, 'win32', 'This optional verification requires Windows.');
const browser = [
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.LOCALAPPDATA,
]
  .filter(Boolean)
  .map((base) => path.join(base, 'Google/Chrome/Application/chrome.exe'))
  .find(existsSync);
assert(browser, 'Chrome is required for this optional verification.');
const parent = path.join(root, '.runtime/youtube-navigation-verification');
mkdirSync(parent, { recursive: true });
mkdirSync(path.join(root, '.runtime/tmp'), { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const profile = path.join(folder, 'chrome-profile');
const title = 'Capri YouTube navigation fixture ' + path.basename(folder);
const environment = { ...process.env, TEMP: folder, TMP: folder };
const probeSource = path.join(folder, 'WindowProbe.cs');
const probe = path.join(folder, 'WindowProbe.exe');
const report = {
  passed: false,
  status: 'running',
  folder,
  realBrowserUsed: true,
  modelUsed: false,
  ownerTabsTouched: false,
  videoOrAccountAction: false,
  actions: [],
};
let windowId, processId, startedAtTicks, child, control, catalog;
const deadline = new AbortController();
const timeout = setTimeout(
  () => deadline.abort(Error('YouTube verification deadline reached.')),
  45000,
);
const signal = deadline.signal;

writeFileSync(
  probeSource,
  `using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
class WindowProbe {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
  static void Main(string[] args) {
    if(args.Length==4 && args[0]=="--close") {
      var window=new IntPtr(Int64.Parse(args[1])); uint pid; GetWindowThreadProcessId(window,out pid);
      if(pid!=UInt32.Parse(args[2]))return;
      try { using(var process=Process.GetProcessById((int)pid)) {
        if(process.StartTime.ToUniversalTime().Ticks.ToString()==args[3])PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero);
      }} catch(ArgumentException){} catch(InvalidOperationException){}
      return;
    }
    var foreground=GetForegroundWindow();uint owner;GetWindowThreadProcessId(foreground,out owner);
    Console.WriteLine(new JavaScriptSerializer().Serialize(new {windowId=foreground.ToInt64().ToString(),processId=owner}));
  }
}`,
);

const foreground = () =>
  JSON.parse(
    execFileSync(probe, [], {
      windowsHide: true,
      env: environment,
      encoding: 'utf8',
      timeout: 5000,
    }),
  );
const requireOwnedForeground = () => {
  signal.throwIfAborted();
  const live = foreground();
  if (live.windowId !== windowId || Number(live.processId) !== Number(processId)) {
    report.status = 'foreground_changed';
    deadline.abort(
      Error('Foreground left the owned disposable browser. No further input is allowed.'),
    );
    signal.throwIfAborted();
  }
};
const observeNative = async () => {
  requireOwnedForeground();
  const view = await callApplicationBridge(root, { action: 'computer_state' }, { signal });
  assert.equal(view.windowId, windowId);
  assert.equal(Number(view.processId), Number(processId));
  requireOwnedForeground();
  const address = view.untrustedControls.find((target) => target.browserAddress)?.untrustedValue;
  if (address) report.lastAddress = address;
  report.lastTitle = view.untrustedTitle;
  if (view.untrustedControls.some((target) => /^ERR_[A-Z_]+$/u.test(target.untrustedName ?? '')))
    report.networkErrorObserved = true;
  return view;
};

try {
  execFileSync(
    path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/r:System.Web.Extensions.dll',
      '/out:' + probe,
      probeSource,
    ],
    { windowsHide: true, env: environment, timeout: 20000 },
  );
  child = spawn(
    browser,
    [
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-mode',
      '--force-renderer-accessibility',
      '--autoplay-policy=user-gesture-required',
      '--mute-audio',
      'data:text/html,' +
        encodeURIComponent('<title>' + title + '</title><h1>Owned navigation fixture</h1>'),
    ],
    { windowsHide: false, stdio: 'ignore', env: environment },
  );
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  for (let attempt = 0; attempt < 45 && !windowId; attempt++) {
    signal.throwIfAborted();
    if (launchError) throw launchError;
    await delay(100, undefined, { signal });
    try {
      const view = await callApplicationBridge(
        root,
        {
          action: 'catalog_inspect',
          executable: browser,
          windowTitle: title,
        },
        { signal },
      );
      if (view.windowId) {
        windowId = view.windowId;
        processId = view.processId;
        startedAtTicks = view.startedAtTicks;
      }
    } catch (error) {
      if (error.message !== 'Open the selected application first.') throw error;
    }
  }
  assert(windowId, 'The disposable browser window was not found.');
  assert.equal(Number(processId), child.pid, 'Only the fresh profile process may be used.');
  let focused = await callApplicationBridge(
    root,
    {
      action: 'catalog_launch',
      executable: browser,
      windowId,
    },
    { signal },
  );
  if (!focused.focused) {
    await delay(1000, undefined, { signal });
    focused = await callApplicationBridge(
      root,
      {
        action: 'catalog_launch',
        executable: browser,
        windowId,
      },
      { signal },
    );
  }
  if (!focused.focused) {
    report.status = 'foreground_unavailable';
    throw Error('Windows did not allow the owned disposable Chrome window to take focus.');
  }
  requireOwnedForeground();

  catalog = new DesktopCatalog({
    root,
    state: path.join(folder, 'catalog'),
    fullAccess: () => true,
    currentTurn: () => 'youtube-fixture',
    bridge: async (_root, command, options) => {
      requireOwnedForeground();
      // This private catalog exposes Chrome only. YouTube is a website, not a
      // native application that the fixture is allowed to launch separately.
      if (command.action === 'catalog_discover') return { ok: true, matches: [] };
      assert.equal(command.executable, browser);
      assert.equal(
        command.action,
        'browser_open',
        'This fixture allows only the requested webpage dispatch.',
      );
      assert.equal(command.url, 'https://www.youtube.com/');
      assert(!report.navigationDispatched, 'Never replay an already delivered navigation.');
      // Preserve the production DesktopCatalog/ComputerAgent dispatch while
      // routing Chrome's shell launch to this explicit disposable profile.
      const request = spawn(browser, ['--user-data-dir=' + profile, command.url], {
        windowsHide: true,
        stdio: 'ignore',
        env: environment,
      });
      await new Promise((resolve, reject) => {
        request.once('spawn', resolve);
        request.once('error', reject);
      });
      report.navigationDispatched = true;
      report.actions.push('browser_open');
      await delay(100, undefined, { signal });
      requireOwnedForeground();
      const binding = await callApplicationBridge(
        root,
        {
          action: 'catalog_inspect',
          executable: browser,
          windowId,
        },
        { signal },
      );
      assert.equal(binding.windowId, windowId);
      assert.equal(Number(binding.processId), Number(processId));
      return { ok: true, navigationRequested: true, windowVerified: true, focused: true, windowId };
    },
  });
  catalog.add(browser);
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    currentTurn: () => 'youtube-fixture',
    registerEscape: () => true,
    unregisterEscape() {},
    showBorder: async () => {},
    hideBorder() {},
    timeoutMs: 45000,
    maxSteps: 4,
    capture: async () => {
      throw Error('Native accessible observations only.');
    },
    bridge: async (command, options) => {
      if (command.action === 'computer_release')
        return callApplicationBridge(root, command, options);
      const view = await observeNative();
      if (command.action === 'computer_state') return view;
      assert.equal(
        command.action,
        'computer_click',
        'Only an ordinary Reject all button can receive input.',
      );
      assert.equal(command.windowId, windowId);
      assert(!command.surface, 'Owner taskbar controls are not available to this fixture.');
      const target = view.untrustedControls.find((item) => item.id === command.controlId);
      assert(
        /^(?:Reject all|Reject optional cookies|Отклонить все|Tout refuser|Alle ablehnen)$/iu.test(
          target?.untrustedName ?? '',
        ),
      );
      requireOwnedForeground();
      report.actions.push('reject_optional_cookies');
      return callApplicationBridge(root, command, options);
    },
  });
  const agent = new ComputerAgent({
    control,
    applications: catalog,
    maxDecisions: 24,
    plan: async (context, { review = false } = {}) => {
      const view = context.currentObservation;
      assert.equal(view.window.windowId, windowId);
      const initialPlan = {
        id: 'youtube-ready',
        label: 'Open YouTube',
        successCriterion: 'The official YouTube homepage is visible without a blocking dialog.',
      };
      if (!report.navigationDispatched)
        return {
          action: 'open_url',
          query: 'Google Chrome',
          url: 'https://www.youtube.com/',
          summary: 'Open YouTube.',
          plan: [initialPlan],
        };
      const reject = view.targets.find((target) =>
        /^(?:Reject all|Reject optional cookies|Отклонить все|Tout refuser|Alle ablehnen)$/iu.test(
          target.untrustedLabel ?? '',
        ),
      );
      if (reject)
        return {
          action: 'click',
          targetId: reject.targetId,
          summary: 'Reject optional cookies.',
          plan: [initialPlan],
        };
      const address = view.targets.find((target) => target.browserAddress)?.untrustedValue ?? '';
      let official = false;
      try {
        const url = new URL(/^[a-z]+:\/\//iu.test(address) ? address : 'https://' + address);
        official = /^(?:www\.)?youtube\.com$/iu.test(url.hostname) && url.pathname === '/';
      } catch {}
      const visibleHome = view.targets.some(
        (target) =>
          target.pageContent &&
          /^(?:YouTube|Home|Главная|Search|Поиск|YouTube Home)$/iu.test(
            target.untrustedLabel ?? '',
          ),
      );
      if (
        official &&
        /YouTube/iu.test(view.window.untrustedTitle) &&
        visibleHome &&
        !browserNavigationObstacle(view)
      ) {
        report.homepageVerified = true;
        const step = {
          action: 'finish',
          evidence: view.window.untrustedTitle,
          summary: 'Opened YouTube.',
        };
        if (!review)
          step.verifiedCheckpoints = context.taskPlan.remainingCheckpoints.map(({ id }) => ({
            id,
            evidence: view.window.untrustedTitle,
          }));
        return step;
      }
      if (report.networkErrorObserved) {
        report.status = 'network_blocked';
        return {
          action: 'ask_user',
          summary: 'The public YouTube homepage is unavailable on this network.',
        };
      }
      return { action: 'wait', summary: 'Wait for the requested homepage.' };
    },
  });
  report.result = await agent.run('Open YouTube.', { signal });
  report.diagnostics = agent.diagnostics();
  report.passed =
    report.result.ok === true &&
    report.result.verified === true &&
    report.homepageVerified === true;
  if (report.status === 'running') report.status = report.passed ? 'completed' : 'network_blocked';
  assert.equal(report.passed, true, 'The real public homepage was not verified.');
} catch (error) {
  report.failure = String(error.message).slice(0, 1000);
  if (report.status === 'running')
    report.status = report.navigationDispatched ? 'network_blocked' : 'fixture_failed';
} finally {
  clearTimeout(timeout);
  await control?.stop();
  await catalog?.close();
  if (windowId && processId && startedAtTicks) {
    try {
      execFileSync(probe, ['--close', windowId, String(processId), startedAtTicks], {
        windowsHide: true,
        env: environment,
        timeout: 5000,
      });
    } catch {}
  }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
    if (child.exitCode === null) child.kill();
  }
  const resolvedProfile = path.resolve(profile);
  assert.equal(path.dirname(resolvedProfile), path.resolve(folder));
  assert(path.resolve(folder).startsWith(path.resolve(parent) + path.sep));
  try {
    rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    report.disposableProfileRemoved = true;
  } catch {
    report.disposableProfileRemoved = false;
    report.cleanupFailure = 'The disposable browser profile is still locked.';
  }
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exitCode = report.passed ? 0 : 1;
}
