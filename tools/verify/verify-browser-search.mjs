// SPDX-License-Identifier: GPL-3.0-only
// Real local planner + Chrome + a public search, in a disposable browser profile.
// The bridge exposes ONLY the owned test window and never repairs model arguments.
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { computerPlanner } from '../../apps/desktop/computer-planner.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { captureActiveDisplay } from '../../apps/desktop/native-screenshot.mjs';
import { screenshotDimensions } from '../../apps/desktop/screenshot-files.mjs';
import { computerVision } from '../../apps/desktop/computer-vision.mjs';
import { ControlOverlay } from '../../apps/desktop/main/control-overlay.mjs';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const electron = process.versions.electron ? await import('electron') : null;
if (process.env.CAPRI_VERIFY_DISCORD_PATH)
  assert(electron, 'Taskbar verification requires the real Electron indicator.');
let overlay,
  owner = electron
    ? new electron.BrowserWindow({ show: false, width: 120, height: 120, skipTaskbar: true })
    : null,
  turn = 'browser-task';
const goal = process.env.CAPRI_VERIFY_GOAL ?? 'Прогугли, кто такая Капри в хроме';
const shortcutsOnly = process.env.CAPRI_VERIFY_SHORTCUTS_ONLY === '1';
const fullscreenGoal = /\bfull[ -]?screen\b|на\s+весь\s+экран|полноэкран/iu.test(goal);
const pageSearchGoal = /\bsearch\s+(?:bar|box|field)\b|поле поиска|строку поиска/iu.test(goal);
const browser = [
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.LOCALAPPDATA,
]
  .filter(Boolean)
  .map((dir) => path.join(dir, 'Google/Chrome/Application/chrome.exe'))
  .find(existsSync);
