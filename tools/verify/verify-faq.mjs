// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { COMMUNITY_LINKS, loadCommunityLinks } from '../../apps/desktop/community-links.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/faq-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const report = { passed: false, folder, checks: [], errors: [] };
const record = (check) => {
  report.checks.push(check);
  console.log('PASS ' + check);
};
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
};
delete env.ELECTRON_RUN_AS_NODE;

let application;
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  application.on('window', (view) => {
    if (view !== page) view.on('pageerror', (error) => report.errors.push(error.message));
  });
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  const setLanguage = async (locale) => {
    await page.evaluate(async (language) => {
      const value = await window.capri.bootstrap();
      return window.capri.setLanguages({ ...value.languages, interface: language });
    }, locale);
    await page.waitForFunction((language) => document.documentElement.lang === language, locale);
  };
  await setLanguage('en');
  const before = await page.evaluate(() => window.capri.bootstrap());
  const launcher = page.locator('#handle #guide-open');
  const overlay = page.locator('#capri-guide');
  const faq = overlay.locator('#guide-faq');
  const search = overlay.locator('#guide-faq-search');
  const results = overlay.locator('#guide-faq-results');
  const empty = overlay.locator('#guide-faq-empty');
  const menuBack = overlay.locator('#guide-faq-back');
  const items = results.locator('details[data-faq-id]');
  const visibleItems = results.locator('details[data-faq-id]:visible');

  await launcher.click();
  await overlay.locator('#guide-start').waitFor();
  await faq.click();
  await page.waitForSelector('#capri-guide[data-view="faq"]');
  await search.waitFor();
  const count = await visibleItems.count();
  assert.ok(count >= 32, `Expected all 32 original FAQ entries; found ${count}`);
  assert.ok((await results.locator('.guide-faq-group:visible').count()) > 1);
  assert.equal(await overlay.locator('#guide-spotlight').isVisible(), false);
  const firstItem = items.first();
  const firstQuestion = firstItem.locator('summary');
  const firstAnswer = firstItem.locator('.guide-faq-answer');
  const englishQuestion = (await firstQuestion.innerText()).trim();
  assert.ok(englishQuestion);
  assert.equal(await firstAnswer.isVisible(), false);
  await firstQuestion.press('Enter');
  await firstAnswer.waitFor();
  const englishAnswer = (await firstAnswer.innerText()).trim();
  assert.ok(englishAnswer);
  await firstQuestion.press('Enter');
  await firstAnswer.waitFor({ state: 'hidden' });

  await search.fill(englishQuestion.toUpperCase());
  assert.equal(await firstItem.isVisible(), true);
  assert.ok((await visibleItems.count()) > 0 && (await visibleItems.count()) < count);
  await search.fill('capri-faq-xyz-no-match');
  await empty.waitFor();
  assert.equal(await visibleItems.count(), 0);
  assert.ok((await empty.innerText()).trim());
  await search.fill('');
  assert.equal(await visibleItems.count(), count);
  assert.equal(await empty.isVisible(), false);
  record(
    'All FAQ topics open from the top button, with keyboard accordion and case-insensitive search',
  );

  const allowedLinks = loadCommunityLinks(root);
  const externalActions = results.locator('.guide-faq-action[data-link]');
  const linkIds = await externalActions.evaluateAll((buttons) =>
    buttons.map((button) => button.dataset.link),
  );
  assert.ok(linkIds.length > 0);
  assert.ok(linkIds.every((id) => Object.hasOwn(COMMUNITY_LINKS, id)));
  await application.evaluate(({ shell }) => {
    globalThis.faqExternalLinks = [];
    shell.openExternal = async (url) => globalThis.faqExternalLinks.push(url);
  });
  const chosenLink = externalActions.first();
  const linkId = await chosenLink.getAttribute('data-link');
  await chosenLink.locator('xpath=ancestor::details/summary').click();
  await chosenLink.click();
  await assert.rejects(
    page.evaluate(() => window.capri.communityLink('https://example.invalid/')),
    /Unknown community link/,
  );
  assert.deepEqual(await application.evaluate(() => globalThis.faqExternalLinks), [
    allowedLinks[linkId],
  ]);

  const section = 'models';
  const shortcut = results.locator(`.guide-faq-action[data-section="${section}"]`).first();
  const shortcutEntry = shortcut.locator('xpath=ancestor::details');
  if ((await shortcutEntry.getAttribute('open')) === null)
    await shortcutEntry.locator('summary').click();
  await shortcut.click();
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
  let settings;
  for (let attempt = 0; attempt < 200; attempt++) {
    settings = application.windows().find((view) => !view.isClosed() && view.url() === settingsUrl);
    if (settings && (await settingsVisible())) break;
    await delay(50);
  }
  assert.ok(
    settings && (await settingsVisible()),
    'The FAQ shortcut must open the real Settings window',
  );
  await settings.waitForFunction(
    (id) =>
      document.querySelector(`[data-section="${id}"][aria-current="page"]`) &&
      document.getElementById('companion').getAttribute('aria-busy') === 'false',
    section,
  );
  await settings.locator('#settings-window-close').click();
  for (let attempt = 0; attempt < 200 && (await settingsVisible()); attempt++) await delay(50);
  assert.equal(await settingsVisible(), false);
  assert.equal(await overlay.getAttribute('data-view'), 'faq');
  record('FAQ shortcuts reach real Settings and dispatch only an allowlisted community link');

  if ((await firstItem.getAttribute('open')) === null) await firstQuestion.click();
  const firstId = await firstItem.getAttribute('data-faq-id');
  for (const [locale, direction, script] of [
    ['ru', 'ltr', /\p{Script=Cyrillic}{3}/u],
    ['ar', 'rtl', /\p{Script=Arabic}{3}/u],
  ]) {
    await setLanguage(locale);
    await page.waitForFunction(
      ({ lang, dir }) => {
        const faq = document.getElementById('capri-guide');
        return faq.lang === lang && faq.dir === dir && faq.dataset.view === 'faq';
      },
      { lang: locale, dir: direction },
    );
    assert.equal(await visibleItems.count(), count);
    assert.equal(await firstItem.getAttribute('data-faq-id'), firstId);
    assert.equal(await firstAnswer.isVisible(), true);
    assert.match(await firstQuestion.innerText(), script);
    assert.match(await firstAnswer.innerText(), script);
    assert.notEqual((await firstAnswer.innerText()).trim(), englishAnswer);
    const localizedQuestion = await firstQuestion.innerText();
    await search.fill(localizedQuestion);
    assert.equal(await firstItem.isVisible(), true);
    assert.ok((await visibleItems.count()) < count);
    await search.fill('');
  }
  const originalBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    const previous = window.getBounds();
    window.setResizable(true);
    window.setBounds({ ...previous, width: 320 });
    return previous;
  });
  await page.waitForFunction(
    () => {
      const dialog = document.querySelector('#capri-guide .guide-dialog');
      const bounds = dialog.getBoundingClientRect();
      return (
        Math.abs(innerWidth - 320) <= 2 &&
        bounds.left >= 0 &&
        bounds.right <= innerWidth + 1 &&
        dialog.scrollWidth <= dialog.clientWidth + 1
      );
    },
    null,
    { timeout: 5000 },
  );
  await page.screenshot({ path: path.join(folder, 'faq-ar-narrow.png') });
  await application.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/index.html'),
    );
    window.setBounds(bounds);
  }, originalBounds);
  await setLanguage('ru');
  await page.waitForFunction(() => document.getElementById('capri-guide').lang === 'ru');
  await page.screenshot({ path: path.join(folder, 'faq-ru.png') });
  record('Russian and Arabic update the open FAQ live and the RTL layout fits at 320 px');

  await menuBack.click();
  assert.equal(await overlay.getAttribute('data-view'), 'menu');
  assert.equal(await faq.evaluate((node) => document.activeElement === node), true);
  await overlay.locator('#guide-start').click();
  await page.waitForSelector('#capri-guide[data-view="tour"][data-step="overview"]');
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden' });
  assert.equal(await launcher.evaluate((node) => document.activeElement === node), true);
  const after = await page.evaluate(() => window.capri.bootstrap());
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.inference, before.inference);
  assert.deepEqual(chatRequests, []);
  assert.deepEqual(report.errors, []);
  record('Back restores the guide menu and the FAQ leaves model and chat history intact');
  report.passed = true;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log('Report: ' + path.join(folder, 'report.json'));
