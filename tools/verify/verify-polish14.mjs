// SPDX-License-Identifier: GPL-3.0-only
/** Real isolated desktop UI. No owner history, microphone capture or model downloads. */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/index.mjs';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { FilePermissions } from '../../integrations/filesystem/permissions.mjs';
import { ActionApprovals } from '../../apps/desktop/action-broker.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/polish14-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'owned-')),
  state = path.join(folder, 'desktop');
mkdirSync(state);
const personal = path.join(folder, 'personal');
mkdirSync(personal);
const file = path.join(personal, 'disposable-note.txt');
writeFileSync(file, 'Disposable recovery fixture');
const permissions = new FilePermissions(path.join(state, 'file-permissions.json'));
const [scope] = permissions.grant(personal);
permissions.update(scope.id, true);
const catalog = new DesktopCatalog({
    root: folder,
    state,
    filePermissions: permissions,
    trash: (file) => unlinkSync(file),
  }),
  approvals = new ActionApprovals({ emit() {} });
const proposal = await catalog.execute(
  'owned-recovery',
  { action: 'trash', scopeId: scope.id, path: 'disposable-note.txt' },
  approvals,
);
await approvals.respond(proposal.proposal.id, true);
await catalog.close();
const server = createServer((q, r) => {
  q.resume();
  r.end('{"data":[]}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const report = { folder, passed: false, checks: [], errors: [] };
let app;
const record = (message) => {
  report.checks.push(message);
  console.log('PASS ' + message);
};
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  app.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const page = await app.firstWindow();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click();
  await page.waitForFunction(() => document.body.dataset.presence !== 'core');
  const sprite = await page.locator('#sprite-region').boundingBox();
  assert(sprite);
  const initial = (await page.evaluate(() => window.capri.bootstrap())).avatarLayout;
  const x = Math.max(28, Math.min(440, sprite.x + sprite.width * 0.5)),
    y = Math.max(130, Math.min(470, sprite.y + sprite.height * 0.55));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 15, y - 8, { steps: 3 });
  await page.waitForTimeout(100);
  const midway = (await page.evaluate(() => window.capri.bootstrap())).avatarLayout;
  assert.equal(await page.locator('#sprite-region').getAttribute('data-dragging'), 'true');
  await page.mouse.move(x - 40, y - 22, { steps: 5 });
  await page.mouse.up();
  const final = (await page.evaluate(() => window.capri.bootstrap())).avatarLayout;
  assert.notEqual(midway.x, initial.x);
  assert.notEqual(final.x, midway.x);
  record('A real multi-step pointer drag continues across placement updates');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', { type: 'voice.error', message: 'Owned error fixture' }),
  );
  await page.locator('#notice:not([hidden])').waitFor();
  await page.locator('#notice-dismiss').click();
  assert.equal(await page.locator('#notice').isHidden(), true);
  record('Error notifications can be dismissed without opening a bug report');
  await page.evaluate(() =>
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => [
        { deviceId: 'default', label: 'Default - Fixture USB microphone', kind: 'audioinput' },
        { deviceId: 'fixture-usb', label: 'Fixture USB microphone', kind: 'audioinput' },
      ],
    }),
  );
  const settings = await settingsView(app, 'microphone');
  await settings.locator('#settings-device-refresh').click();
  await settings.waitForFunction(() =>
    [...document.querySelectorAll('#settings-audio-device option')].some(
      (o) => o.textContent === 'Fixture USB microphone',
    ),
  );
  assert.equal(await settings.locator('#speech-pause').inputValue(), '1');
  await settings.locator('#settings-audio-device').selectOption('fixture-usb');
  await settings.waitForFunction(
    async () => (await window.capri.bootstrap()).microphone.deviceId === 'fixture-usb',
  );
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => /^capri:/.test(w.webContents.getURL()))
      .map((w) => ({ url: w.webContents.getURL(), height: w.getBounds().height })),
  );
  assert.equal(bounds[0].height, bounds[1].height);
  record(
    'Microphone names, system default, saved selection, 1-second pause and matching settings height',
  );
  await settingsView(app, 'files');
  const color = await settings
    .locator('#file-access-list .danger-action')
    .evaluate((e) => getComputedStyle(e).borderColor.match(/\d+/g).map(Number));
  assert(color[0] > color[1] * 1.5 && color[0] > color[2] * 1.4);
  await settings.locator('#file-access-panel details summary').click();
  await settings.locator('#file-recovery-list button').filter({ hasText: 'Restore' }).click();
  await settings.locator('#confirmation-dialog[open] [data-choice="confirm"]').click();
  await settings.waitForTimeout(100);
  assert.equal(readFileSync(file, 'utf8'), 'Disposable recovery fixture');
  await settings.evaluate(() => {
    window.__purgeId = null;
    window.capri.onEvent((e) => {
      if (e.type === 'confirmation.request') window.__purgeId = e.id;
    });
  });
  await settings.locator('#file-recovery-list .danger-action').click();
  const confirm = settings.locator('#confirmation-dialog[open] [data-choice="confirm"]');
  await confirm.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  assert.equal(
    await settings.evaluate(() =>
      window.capri.confirmAction({ id: window.__purgeId, choice: 'confirm' }),
    ),
    false,
  );
  await confirm.waitFor({ state: 'visible' });
  await settings.waitForFunction(
    () => !document.querySelector('#confirmation-dialog [data-choice="confirm"]').disabled,
  );
  await confirm.click();
  await settings.waitForFunction(async () => (await window.capri.fileRecovery()).length === 0);
  assert.equal(readFileSync(file, 'utf8'), 'Disposable recovery fixture');
  assert.equal(existsSync(path.join(state, 'file-recovery')), true);
  record('Recovery purge has a real 3-second UI/backend gate and preserves restored originals');
  await settings.evaluate(() => window.capri.closeSettings());
  await page.evaluate(() => window.capri.timeAction({ action: 'stopwatch' }));
  await page.locator('#stopwatch-hud:not([hidden])').waitFor();
  await page.locator('#stopwatch-hud').click();
  await page.locator('#stopwatch-controls:not([hidden])').waitFor();
  await page.locator('#stopwatch-toggle').click();
  await page.waitForFunction(
    () => document.getElementById('stopwatch-hud').dataset.running === 'false',
  );
  await page.locator('#stopwatch-reset').click();
  await page.locator('#confirmation-dialog[open] [data-choice="confirm"]').click();
  await page.waitForFunction(
    () => document.getElementById('stopwatch-hud').textContent === '00:00:00',
  );
  await page.locator('#stopwatch-toggle').click();
  await page.waitForFunction(
    () => document.getElementById('stopwatch-hud').dataset.running === 'true',
  );
  await page.locator('#stopwatch-stop').click();
  await page.waitForFunction(() => document.getElementById('stopwatch-hud').hidden);
  record('Clicking the digits offers working pause, reset, resume and stop controls');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  await settingsView(app, 'microphone');
  await settings.screenshot({ path: path.join(folder, 'microphone.png') });
} catch (error) {
  report.error = error.stack;
  for (const [p, page] of (app?.windows() ?? []).entries())
    await page.screenshot({ path: path.join(folder, 'failure-' + p + '.png') }).catch(() => {});
  throw error;
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
