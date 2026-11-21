// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/guide-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const report = { passed: false, folder, checks: [], errors: [] };
const record = (check) => {
  report.checks.push(check);
  console.log('PASS ' + check);
};

// The native windows are real. The isolated fixture has no running inference,
// voice engine, provider credentials, or access to the owner's desktop state.
const chatRequests = [];
const server = createServer((request, response) => {
  if (request.url?.includes('/chat')) chatRequests.push(request.url);
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  CAPRI_DESKTOP_VERIFICATION_GUIDE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
async function launchCompanion() {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.initialized === 'true');
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  return page;
}
const automaticTour = '#capri-guide[data-view="tour"]:not([hidden])';
try {
  const firstLaunch = await launchCompanion();
  await firstLaunch.waitForSelector(`${automaticTour}[data-step="overview"]`);
  await firstLaunch.locator('#guide-next').click();
  await firstLaunch.waitForSelector(`${automaticTour}[data-step="type"]`);
  await firstLaunch.keyboard.press('Escape');
  await firstLaunch.locator('#capri-guide').waitFor({ state: 'hidden' });
  await firstLaunch.reload();
  await firstLaunch.waitForFunction(() => document.body.dataset.initialized === 'true');
  assert.equal(await firstLaunch.locator('#capri-guide').isVisible(), false);
  await application.close();

  const page = await launchCompanion();
  await page.waitForSelector(`${automaticTour}[data-step="overview"]`);
  await page.keyboard.press('Escape');
  record('A new launch opens the tour directly, and a dismissed tour retries only on relaunch');

  const setLanguage = async (interfaceLanguage) => {
    await page.evaluate(async (language) => {
      const value = await window.capri.bootstrap();
      return window.capri.setLanguages({ ...value.languages, interface: language });
    }, interfaceLanguage);
    await page.waitForFunction(
      (language) => document.documentElement.lang === language,
      interfaceLanguage,
    );
  };
  await setLanguage('en');
  const before = await page.evaluate(() => window.capri.bootstrap());
  const launcher = page.locator('#handle #guide-open');
  const guide = page.locator('#capri-guide');
  const modelMenu = page.locator('#inference-picker');
  const title = guide.locator('#guide-title');
  const description = guide.locator('#guide-description');
  const next = guide.locator('#guide-next');
  const back = guide.locator('#guide-back');
  const skip = guide.locator('#guide-skip');
  const start = guide.locator('#guide-start');
  const action = guide.locator('#guide-action');

  async function showStep(id, allowedTargets) {
    await page.waitForSelector(`#capri-guide[data-view="tour"][data-step="${id}"]:not([hidden])`);
    await page.waitForFunction((selectors) => {
      const target = document.querySelector('[data-guide-highlight]');
      const spotlight = document.getElementById('guide-spotlight');
      if (!spotlight || !target || !selectors.some((selector) => target.matches(selector)))
        return false;
      const targetRect = target.getBoundingClientRect();
      const frame = spotlight.getBoundingClientRect();
      const x = targetRect.left + targetRect.width / 2;
      const y = targetRect.top + targetRect.height / 2;
      return (
        targetRect.width > 0 &&
        targetRect.height > 0 &&
        frame.width > 0 &&
        frame.height > 0 &&
        frame.left <= x &&
        frame.right >= x &&
        frame.top <= y &&
        frame.bottom >= y
      );
    }, allowedTargets);
    assert.equal(await page.locator('[data-guide-highlight]').count(), 1);
    assert.ok(await title.textContent());
    assert.ok(await description.textContent());
  }

  async function assertEntrance() {
    await page.waitForFunction(
      () => document.getElementById('guide-spotlight').getAnimations({ subtree: true }).length >= 5,
    );
    const entrance = await guide.evaluate((root) => {
      const byAnimation = (id) =>
        root.getAnimations({ subtree: true }).filter((item) => item.id === id);
      const lines = byAnimation('guide-frame-line');
      const corners = byAnimation('guide-frame-corners')[0];
      return {
        startingScales: lines.map(({ effect }) => effect.getKeyframes()[0].scale).sort(),
        centered: lines.every(({ effect }) => {
          const origin = getComputedStyle(effect.target).transformOrigin.split(' ').map(parseFloat);
          const axis = ['top', 'bottom'].includes(effect.target.dataset.edge) ? 0 : 1;
          const length = axis === 0 ? effect.target.offsetWidth : effect.target.offsetHeight;
          return length > 0 && Math.abs(origin[axis] * 2 - length) <= 1;
        }),
        cornersFollowLines: lines.every(
          ({ effect }) => corners.effect.getTiming().delay >= effect.getTiming().duration,
        ),
        dialogAlongsideFrame:
          byAnimation('guide-dialog')[0].effect.getTiming().delay <
          corners.effect.getTiming().delay,
        textAfterDialog:
          byAnimation('guide-description')[0].effect.getTiming().delay >
          byAnimation('guide-dialog')[0].effect.getTiming().delay,
        portraitCropped:
          root.querySelector('.guide-avatar img').offsetWidth >
          root.querySelector('.guide-avatar').offsetWidth * 5,
      };
    });
    assert.deepEqual(entrance, {
      startingScales: ['0 1', '0 1', '1 0', '1 0'],
      centered: true,
      cornersFollowLines: true,
      dialogAlongsideFrame: true,
      textAfterDialog: true,
      portraitCropped: true,
    });
  }

  const settingsUrl = 'capri://desktop/settings.html';
  const settingsVisible = () =>
    application.evaluate(
      ({ BrowserWindow }, url) =>
        BrowserWindow.getAllWindows().some(
          (window) =>
            window.webContents.getURL() === url &&
            window.isVisible() &&
            window.getOpacity() >= 0.99,
        ),
      settingsUrl,
    );

  async function openGuideSettings(section) {
    if (section === 'general') await action.press('Enter');
    else await action.click();
    let settings;
    for (let attempt = 0; attempt < 200; attempt++) {
      settings = application
        .windows()
        .find((view) => !view.isClosed() && view.url() === settingsUrl);
      if (settings && (await settingsVisible())) break;
      await delay(50);
    }
    assert.ok(
      settings && (await settingsVisible()),
      'The guide action must present the real Settings window',
    );
    // Models exposes its selected tab before the deferred paint has completed.
    // Closing at this point tests the transition to the API step during loading.
    if (section === 'models') {
      await settings.waitForSelector('[data-section="models"][aria-current="page"]');
    } else {
      await settings.waitForFunction(
        (id) =>
          document.querySelector(`[data-section="${id}"][aria-current="page"]`) &&
          document.getElementById('companion').getAttribute('aria-busy') === 'false',
        section,
      );
    }
    assert.equal(await guide.isVisible(), true);
    await settings.locator('#settings-window-close').click();
    for (let attempt = 0; attempt < 200 && (await settingsVisible()); attempt++) await delay(50);
    assert.equal(await settingsVisible(), false);
  }

  async function assertClosed() {
    await guide.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-guide-highlight]').count(), 0);
    assert.equal(await modelMenu.isVisible(), false);
    assert.equal(await launcher.evaluate((button) => document.activeElement === button), true);
  }

  assert.equal((await launcher.textContent()).trim(), '?');
  assert.equal(await guide.isVisible(), false);
  await launcher.click();
  await page.waitForSelector('#capri-guide[data-view="menu"]:not([hidden])');
  const englishMenu = await guide.innerText();
  assert.match(englishMenu, /guides?/i);
  await start.click();
  await showStep('overview', ['#portrait-panel', '#avatar-viewport', '#handle']);
  assert.equal(await back.isDisabled(), true);
  const overview = await title.innerText();
  await next.click();
  await showStep('type', ['.composer']);
  await assertEntrance();
  await page.waitForFunction(
    () => !document.getElementById('capri-guide').getAnimations({ subtree: true }).length,
  );
  await page.screenshot({ path: path.join(folder, 'guide-animated-type.png') });
  await back.click();
  await showStep('overview', ['#portrait-panel', '#avatar-viewport', '#handle']);
  await assertEntrance();
  assert.equal(await title.innerText(), overview);
  await skip.click();
  await showStep('type', ['.composer']);
  await next.click();
  await showStep('voice', ['#input-microphone', '#microphone-toggle', '.composer']);
  await next.click();
  await showStep('replies', ['#history-toggle']);
  record('Top bar launcher, beginner tour, Back, Next, Skip and real spotlight geometry');
  record(
    'Four center-out edges, delayed corners, parallel dialog and cropped portrait on Next and Back',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await next.click();
  await showStep('settings', ['#settings-open']);
  assert.equal(await guide.evaluate((root) => root.getAnimations({ subtree: true }).length), 0);
  await back.click();
  await showStep('replies', ['#history-toggle']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  record('Reduced motion shows the completed step immediately');

  await page.keyboard.press('ArrowRight');
  await showStep('settings', ['#settings-open']);
  await openGuideSettings('general');
  await showStep('settings', ['#settings-open']);
  await next.click();
  await showStep('models', ['#inference-picker']);
  await modelMenu.locator('[data-source="local"]').waitFor();
  assert.equal(await modelMenu.isVisible(), true);
  await page.keyboard.press('Tab');
  assert.equal(await guide.evaluate((node) => node.contains(document.activeElement)), true);
  assert.equal(await modelMenu.isVisible(), true);
  await next.click();
  await showStep('local', ['#inference-picker [data-settings="models"]']);
  await openGuideSettings('models');
  await next.click();
  await showStep('api', ['#inference-picker [data-settings="api"]']);
  await openGuideSettings('api');
  await showStep('api', ['#inference-picker [data-settings="api"]']);
  await page.screenshot({ path: path.join(folder, 'guide-en.png') });
  assert.match(await next.innerText(), /finish/i);
  assert.equal(await skip.isVisible(), false);
  await next.click();
  await assertClosed();
  record(
    'Settings, Local model and API actions open the intended pages; Finish cleans up the tour',
  );

  await setLanguage('ru');
  await launcher.click();
  await page.waitForSelector('#capri-guide[data-view="menu"]:not([hidden])');
  const russianMenu = await guide.innerText();
  assert.notEqual(russianMenu, englishMenu);
  assert.match(russianMenu, /[а-яё]{5}/iu);
  await start.click();
  await showStep('overview', ['#portrait-panel', '#avatar-viewport', '#handle']);
  assert.notEqual(await title.innerText(), overview);
  assert.match(await description.innerText(), /[а-яё]{5}/iu);
  await setLanguage('en');
  await showStep('overview', ['#portrait-panel', '#avatar-viewport', '#handle']);
  assert.equal(await title.innerText(), overview);
  assert.equal(await guide.getAttribute('lang'), 'en');
  await setLanguage('ru');
  await showStep('overview', ['#portrait-panel', '#avatar-viewport', '#handle']);
  assert.equal(await guide.getAttribute('lang'), 'ru');
  assert.match(await description.innerText(), /[а-яё]{5}/iu);
  for (const button of [next, back, skip]) assert.match(await button.textContent(), /[а-яё]/iu);
  await page.screenshot({ path: path.join(folder, 'guide-ru.png') });
  const originalBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    const previous = window.getBounds();
    window.setResizable(true);
    window.setBounds({ ...previous, width: 320 });
    return previous;
  });
  await page.waitForFunction(() => Math.abs(innerWidth - 320) <= 2);
  await showStep('overview', ['#portrait-panel', '#avatar-viewport', '#handle']);
  const controlsFit = () =>
    [...document.querySelectorAll('#capri-guide button:not([hidden])')].every((button) => {
      const { width, left, right } = button.getBoundingClientRect();
      return !width || (left >= 0 && right <= innerWidth + 1);
    });
  await page.waitForFunction(controlsFit, null, { timeout: 5000 });
  await page.screenshot({ path: path.join(folder, 'guide-ru-narrow.png') });
  await application.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    window.setBounds(bounds);
  }, originalBounds);
  await page.keyboard.press('Escape');
  await assertClosed();
  record('Language switches in place, the Russian text fits at 320 px, and Escape restores focus');

  const after = await page.evaluate(() => window.capri.bootstrap());
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.inference, before.inference);
  assert.deepEqual(chatRequests, []);
  record('The guide leaves conversation history and the active model intact without chat calls');

  await application.close();
  const completedLaunch = await launchCompanion();
  assert.equal(await completedLaunch.locator('#capri-guide').isVisible(), false);
  await completedLaunch.locator('#guide-open').click();
  await completedLaunch.waitForSelector('#capri-guide[data-view="menu"]:not([hidden])');
  record('Finish survives a full restart while manual help stays available');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log('Report: ' + path.join(folder, 'report.json'));
