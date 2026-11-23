// SPDX-License-Identifier: GPL-3.0-only
// Real Chromium page input/events, pointer navigation and fullscreen in an owned
// profile. No owner tabs, accounts or external website are used by this check.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ComputerControl } from '../../apps/desktop/computer-control.mjs';
import { ComputerAgent } from '../../apps/desktop/computer-agent.mjs';
import { computerPlanner } from '../../apps/desktop/computer-planner.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';

const root = process.cwd();
const browser = [
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.LOCALAPPDATA,
]
  .filter(Boolean)
  .map((dir) => path.join(dir, 'Google/Chrome/Application/chrome.exe'))
  .find(existsSync);
assert(browser, 'This optional native verification requires Chrome.');
const parent = path.join(root, '.runtime/browser-page-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const unique = path.basename(folder),
  events = [],
  actions = [];
const title = 'Capri page ' + unique;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/event') {
    events.push(url.searchParams.get('kind'));
    res.end('ok');
    return;
  }
  if (url.pathname === '/wrong') events.push('wrong-link');
  if (url.pathname === '/search') events.push('search:' + url.searchParams.get('q'));
  const style =
    '<style>body{font:22px Arial;padding:60px;background:#102633;color:#d9ffff}input,button,a{font:22px Arial;margin:15px;padding:18px}a{display:inline-block;color:#62ecdf}img{width:300px;height:220px}#image{background:#263c54;padding:40px}</style>';
  const picture =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220"><rect width="300" height="220" fill="#e82464"/><text x="65" y="120" font-size="40" fill="white">CAPRI</text></svg>',
    );
  let page;
  if (url.pathname === '/image') {
    page =
      '<title>' +
      title +
      ' image viewer</title><div id="image"><img alt="Capri image" src="' +
      picture +
      '"><button id="full">View image fullscreen</button></div><script>full.onclick=()=>image.requestFullscreen();document.onfullscreenchange=()=>{if(document.fullscreenElement){document.title="' +
      title +
      ' fullscreen verified";fetch("/event?kind=fullscreen")}}</script>';
  } else if (url.searchParams.get('udm') === '2') {
    page =
      '<title>' +
      title +
      ' image results</title><h1>Capri image results</h1><a href="/image" aria-label="Open Capri image"><img alt="Capri preview" src="' +
      picture +
      '"></a>';
  } else if (url.pathname === '/search') {
    page =
      '<title>' +
      title +
      ' search results</title><h1>Search results for Capri</h1>' +
      [
        'Image',
        'Search by image',
        'Images archive',
        'Images for other characters',
        'Images settings',
        'Images help',
      ]
        .map((label) => '<a href="/wrong">' + label + '</a>')
        .join('') +
      '<a href="/search?q=Capri&udm=2">Images</a>' +
      ['Images sponsored', 'Image tools', 'Images guide', 'Old images', 'Image examples']
        .map((label) => '<a href="/wrong">' + label + '</a>')
        .join('') +
      '<p>Capri character reference</p>';
  } else {
    page =
      '<title>' +
      title +
      ' home</title><h1>Search verification</h1><form action="/search"><input id="q" name="q" aria-label="Search" placeholder="Search the page"><button>Search</button></form><script>q.addEventListener("input",()=>fetch("/event?kind=input"))</script>';
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(style + page);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const child = spawn(
  browser,
  [
    '--user-data-dir=' + path.join(folder, 'profile'),
    '--no-first-run',
    '--no-default-browser-check',
    '--force-renderer-accessibility',
    '--disable-background-networking',
    url,
  ],
  { windowsHide: false, stdio: 'ignore' },
);
const report = {
  passed: false,
  ownerTabsTouched: false,
  externalRequests: false,
  model: process.env.CAPRI_VERIFY_MODEL ?? null,
  actions,
  events,
};
let control;
try {
  let windowId;
  for (let i = 0; i < 60 && !windowId; i++) {
    await delay(150);
    let view;
    try {
      view = await callApplicationBridge(root, {
        action: 'catalog_inspect',
        executable: browser,
        windowTitle: title,
      });
    } catch (error) {
      if (error.message !== 'Open the selected application first.') throw error;
      continue; // A cold Chrome profile may not have a window at the first poll.
    }
    windowId =
      view.windows?.find((w) => w.untrustedTitle.includes(title))?.windowId ??
      (view.untrustedControls?.some((c) => c.name.includes(title)) ? view.windowId : undefined);
  }
  assert(windowId, 'Owned browser window was not found.');
  let focused = false;
  for (
    let attempt = 0;
    attempt < (process.env.CAPRI_VERIFY_WAIT_FOR_FOCUS === '1' ? 120 : 3);
    attempt++
  ) {
    if (attempt === 0 || process.env.CAPRI_VERIFY_WAIT_FOR_FOCUS !== '1')
      await callApplicationBridge(root, {
        action: 'catalog_launch',
        executable: browser,
        windowId,
      });
    await delay(250);
    const current = await callApplicationBridge(root, { action: 'computer_state' });
    if (current.windowId === windowId) {
      focused = true;
      break;
    }
  }
  assert(focused, 'The disposable browser could not retain foreground focus; no input was sent.');
  control = new ComputerControl({
    allowed: () => true,
    canStart: () => true,
    registerEscape: () => true,
    unregisterEscape() {},
    showBorder: async () => {},
    hideBorder() {},
    bridge: async (command, options) => {
      try {
        if (command.action === 'computer_release')
          return callApplicationBridge(root, command, options);
        const current = await callApplicationBridge(root, { action: 'computer_state' }, options);
        assert.equal(current.windowId, windowId, 'Stop before sending input to any owner window.');
        if (command.action === 'computer_state') return current;
        assert.equal(command.windowId, windowId);
        assert(
          ['computer_type', 'computer_keys', 'computer_click', 'computer_pointer'].includes(
            command.action,
          ),
        );
        if (command.keys) assert.deepEqual(command.keys, ['ENTER']);
        actions.push({ action: command.action, ...(command.keys ? { keys: command.keys } : {}) });
        return callApplicationBridge(root, command, options);
      } catch (error) {
        report.nativeFailure = { action: command.action, error: error.message, code: error.code };
        throw error;
      }
    },
    capture: async () => {
      throw Error('The owned page exposes accessible controls.');
    },
  });
  const deterministic = async ({ currentObservation: view }) => {
    const field = view.targets.find((t) => t.browserSearch && t.editable);
    if (field && field.untrustedValue !== 'Capri')
      return {
        action: 'enter_text',
        targetId: field.targetId,
        text: 'Capri',
        summary: 'Enter Capri in the page search field.',
      };
    if (field) return { action: 'press_keys', keys: ['ENTER'], summary: 'Submit the page search.' };
    const label = view.window.untrustedTitle.includes('search results')
      ? 'Images'
      : view.window.untrustedTitle.includes('image results')
        ? 'Open Capri image'
        : 'View image fullscreen';
    if (view.window.untrustedTitle.includes('fullscreen verified'))
      return {
        action: 'finish',
        evidence: view.window.untrustedTitle,
        summary: 'Searched and displayed Capri in fullscreen.',
      };
    const button = view.targets.find((t) => t.untrustedLabel === label);
    return button
      ? { action: 'click', targetId: button.targetId, summary: 'Click ' + label }
      : { action: 'wait', summary: 'Wait for the page.' };
  };
  const real =
    report.model &&
    computerPlanner({
      url: process.env.CAPRI_VERIFY_OLLAMA_URL,
      model: report.model,
      params: { num_ctx: 8192 },
    });
  const agent = new ComputerAgent({
    control,
    maxDecisions: 20,
    applications: {
      operation: (_id, _args, run) => run(),
      execute: () => assert.fail('The page task must not fall back to address-bar entry.'),
    },
    plan: async (context, options) => {
      const step = await (real || deterministic)(context, options);
      console.log(
        JSON.stringify({
          step,
          review: Boolean(options?.review),
          title: context.currentObservation.window.untrustedTitle,
        }),
      );
      return step;
    },
    audit: (value) => {
      report.diagnostics = value;
    },
  });
  report.result = await agent.run(
    'In the current Chrome page, type Capri in the PAGE search bar, submit the search, click Images, open the Capri image, and click View image fullscreen. Do not use the address bar or leave this local website.',
  );
  assert.equal(report.result.ok, true, JSON.stringify(report));
  assert(events.includes('input'), 'Real Chromium input events must fire.');
  assert(
    !events.includes('wrong-link'),
    'A nearby similarly named link must never substitute for Images.',
  );
  assert.equal(
    events.filter((e) => e === 'search:Capri').length,
    2,
    'One submission and one Images navigation are expected.',
  );
  assert(events.includes('fullscreen'), 'The image viewer must enter real browser fullscreen.');
  assert(actions.some((a) => a.action === 'computer_type'));
  assert.equal(actions.filter((a) => a.action === 'computer_click').length, 3);
  report.passed = true;
} finally {
  await control?.stop();
  child.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, folder }));
}
