// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

if (process.platform !== 'win32') throw Error('This regression checks native Windows visibility.');
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'settings-lifecycle-'));
const report = { folder, checks: [], errors: [] };
// Electron's visibility flag alone cannot detect an unexpected native surface.
// Query only handles belonging to this disposable application, never other apps.
const source = path.join(folder, 'WindowState.cs'),
  helper = path.join(folder, 'WindowState.exe');
writeFileSync(
  source,
  `using System; using System.Runtime.InteropServices;
class WindowState {
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint kind);
 static void Main(string[] args) {
  var h=new IntPtr(long.Parse(args[0]));
  Console.WriteLine("{\\"exists\\":"+IsWindow(h).ToString().ToLowerInvariant()+",\\"visible\\":"+IsWindowVisible(h).ToString().ToLowerInvariant()+",\\"owner\\":\\""+GetWindow(h,4).ToInt64()+"\\"}");
 }
}`,
);
execFileSync(
  path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  ),
  ['/nologo', '/target:exe', '/out:' + helper, source],
  { windowsHide: true, timeout: 30000 },
);
const native = (handle) =>
  JSON.parse(
    execFileSync(helper, [handle], { encoding: 'utf8', windowsHide: true, timeout: 5000 }),
  );
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
};
delete env.ELECTRON_RUN_AS_NODE;
let application, settingsHandle;
const record = (name) => {
  report.checks.push(name);
  console.log('PASS ' + name);
};
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
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/index.html'))
      .showInactive();
  });
  // Populated DOM can precede the first native surface on a cold CI runner.
  // Wait for the real presentation before testing HWND visibility/ownership.
  const settings = await settingsView(application, 'appearance');
  await settings.locator('#companion-glitch-strength').waitFor();
  await settings.locator('#companion-glitch-strength').fill('83');
  const state = () =>
    application.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/settings.html'),
      );
      return (
        view && {
          handle: view.getNativeWindowHandle().readBigUInt64LE().toString(),
          visible: view.isVisible(),
          parent: Boolean(view.getParentWindow()),
        }
      );
    });
  const initial = await state();
  settingsHandle = initial.handle;
  assert.equal(initial.parent, false);
  assert.deepEqual(native(settingsHandle), { exists: true, visible: true, owner: '0' });
  record('Settings is a painted independent native surface, without Windows ownership');
  await page.waitForTimeout(35_000);
  assert.deepEqual(await state(), initial);
  assert.equal(native(settingsHandle).visible, true);
  assert.equal(await settings.locator('#companion-glitch-strength').inputValue(), '83');
  assert.equal(await page.evaluate(() => document.body.dataset.phase), 'ready');
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/index.html'))
        .isVisible(),
    ),
    true,
  );
  record('Both native windows stay visible and responsive for 35 seconds idle');
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => window.capri.hide());
    assert.equal((await state()).visible, false);
    assert.equal(native(settingsHandle).visible, false);
    await application.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/index.html'),
      );
      owner.showInactive();
      owner.setBounds({ ...owner.getBounds(), x: owner.getBounds().x - 1 });
    });
    await page.waitForTimeout(100);
    assert.equal((await state()).visible, false);
    assert.equal(native(settingsHandle).visible, false);
    await settingsView(application, 'appearance');
    assert.equal((await state()).handle, settingsHandle);
    assert.equal(native(settingsHandle).visible, true);
    assert.equal(await settings.locator('#companion-glitch-strength').inputValue(), '83');
  }
  record(
    'Repeated tray hide/restore leaves no visible Settings HWND and preserves an unsaved draft',
  );
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html'),
    );
    owner.setMinimizable(true);
    owner.minimize();
  });
  await page.waitForTimeout(250);
  assert.equal(native(settingsHandle).visible, false);
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html'),
    );
    owner.restore();
    owner.showInactive();
  });
  await page.waitForTimeout(100);
  assert.equal(native(settingsHandle).visible, false);
  await settingsView(application, 'appearance');
  assert.equal(await settings.locator('#companion-glitch-strength').inputValue(), '83');
  record('Native minimize/restore cannot resurrect settings; explicit reopening retains the draft');
  await settings.locator('#settings-window-close').click();
  await settings.locator('#settings-draft-actions:not([hidden])').waitFor();
  assert.equal(await settings.locator('#confirmation-dialog[open]').count(), 0);
  await settings.locator('#settings-discard').click();
  await page.waitForTimeout(100);
  assert.equal(native(settingsHandle).visible, false);
  await settingsView(application, 'general');
  await settings.locator('#general-panel:not([hidden])').waitFor();
  await settings.screenshot({ path: path.join(folder, 'settings.png') });
  record('Closing with a draft reveals the header controls, and reopening renders Settings');

  await settings.locator('[data-section="appearance"]').click();
  const strength = settings.locator('#companion-glitch-strength');
  const close = settings.locator('#settings-window-close');
  const actions = settings.locator('#settings-draft-actions');
  await strength.fill('79');
  await close.click();
  await settings.locator('#settings-apply').click();
  await actions.waitFor({ state: 'hidden' });
  assert.equal(native(settingsHandle).visible, true, 'Saving leaves the Settings window visible');
  assert.equal(await close.isEnabled(), true);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).companion.glitchStrength, 79);
  await close.click();
  await page.waitForTimeout(100);
  assert.equal(native(settingsHandle).visible, false, 'Close hides Settings after saving');
  assert.equal(await actions.isHidden(), true, 'Closing saved settings does not prompt again');
  await settingsView(application, 'appearance');
  assert.equal(await strength.inputValue(), '79');
  record('Save leaves Settings open and the next Close hides it without another prompt');

  const crashedHandle = settingsHandle;
  const destroyed = await application.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/settings.html'),
    );
    const closed = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      view.once('closed', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    view.webContents.forcefullyCrashRenderer();
    return closed;
  });
  assert.equal(destroyed, true);
  assert.equal(native(crashedHandle).exists, false);
  assert.equal(await page.evaluate(() => document.body.dataset.phase), 'ready');
  const reopened = await settingsView(application, 'appearance');
  settingsHandle = (await state()).handle;
  assert.equal(native(settingsHandle).visible, true);
  assert.equal(await reopened.locator('#companion-glitch-strength').inputValue(), '79');
  record('Settings can reopen after a renderer crash while the companion stays responsive');
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  if (settingsHandle) {
    const closed = native(settingsHandle);
    report.closed = closed;
    assert.equal(closed.exists, false, 'Settings native window must be destroyed on app exit');
    record('Quitting the owner leaves no native Settings window');
  }
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log('Report: ' + path.join(folder, 'report.json'));
