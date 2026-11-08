// SPDX-License-Identifier: GPL-3.0-only
/** Real Chrome, disposable profile and a local data page; no owner tabs or chat. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
const browser = [
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.LOCALAPPDATA,
]
  .filter(Boolean)
  .map((dir) => path.join(dir, 'Google/Chrome/Application/chrome.exe'))
  .find(existsSync);
if (!browser) throw Error('Chrome is not installed; this optional native verification cannot run.');
const parent = path.join(root, '.runtime/browser-input-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-')),
  title = 'Capri browser fixture ' + path.basename(folder);
const profile = path.join(folder, 'profile');
mkdirSync(profile);
const child = spawn(
  browser,
  [
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'data:text/html,' +
      encodeURIComponent(
        '<title>' +
          title +
          '</title><input aria-label="Fixture page field" value="unchanged" autofocus>',
      ),
  ],
  { stdio: 'ignore', windowsHide: false },
);
const catalog = new DesktopCatalog({
  root,
  state: path.join(folder, 'state'),
  fullAccess: () => true,
  currentTurn: () => 'native-browser-fixture',
});
const report = { passed: false, folder, ownerTabsTouched: false, searchSubmitted: false };
try {
  const discovered = await callApplicationBridge(root, {
    action: 'catalog_discover',
    query: 'Google Chrome',
  });
  assert(
    discovered.matches.some((m) => m.executable.toLowerCase() === browser.toLowerCase()),
    'Friendly-name discovery must find registered Chrome.',
  );
  let windowId;
  for (let i = 0; i < 60; i++) {
    await delay(150);
    try {
      const windows = await callApplicationBridge(root, {
        action: 'catalog_inspect',
        executable: browser,
      });
      if (windows.needsWindow)
        windowId = windows.windows.find((w) => w.untrustedTitle.includes(title))?.windowId;
      else if (windows.untrustedControls?.some((c) => c.name.includes(title)))
        windowId = windows.windowId;
      if (windowId) break;
    } catch {}
  }
  assert(windowId, 'Only the owned browser fixture may receive text.');
  const [app] = catalog.add(browser);
  const result = await catalog.execute(
    'browser-input',
    { action: 'browser_input', query: 'Google Chrome', windowId, text: 'Capri' },
    { propose: (p) => p.execute() },
  );
  assert.equal(result.typed, true);
  assert.equal(result.submitted, false);
  assert.equal(result.appId, app.id);
  const inspected = await catalog.execute('same-turn-inspection', { action: 'inspect' }, {});
  assert.equal(inspected.appId, app.id);
  assert.equal(inspected.windowId, windowId);
  assert(
    inspected.untrustedControls.some((c) => c.name.includes(title)),
    'Entering a draft must not navigate away from the fixture.',
  );
  if (process.argv.includes('--model-test')) {
    const { verifyBrowserModel } = await import('./browser-model-fixture.mjs');
    report.model = await verifyBrowserModel({ root, catalog, windowId, title });
  }
  if (process.argv.includes('--agent-test')) {
    const { verifyBrowserAgent } = await import('./browser-agent-fixture.mjs');
    report.agent = await verifyBrowserAgent({ root, catalog, windowId, title });
  }
  report.passed = true;
  report.checks = [
    'Resolved Google Chrome by name',
    'Entered and verified Capri in the real address bar',
    'No Enter/navigation',
    'Retained app/window identity for same-turn inspection',
  ];
} finally {
  await catalog.close();
  child.kill();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