assert(browser, 'Chrome is required for this opt-in verification.');
assert(
  process.env.CAPRI_VERIFY_MODEL && process.env.CAPRI_VERIFY_OLLAMA_URL,
  'Choose the local verification model.',
);
const parent = path.join(root, '.runtime/browser-search-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const title = 'Capri search fixture ' + path.basename(folder);
const child = spawn(
  browser,
  [
    '--user-data-dir=' + path.join(folder, 'profile'),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--force-renderer-accessibility',
    'data:text/html,' +
      encodeURIComponent(
        `<title>${title}</title><input aria-label="Page field" value="unchanged" autofocus>`,
      ),
  ],
  { stdio: 'ignore', windowsHide: false },
);
const report = {
  passed: false,
  folder,
  model: process.env.CAPRI_VERIFY_MODEL,
  ownerTabsTouched: false,
  actions: [],
};
let windowId, catalog, control, returnFrom;
try {
  for (let i = 0; i < 60 && !windowId; i++) {
    await delay(150);
    try {
      const view = await callApplicationBridge(root, {
        action: 'catalog_inspect',
        executable: browser,
      });
      windowId =
        view.windows?.find((w) => w.untrustedTitle.includes(title))?.windowId ??
        (view.untrustedControls?.some((c) => c.name.includes(title)) ? view.windowId : undefined);
    } catch {}
  }
  assert(windowId, 'Disposable browser window was not found.');
  await callApplicationBridge(root, { action: 'catalog_launch', executable: browser, windowId });
  if (process.env.CAPRI_VERIFY_WAIT_FOR_FOCUS === '1') {
    for (let i = 0; i < 120; i++) {
      const live = await callApplicationBridge(root, { action: 'computer_state' });
      if (live.windowId === windowId) break;
      await delay(500);
    }
  }
  catalog = new DesktopCatalog({
    root,
    state: path.join(folder, 'state'),
    fullAccess: () => true,
    currentTurn: () => 'search-fixture',
    bridge: async (_root, command, options) => {
      if (command.action === 'catalog_discover')
        return callApplicationBridge(root, command, options);
      assert(
        ['catalog_launch', 'catalog_inspect', 'browser_input', 'browser_open'].includes(
          command.action,
        ),
      );
      assert.equal(command.executable.toLowerCase(), browser.toLowerCase());
      const view = await callApplicationBridge(root, { action: 'computer_state' }, options);
      assert.equal(view.windowId, windowId, 'Never target an owner window.');
      if (command.action === 'browser_open') {
        // The production launcher uses the normal Chrome profile. Here the same
        // requested URL must be opened inside our already verified test profile.
        const url = new URL(command.url);
        assert.equal(url.origin, 'https://www.google.com');
        assert.equal(url.pathname, '/search');
        assert(!pageSearchGoal);
        const request = spawn(
          browser,
          ['--user-data-dir=' + path.join(folder, 'profile'), url.href],
          {
            stdio: 'ignore',
          },
        );
        await new Promise((resolve, reject) => {
          request.once('spawn', resolve);
          request.once('error', reject);
        });
        report.actions.push({ action: 'browser_open' });
        return { ok: true, navigationRequested: true, windowId };
      }
      if (
        !command.windowId ||
        (command.windowTitle && !view.untrustedTitle.includes(command.windowTitle))
      ) {
        // Selection only. The AGENT must resolve the returned real ID itself.
        return {
          ok: true,
          needsWindow: true,
          inputPerformed: false,
          windows: [{ windowId, untrustedTitle: view.untrustedTitle }],
        };
      }
      assert.equal(command.windowId, windowId);
      if (pageSearchGoal && command.action === 'browser_input')
        assert(
          /^https?:\/\//i.test(command.text),
          'A page-search task may use the address bar for navigation, never for the query.',
        );
      report.actions.push({ action: command.action, text: command.text });
      return callApplicationBridge(root, command, options);
    },
  });
  catalog.add(browser);
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    currentTurn: () => turn,
    registerEscape: (stop) => (electron ? electron.globalShortcut.register('Escape', stop) : true),
    unregisterEscape: () => electron?.globalShortcut.unregister('Escape'),
    showBorder: async () => {
      if (electron) {
        overlay = new ControlOverlay({
          ...electron,
          owner,
          url: pathToFileURL(path.join(root, 'apps/desktop/renderer/control-overlay.html')).href,
          onLost: (reason) => {
            console.log(JSON.stringify({ indicatorLost: reason }));
            return control.stop();
          },
        });
        await overlay.show('CAPRI // VERIFICATION — ESC TO STOP');
      }
    },
    hideBorder: () => overlay?.hide(),
    bridge: async (command, options) => {
      if (command.action === 'computer_release')
        return callApplicationBridge(root, command, options);
      const view = await callApplicationBridge(root, { action: 'computer_state' }, options);
      if (returnFrom && view.windowId === returnFrom) {
        if (command.action === 'computer_state') return { ...view, untrustedControls: [] };
        assert.equal(command.action, 'computer_keys');
        assert.equal(command.windowId, returnFrom);
        assert.deepEqual(command.keys, ['ALT', 'TAB']);
        return callApplicationBridge(root, command, options);
      }
      assert.equal(view.windowId, windowId, 'Never send verification input to an owner window.');
      const address = view.untrustedControls.find((c) => c.browserAddress)?.untrustedValue;
      if (address) report.lastAddress = address;
      if (address && /[?&](?:udm=2|tbm=isch)(?:&|$)/.test(address)) report.imageResultsSeen = true;
      if (command.action === 'computer_state') return view;
      assert.equal(
        command.surface === 'taskbar' ? command.originWindowId : command.windowId,
        windowId,
      );
      assert(
        [
          'computer_keys',
          'computer_pointer',
          'computer_click',
          'computer_type',
          'computer_scroll',
        ].includes(command.action),
      );
      if (command.keys)
        assert(
          command.keys.every((key) => ['ENTER', 'CTRL', 'L', 'T', 'W', 'TAB', 'F11'].includes(key)),
        );
      report.actions.push({
        action: command.action,
        keys: command.keys,
        ...(command.action === 'computer_type'
          ? {
              pageSearch:
                view.untrustedControls.find((c) => c.id === command.controlId)?.browserSearch ===
                true,
            }
          : {}),
      });
      try {
        return await callApplicationBridge(root, command, options);
      } catch (error) {
        console.log(
          JSON.stringify({
            fixtureError: error.message,
            command,
            controls: view.untrustedControls.filter((c) => c.focused),
          }),
        );
        throw error;
      }
    },
    capture: async ({ signal }) => {
      if (process.env.CAPRI_VERIFY_VISION !== '1') throw Error('Accessible controls only.');
      const capture = await captureActiveDisplay(root, {
        signal,
        ownedWindow: windowId,
        withGeometry: true,
      });
      if (electron) {
        const image = electron.nativeImage.createFromBuffer(capture.png),
          size = image.getSize(),
          factor = Math.min(1, 1280 / size.width, 720 / size.height);
        const small = image.resize({
          width: Math.max(1, Math.round(size.width * factor)),
          height: Math.max(1, Math.round(size.height * factor)),
        });
        return { ...capture, png: small.toPNG(), ...small.getSize() };
      }
      return { ...capture, ...screenshotDimensions(capture.png) };
    },
    describe: computerVision({
      url: process.env.CAPRI_VERIFY_OLLAMA_URL,
      model: process.env.CAPRI_VERIFY_MODEL,
      params: { num_ctx: 8192 },
    }),
  });
  if (!shortcutsOnly) {
    const planner = computerPlanner({
      url: process.env.CAPRI_VERIFY_OLLAMA_URL,
      model: process.env.CAPRI_VERIFY_MODEL,
      params: { num_ctx: Number(process.env.CAPRI_VERIFY_CONTEXT ?? 8192) },
      fetchImpl: async (url, options) => {
        const response = await fetch(url, options);
        if (!response.ok)
          console.log(
            JSON.stringify({
              planningHttpStatus: response.status,
              planningErrorDetail: (await response.clone().text()).slice(0, 1000),
            }),
          );
        return response;
      },
    });
    const agent = new ComputerAgent({
      control,
      applications: catalog,
      language: () => 'ru',
      maxDecisions: fullscreenGoal ? 24 : 12,
      emit: (event) => console.log(JSON.stringify({ phase: event.phase, steps: event.steps })),
      plan: async (context, options) => {
        let step;
        try {
          step = await planner(context, options);
        } catch (error) {
          console.log(JSON.stringify({ planningError: error.message }));
          throw error;
        }
        console.log(
          JSON.stringify({
            plan: step,
            review: Boolean(options.review),
            title: context.currentObservation.window.untrustedTitle,
            target: context.currentObservation.targets.find((t) => t.targetId === step.targetId),
            fields: context.currentObservation.targets.filter((t) => t.editable),
            labels: context.currentObservation.targets
              .filter((t) =>
                /Images|Картинки|Приложения|изображ|по картин|image/iu.test(t.untrustedLabel),
              )
              .map((t) => ({ id: t.targetId, label: t.untrustedLabel })),
          }),
        );
        return step;
      },
      audit: (data) => {
        report.diagnostics = data;
      },
    });
    report.result = await agent.run(goal);
    const final = await callApplicationBridge(root, { action: 'computer_state' });
    report.finalTitle = final.untrustedTitle;
    assert.equal(final.windowId, windowId);
    assert(
      report.actions.some(
        (a) =>
          a.action === 'browser_open' || (a.action === 'computer_keys' && a.keys.includes('ENTER')),
      ),
      'A draft alone is not a search.',
    );
    const address =
      final.untrustedControls.find((c) => c.browserAddress)?.untrustedValue ?? report.lastAddress;
    report.navigation = address?.includes('google.com/sorry/')
      ? 'human_verification_required'
      : 'results';
    if (report.navigation === 'human_verification_required') {
      assert.equal(report.result.status, 'needs_user');
      assert.equal(
        report.result.ok,
        false,
        'A CAPTCHA must never be reported as completed results.',
      );
    } else {
      assert.equal(report.result.ok, true, JSON.stringify(report.result));
      assert(
        /(?:Капри|Capri).*Google/iu.test(final.untrustedTitle),
        'The search results must have loaded.',
      );
      assert(/google\.[^/]+\/search\?/i.test(address), 'Verify the navigated search address.');
      if (/\b(?:photos|images)\b|картин|изображен/iu.test(goal)) {
        assert(
          report.imageResultsSeen || /[?&](?:udm=2|tbm=isch)(?:&|$)/.test(address),
          'Verify that image results actually opened.',
        );
        assert(
          report.actions.some((a) => a.action === 'computer_click'),
          'Image results must be selected with the pointer.',
        );
      }
      if (fullscreenGoal) {
        assert.equal(final.fullscreen, true, 'The real browser must enter fullscreen.');
        assert(
          report.actions.filter((a) => a.action === 'computer_click').length >= 2,
          'Images and an image must be selected with the pointer.',
        );
      }
      if (pageSearchGoal)
        assert(
          report.actions.some((a) => a.action === 'computer_type' && a.pageSearch),
          'The query must be typed in a real page search field.',
        );
    }
    assert(
      report.actions.filter(
        (a) =>
          a.action === 'browser_open' || (a.action === 'computer_keys' && a.keys.includes('ENTER')),
      ).length <= (pageSearchGoal ? 2 : 1),
      'Do not repeat submissions.',
    );
  } else
    report.finalTitle = (
      await callApplicationBridge(root, { action: 'computer_state' })
    ).untrustedTitle;
  turn = 'browser-shortcuts';
  await control.begin(
    'Leave fullscreen if needed, open example.com in a new test tab, then close only that tab.',
  );
  const observe = () => control.execute({ action: 'observe', vision: false });
  const chord = async (keys) => {
    const v = await observe();
    return control.execute({ action: 'press_keys', observationId: v.observationId, keys });
  };
  if (shortcutsOnly) {
    await chord(['F11']);
    await delay(500);
    assert.equal((await observe()).window.fullscreen, true);
  }
  if ((await observe()).window.fullscreen) {
    await chord(['F11']);
    await delay(500);
    assert.equal((await observe()).window.fullscreen, false);
    report.fullscreenToolbarRestored = true;
  }
  await chord(['CTRL', 'T']);
  let tab = await observe();
  const omnibox = tab.targets.find((t) => t.browserAddress && t.editable);
  assert(omnibox);
  await control.execute({
    action: 'enter_text',
    targetId: omnibox.targetId,
    text: 'https://example.com/',
  });
  await chord(['ENTER']);
  for (let attempt = 0; attempt < 30; attempt++) {
    tab = await observe();
    if (/Example Domain/.test(tab.window.untrustedTitle)) break;
    await delay(300);
  }
  assert.match(tab.window.untrustedTitle, /Example Domain/);
  report.secondSiteOpened = true;
  await chord(['CTRL', 'W']);
  tab = await observe();
  assert.equal(tab.window.untrustedTitle, report.finalTitle);
  report.onlyTestTabClosed = true;
  if (process.env.CAPRI_VERIFY_DISCORD_PATH) {
    const icon = tab.targets.find(
      (t) => t.surface === 'taskbar' && !t.notificationArea && /Discord/i.test(t.untrustedLabel),
    );
    assert(icon, 'The observed taskbar must expose Discord.');
    await control.execute({ action: 'click', targetId: icon.targetId });
    const switched = async () => {
      const foreground = await callApplicationBridge(root, { action: 'computer_state' });
      const actual = await callApplicationBridge(root, {
        action: 'catalog_inspect',
        executable: process.env.CAPRI_VERIFY_DISCORD_PATH,
      });
      return {
        ok:
          actual.windowId === foreground.windowId ||
          actual.windows?.some((w) => w.windowId === foreground.windowId),
        windowId: foreground.windowId,
      };
    };
    await delay(700);
    let activation = await switched();
    if (!activation.ok && activation.windowId === windowId) {
      // A notification-area icon may intentionally ignore a single click.
      const fresh = await observe(),
        same = fresh.targets.find(
          (t) => t.surface === 'taskbar' && t.untrustedLabel === icon.untrustedLabel,
        );
      assert(same);
      await control.execute({ action: 'click', targetId: same.targetId, clickCount: 2 });
      await delay(700);
      activation = await switched();
      report.taskbarClickCount = 2;
    } else report.taskbarClickCount = 1;
    assert(activation.ok, 'The requested Discord executable must actually become foreground.');
    report.taskbarDiscordFocused = true;
    const refocus = await callApplicationBridge(root, {
      action: 'catalog_launch',
      executable: browser,
      windowId,
    });
    if (refocus.focused === false) {
      returnFrom = activation.windowId;
      await chord(['ALT', 'TAB']);
      returnFrom = null;
      report.returnShortcut = 'Alt+Tab';
    }
    const returned = await observe();
    assert.equal(returned.window.windowId, windowId);
    report.returnedToTestBrowser = true;
  }
  report.passed = true;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await control?.stop();
  await catalog?.close();
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  owner?.destroy();
}
