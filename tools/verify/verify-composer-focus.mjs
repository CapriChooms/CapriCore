// SPDX-License-Identifier: GPL-3.0-only
/** Inspect the real renderers and tray actions without showing windows or capturing audio. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { environment, initialize, root, runtime } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime', 'composer-focus-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const entry = path.join(folder, 'main.mjs');
writeFileSync(
  entry,
  `
import { app, nativeImage, Tray } from 'electron';
const fixture = globalThis.composerFocusFixture = {};
const on = Tray.prototype.on;
Tray.prototype.on = function (name, listener) {
  if (name === 'right-click') fixture.tray = this;
  return on.call(this, name, listener);
};
Tray.prototype.popUpContextMenu = function (menu) { fixture.menu = menu; };
app.on('browser-window-created', (_, window) => {
  let shown = false;
  window.isVisible = () => shown;
  window.show = window.showInactive = () => {
    if (!shown) { shown = true; window.emit('show'); }
  };
  window.hide = () => {
    if (shown) { shown = false; window.emit('hide'); }
  };
  window.focus = () => {};
  window.webContents.setAudioMuted(true);
  window.webContents.setBackgroundThrottling(false);
  window.webContents.capturePage = async () => nativeImage.createFromBitmap(Buffer.alloc(4), { width: 1, height: 1 });
});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href)});
`,
);

const server = createServer((_request, response) => response.end('{"data":[]}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [entry, '--verification'],
    env,
  });
  const companion = await application.firstWindow();
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready');
  const events = (value) =>
    application.evaluate(({ BrowserWindow }, event) => {
      const owner = BrowserWindow.getAllWindows().find(
        (win) => win.webContents.getURL() === 'capri://desktop/index.html',
      );
      owner.showInactive();
      owner.webContents.send('capri:event', event);
    }, value);
  const status = companion.locator('.composer #wake-feedback');
  const field = companion.locator('#message');
  const listening = {
    type: 'microphone.settings',
    enabled: true,
    status: 'listening',
    wakeState: 'command',
  };
  const off = { ...listening, enabled: false, status: 'off' };
  const visibility = () =>
    application.evaluate(({ BrowserWindow }) =>
      Object.fromEntries(
        BrowserWindow.getAllWindows().map((win) => [
          new URL(win.webContents.getURL()).pathname,
          win.isVisible(),
        ]),
      ),
    );
  const assertInsideComposer = () =>
    companion.evaluate(() => {
      const composer = document.querySelector('.composer').getBoundingClientRect();
      const status = document.getElementById('wake-feedback').getBoundingClientRect();
      return (
        status.width > 0 &&
        status.height > 0 &&
        status.left >= composer.left &&
        status.right <= composer.right &&
        status.top >= composer.top &&
        status.bottom <= composer.bottom
      );
    });

  for (const mode of ['portrait', 'core', 'detached']) {
    if (mode === 'detached') {
      await events({ type: 'avatar.detach', phase: 'detached' });
      if ((await companion.locator('body').getAttribute('data-presence')) !== 'portrait')
        await companion.locator('#presence-toggle').evaluate((button) => button.click());
    } else if ((await companion.locator('body').getAttribute('data-presence')) !== mode)
      await companion.locator('#presence-toggle').evaluate((button) => button.click());
    await companion.waitForFunction(
      (mode) =>
        mode === 'detached'
          ? document.body.dataset.avatarDock === 'compact' &&
            document.body.dataset.presence === 'portrait'
          : document.body.dataset.presence === mode,
      mode,
    );
    assert.equal(
      await field.isVisible(),
      true,
      'Attached core and expanded detached input remain usable.',
    );
    const composerHeight = await companion
      .locator('.composer')
      .evaluate((node) => node.offsetHeight);
    await events(listening);
    await status.waitFor({ state: 'visible' });
    assert.match(await status.textContent(), /I'M LISTENING/);
    assert.equal(await assertInsideComposer(), true);
    assert.equal(
      await companion.locator('.composer').evaluate((node) => node.offsetHeight),
      composerHeight,
    );
    await field.fill('Existing draft');
    assert.equal(await field.inputValue(), 'Existing draft');
    assert.equal(await assertInsideComposer(), true);
    await field.fill('');
    await events(off);
    await status.waitFor({ state: 'hidden' });
  }

  await field.fill('Preserved detached draft');
  await companion.locator('#presence-toggle').evaluate((button) => button.click());
  await companion.waitForFunction(() => document.body.dataset.presence === 'core');
  assert.equal(await field.isHidden(), true);
  assert.equal(await companion.locator('#input-dock > footer').isHidden(), true);
  await events(listening);
  assert.equal(
    await status.isHidden(),
    true,
    'Listening must not expose the collapsed main input.',
  );
  await companion.locator('#presence-toggle').evaluate((button) => button.click());
  await field.waitFor({ state: 'visible' });
  assert.equal(await field.inputValue(), 'Preserved detached draft');
  await status.waitFor({ state: 'visible' });
  assert.equal(await assertInsideComposer(), true);
  await events(off);
  await field.fill('');
  await events({ type: 'avatar.detach', phase: 'attached' });
  const settings = await settingsView(application, 'general');
  const focus = settings.locator('[data-window-action="focus-mode"]');
  assert.equal(await focus.getAttribute('aria-pressed'), 'false');
  await focus.evaluate((button) => button.click());
  await settings.waitForFunction(
    () =>
      document.querySelector('[data-window-action="focus-mode"]').getAttribute('aria-pressed') ===
      'true',
  );
  assert.deepEqual(await visibility(), { '/index.html': false, '/settings.html': false });
  await application.evaluate(() => globalThis.composerFocusFixture.tray.emit('right-click'));
  await application.evaluate(() => {
    const item = globalThis.composerFocusFixture.menu.getMenuItemById('tray-settings');
    item.click(item);
  });
  await focus.waitFor({ state: 'visible' });
  assert.deepEqual(await visibility(), { '/index.html': false, '/settings.html': true });
  assert.equal(await focus.getAttribute('aria-pressed'), 'true');
  await focus.evaluate((button) => button.click());
  await settings.waitForFunction(
    () =>
      document.querySelector('[data-window-action="focus-mode"]').getAttribute('aria-pressed') ===
      'false',
  );
  assert.deepEqual(await visibility(), { '/index.html': true, '/settings.html': true });
  assert.equal(
    (await companion.evaluate(() => window.capri.bootstrap())).windowSettings.focusMode,
    false,
  );
  console.log(
    'PASS in-composer listening in portrait, core and detached modes; Focus mode and tray Settings stay in sync.',
  );
  const appearance = await settingsView(application, 'appearance');
  const theme = appearance.locator('#theme-preset');
  const draft = appearance.locator('#settings-draft-actions');
  const savedTheme = () =>
    companion.evaluate(async () => (await window.capri.bootstrap()).companion.interfaceTheme);
  await theme.selectOption('blackwall');
  assert.equal(await draft.isHidden(), true);
  await companion.waitForFunction(
    () => document.documentElement.dataset.interfaceTheme === 'blackwall',
  );
  assert.equal(
    await appearance.evaluate(() => document.documentElement.dataset.interfaceTheme),
    'blackwall',
  );
  assert.equal((await savedTheme()).preset, 'capri');
  await appearance.locator('[data-section="dialogue"]').click();
  await appearance.locator('#memory-clear').waitFor();
  assert.equal(await draft.isHidden(), true);
  await appearance.locator('[data-section="appearance"]').click();
  assert.equal(await theme.inputValue(), 'blackwall');
  await appearance.locator('[data-section="general"]').click();
  await focus.click();
  assert.deepEqual(await visibility(), { '/index.html': false, '/settings.html': false });
  await application.evaluate(() => globalThis.composerFocusFixture.tray.emit('right-click'));
  await application.evaluate(() => {
    const item = globalThis.composerFocusFixture.menu.getMenuItemById('tray-settings');
    item.click(item);
  });
  await focus.waitFor({ state: 'visible' });
  await focus.click();
  await appearance.locator('[data-section="appearance"]').click();
  assert.equal(await theme.inputValue(), 'blackwall');
  await companion.waitForFunction(
    () => document.documentElement.dataset.interfaceTheme === 'blackwall',
  );
  await appearance.locator('#settings-window-close').click();
  await draft.waitFor();
  assert.equal(await appearance.locator('dialog[open]').count(), 0);
  await appearance.locator('#settings-discard').click();
  await companion.waitForFunction(
    () => document.documentElement.dataset.interfaceTheme === 'capri',
  );
  assert.equal((await savedTheme()).preset, 'capri');
  await settingsView(application, 'appearance');
  await theme.selectOption('custom');
  await appearance.locator('#theme-hue').fill('220');
  await appearance.locator('[data-section="dialogue"]').click();
  await appearance.locator('#communication-style').selectOption('wild');
  await appearance.locator('#settings-window-close').click();
  await draft.waitFor();
  await appearance.locator('#settings-stay').click();
  await draft.waitFor({ state: 'hidden' });
  assert.equal(await appearance.locator('#communication-style').inputValue(), 'wild');
  await appearance.locator('#settings-window-close').click();
  await appearance.locator('#settings-apply').click();
  await draft.waitFor({ state: 'hidden' });
  assert.equal((await savedTheme()).preset, 'custom');
  assert.equal((await savedTheme()).hue, 220);
  assert.equal(
    (await appearance.evaluate(() => window.capri.getPersonality())).communicationStyle,
    'wild',
  );
  await companion.waitForFunction(
    () => document.documentElement.dataset.interfaceTheme === 'custom',
  );
  const time = await settingsView(application, 'time');
  await time.locator('#companion-reminder-wake').waitFor();
  await time.locator('.time-dial:has(#time-minutes)').dispatchEvent('wheel', { deltaY: -25 });
  assert.equal(await time.locator('#time-minutes').inputValue(), '06');
  await time.locator('#time-minutes').fill('0');
  await time.locator('#time-seconds').fill('20');
  await time.locator('#time-title').fill('Draft verification timer');
  await time.locator('#time-create').click();
  await time.locator('#time-list').getByText('Draft verification timer').waitFor();

  const general = await settingsView(application, 'general');
  const help = general.locator('.general-setting:has([data-window-action="reset-position"])');
  await help.locator('#general-reset-position-help').waitFor();
  assert.equal(await help.locator('.settings-info-button').count(), 0);
  await general.locator('[data-section="appearance"]').click();
  const helpRow = general.locator('.settings-help-row:has(#companion-glitch-events)');
  const helpButton = helpRow.locator('.settings-info-button');
  await helpButton.click();
  const info = await helpButton.boundingBox();
  assert.ok(info.width === info.height && info.width <= 20);
  let appeared = false;
  for (let attempt = 0; attempt < 50 && !appeared; attempt++) {
    const helpView = application
      .windows()
      .find((page) => page.url() === 'capri://desktop/settings-help.html');
    if (helpView) {
      await helpView.locator('aside[data-open]').waitFor();
      assert.equal(
        await application.evaluate(({ BrowserWindow }) => {
          const bounds = (name) =>
            BrowserWindow.getAllWindows()
              .find((view) => view.webContents.getURL() === `capri://desktop/${name}.html`)
              .getBounds();
          const owner = bounds('settings');
          const help = bounds('settings-help');
          return help.x >= owner.x + owner.width || help.x + help.width <= owner.x;
        }),
        true,
      );
      appeared = true;
    } else if (await general.locator('.settings-help-fallback[data-open]').count()) appeared = true;
    else await new Promise((resolve) => setTimeout(resolve, 80));
  }
  assert.equal(appeared, true);
  await general.keyboard.press('Escape');
  await general
    .locator('.settings-help-row:has(#companion-glitch-events) [aria-expanded="false"]')
    .waitFor();
  await general.locator('[data-section="general"]').click();
  const pin = general.locator('#general-on-top');
  const originalPin = await pin.getAttribute('aria-pressed');
  await pin.click();
  assert.notEqual(await pin.getAttribute('aria-pressed'), originalPin);
  assert.equal(
    (await general.evaluate(() => window.capri.bootstrap())).windowSettings.alwaysOnTop,
    originalPin === 'true',
  );
  await general.locator('#settings-window-close').click();
  await general.locator('#settings-draft-actions').waitFor();
  await general.locator('#settings-discard').click();
  await general.waitForFunction(() => document.getElementById('settings-draft-actions').hidden);
  for (let i = 0; i < 20 && (await visibility())['/settings.html']; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await visibility())['/settings.html'], false);
  await settingsView(application, 'general');
  assert.equal(await pin.getAttribute('aria-pressed'), originalPin);
  const support = await settingsView(application, 'support');
  assert.equal(await support.getByRole('button', { name: 'TikTok' }).count(), 1);
  assert.equal(
    await support.locator('.brand-tiktok .brand-video[aria-hidden="true"] svg').count(),
    1,
  );
  const links = await support.locator('.support-links').evaluate((group) => {
    const featured = group.querySelector('.brand-boosty').getBoundingClientRect();
    const bounds = group.getBoundingClientRect();
    const social = [...group.querySelectorAll('button:not(.brand-boosty)')];
    return {
      centered: Math.abs(featured.x + featured.width / 2 - bounds.x - bounds.width / 2) < 1,
      above: social.every((button) => button.getBoundingClientRect().top > featured.bottom),
      masks: social.map(
        (button) => getComputedStyle(button.querySelector('.brand-icon')).maskImage,
      ),
      oneColor: new Set(social.map((button) => getComputedStyle(button).color)).size === 1,
    };
  });
  assert.equal(links.centered && links.above && links.oneColor, true);
  assert.match(links.masks[0], /discord\.svg/);
  assert.match(links.masks[2], /github\.svg/);
  console.log(
    'PASS settings draft highlighting and persistence, palette preview, memory and timer navigation, digital dials, contextual help and official marks.',
  );
  const ownerId = await application.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find(
        (win) => win.webContents.getURL() === 'capri://desktop/index.html',
      ).id,
  );
  const wait = async (condition, message) => {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  };
  const crash = (id) =>
    application.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.fromId(id).webContents.forcefullyCrashRenderer();
    }, id);
  const ready = () =>
    application.evaluate(async ({ BrowserWindow }, id) => {
      const owner = BrowserWindow.fromId(id);
      if (!owner?.isVisible() || owner.webContents.isCrashed()) return false;
      return owner.webContents
        .executeJavaScript("document.body.dataset.phase === 'ready'")
        .catch(() => false);
    }, ownerId);
  const settingsId = await application.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find(
        (win) => win.webContents.getURL() === 'capri://desktop/settings.html',
      ).id,
  );
  await crash(settingsId);
  await wait(
    () => application.evaluate(({ BrowserWindow }, id) => !BrowserWindow.fromId(id), settingsId),
    'Crashed Settings window was not removed',
  );
  await wait(ready, 'Settings failure interrupted the companion');
  await companion.waitForFunction(() =>
    document.getElementById('notice-message').textContent.includes('Settings closed unexpectedly'),
  );
  await application.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.fromId(id).webContents.executeJavaScript(
        "window.capri.openSettings('general')",
      ),
    ownerId,
  );
  await wait(
    async () => (await visibility())['/settings.html'] === true,
    'Settings did not reopen after the crash',
  );

  await crash(ownerId);
  await wait(
    async () => (await visibility())['/settings.html'] === false,
    'Settings did not close during companion recovery',
  );
  await wait(ready, 'Companion failed to recover in the same native window');
  await crash(ownerId);
  await wait(
    () =>
      application.evaluate(({ BrowserWindow }, id) => {
        const owner = BrowserWindow.fromId(id);
        return owner && owner.webContents.isCrashed() && !owner.isVisible();
      }, ownerId),
    'A repeated crash should wait for an explicit tray request',
  );
  await application.evaluate(({ app }) => app.emit('second-instance'));
  await wait(ready, 'Explicit restore did not recover the companion');
  const evaluateRecovered = (code) =>
    application.evaluate(
      ({ BrowserWindow }, { id, code }) =>
        BrowserWindow.fromId(id).webContents.executeJavaScript(code),
      { id: ownerId, code },
    );
  await evaluateRecovered('void (window.pendingQuit = window.capri.quit())');
  const sleep = `document.querySelector('#confirmation-dialog[open] [data-choice="sleep"]')`;
  await wait(() => evaluateRecovered(`Boolean(${sleep})`), 'Sleep option was not shown');
  assert.equal(await evaluateRecovered(`${sleep}.textContent`), 'Sleep');
  await evaluateRecovered(`${sleep}.click(); window.pendingQuit`);
  assert.equal(
    await evaluateRecovered('window.capri.bootstrap().then(({ backend }) => backend.phase)'),
    'asleep',
  );
  console.log(
    'PASS isolated Settings recovery, bounded companion renderer reload and sleep from the exit dialog.',
  );
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
