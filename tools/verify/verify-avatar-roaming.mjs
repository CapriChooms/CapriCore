// SPDX-License-Identifier: GPL-3.0-only
// Real Electron settings and automatic teleports, using isolated data and a loopback fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView, saveSettings } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'avatar-roaming-'));
const report = { passed: false, errors: [], checks: [] };
const virtualMonitors = process.argv.includes('--virtual-monitors');
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const owner = await application.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((item) => item.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive();
  });
  await owner.waitForFunction(() => Boolean(document.querySelector('#sprite').dataset.avatar));
  if (virtualMonitors)
    await application.evaluate(({ BrowserWindow, screen }) => {
      const main = BrowserWindow.getAllWindows().find(
        (win) => win.webContents.getURL() === 'capri://desktop/index.html',
      );
      const base = screen.getDisplayMatching(main.getBounds());
      const area = base.workArea;
      const width = Math.floor(area.width / 2);
      const left = { ...area, width };
      const right = { ...area, x: area.x + width, width: area.width - width };
      const displays = [
        { ...base, id: 101, bounds: left, workArea: left },
        { ...base, id: 102, bounds: right, workArea: right },
      ];
      const nearest = ({ x }) => (x < right.x ? displays[0] : displays[1]);
      const matching = ({ x, width }) => nearest({ x: x + width / 2 });
      const home = matching(main.getBounds());
      const away = displays.find(({ id }) => id !== home.id);
      globalThis.roamingProbe = { home: home.workArea, away: away.workArea, target: 'away' };
      screen.getAllDisplays = () => displays;
      screen.getDisplayNearestPoint = nearest;
      screen.getDisplayMatching = matching;
      screen.getCursorScreenPoint = () => {
        const target = globalThis.roamingProbe[globalThis.roamingProbe.target];
        return { x: target.x + Math.floor(target.width / 2), y: target.y + 30 };
      };
    });
  await owner.evaluate(() => {
    window.__roamingPhases = [];
    window.capri.onEvent((event) => {
      if (event.type === 'avatar.detach') window.__roamingPhases.push(event.phase);
    });
  });
  const settings = await settingsView(application, 'avatar-skill');
  assert.equal(await settings.locator('#avatar-roaming').isChecked(), false);
  assert.equal(await settings.locator('#avatar-roam-interval').isDisabled(), true);
  assert.equal(await settings.locator('#avatar-roam-monitors').isDisabled(), true);
  await settings.locator('#avatar-roaming').check();
  await settings.locator('#avatar-roam-monitors').selectOption('pointer');
  await settings.locator('#avatar-roam-interval').evaluate((input) => {
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await settings.locator('#avatar-roam-interval-value').textContent(), '30 s');
  await settings.locator('[data-companion-group="Desktop roaming"]').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: path.join(folder, 'roaming-settings.png') });
  await saveSettings(settings);
  await settings.locator('#settings-window-close').click();
  console.log('Waiting for the first scheduled teleport (30–36 s).');
  await owner.waitForFunction(() => window.__roamingPhases.includes('detached'), null, {
    timeout: 45000,
  });
  report.checks.push(
    'Enabled roaming leaves the home frame automatically without screen observation.',
  );
  const checkTarget = async (side) => {
    let placement;
    // The outgoing window remains visible while its teleport effect settles.
    for (let attempt = 0; attempt < 60; attempt++) {
      placement = await application.evaluate(({ BrowserWindow }, side) => {
        const windows = BrowserWindow.getAllWindows().filter(
          (window) =>
            window.isVisible() &&
            window.webContents.getURL() === 'capri://desktop/avatar-detach.html',
        );
        return {
          actual: windows.map((window) => window.getBounds()),
          expected: globalThis.roamingProbe[side],
        };
      }, side);
      if (placement.actual.length === 1) break;
      await wait(100);
    }
    assert.deepEqual(placement.actual, [placement.expected]);
  };
  if (virtualMonitors) {
    await checkTarget('away');
    await application.evaluate(() => {
      globalThis.roamingProbe.target = 'home';
    });
  }
  const before = await owner.evaluate(
    () => window.__roamingPhases.filter((phase) => phase === 'detached').length,
  );
  console.log('Waiting for the next scheduled move (30–36 s).');
  await owner.waitForFunction(
    (count) => window.__roamingPhases.filter((phase) => phase === 'detached').length > count,
    before,
    { timeout: 45000 },
  );
  report.checks.push('A second automatic move completes using the selected interval.');
  if (virtualMonitors) {
    await checkTarget('home');
    report.checks.push('Roaming follows the pointer across two simulated monitors.');
  }
  const reopened = await settingsView(application, 'avatar-skill');
  assert.equal(await reopened.locator('#avatar-roaming').isChecked(), true);
  assert.equal(await reopened.locator('#avatar-roam-interval').inputValue(), '30');
  assert.equal(await reopened.locator('#avatar-roam-monitors').inputValue(), 'pointer');
  await reopened.locator('#avatar-roaming').uncheck();
  assert.equal(await reopened.locator('#avatar-roam-interval').isDisabled(), true);
  assert.equal(await reopened.locator('#avatar-roam-monitors').isDisabled(), true);
  await saveSettings(reopened);
  await reopened.locator('#settings-window-close').click();
  const state = await owner.evaluate(() => window.capri.bootstrap());
  assert.equal(state.companion.avatarRoaming, false);
  assert.equal(state.companion.avatarRoamMonitors, 'pointer');
  report.checks.push('Settings persist and roaming can be disabled again.');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ ...report, folder }));
