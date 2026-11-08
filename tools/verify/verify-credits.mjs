// SPDX-License-Identifier: GPL-3.0-only
/** Real settings surface with a disposable profile; no models or owner data. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView, saveSettings } from './settings-view.mjs';
import { uiText } from '../../apps/desktop/renderer/interface-translations.mjs';

const parent = path.join(root, '.runtime/credits-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const roster = JSON.parse(readFileSync(path.join(root, 'config/hall-of-fame.json'), 'utf8'));
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  TEMP: parent,
  TMP: parent,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
const report = { passed: false, folder, checks: [], errors: [], externalRequests: [] };
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const owner = await application.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  const settings = await settingsView(application, 'support');
  settings.on('request', (req) => {
    if (/^https?:/u.test(req.url()) && !req.url().startsWith('http://127.0.0.1:'))
      report.externalRequests.push(req.url());
  });
  const sections = await settings
    .locator('[data-section]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.section));
  assert.equal(sections.indexOf('credits'), sections.indexOf('support') + 1);
  await settings.locator('[data-section="credits"]').click();
  const panel = settings.locator('#credits-panel');
  await panel.waitFor();
  await panel.getByText(roster.supporters[0], { exact: true }).waitFor();
  const text = await panel.textContent();
  for (const person of [...roster.team.map(({ name }) => name), ...roster.supporters])
    assert(text.includes(person), 'Missing credit: ' + person);
  const aliases = await panel.locator('.credits-supporter').evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: node.querySelector('.credits-name-gradient').textContent,
      phrase: node.querySelector('.credits-epithet').textContent,
    })),
  );
  for (const { name, phrase } of aliases) {
    assert.equal(phrase, roster.epithets[name.toLowerCase()]);
    assert(phrase.trim());
  }
  assert.equal(new Set(aliases.map(({ phrase }) => phrase)).size, roster.supporters.length);
  for (const { name } of roster.team) {
    const card = panel
      .locator('.credits-team-card')
      .filter({ has: settings.getByText(name, { exact: true }) });
    assert.equal(
      await card.locator('.credits-epithet').textContent(),
      roster.epithets[name.toLowerCase()],
    );
  }
  report.checks.push(
    'Every nickname has its saved unique adjective/noun epithet; team roles stay present',
  );
  report.checks.push(
    'All team credits and ' + roster.supporters.length + ' imported nicknames load offline',
  );
  const search = panel.getByLabel('Find a nickname', { exact: true });
  await search.fill(aliases[0].phrase.toUpperCase());
  await panel.getByText(roster.supporters[0], { exact: true }).waitFor();
  assert.equal(await panel.locator('.credits-supporter:visible').count(), 1);
  await search.fill(roster.supporters[0].toUpperCase());
  await panel.getByText(roster.supporters[0], { exact: true }).waitFor();
  assert.equal(await panel.getByText(roster.supporters.at(-1), { exact: true }).isVisible(), false);
  await search.fill('no-match-' + 'x'.repeat(45));
  await panel.getByText('No matching nicknames.', { exact: true }).waitFor();
  await search.fill('');
  report.checks.push(
    'Case-insensitive local nickname/epithet search, empty results and clearing work',
  );

  for (const locale of ['en', 'ru', 'de', 'ar', 'ja']) {
    if (locale !== 'en') {
      await settings.locator('[data-section="languages"]').click();
      await settings.selectOption('#language-interface', locale);
      await saveSettings(settings);
      await settings.locator('[data-section="credits"]').click();
    }
    assert.equal(
      await settings.locator('[data-section="credits"]').textContent(),
      uiText('Credits', locale),
    );
    assert(await panel.getByText(uiText('Hall of Fame', locale), { exact: true }).isVisible());
    if (locale !== 'en') assert.notEqual(uiText('Hall of Fame', locale), 'Hall of Fame');
    const size = await settings.locator('#companion').evaluate((main) => ({
      width: main.clientWidth,
      content: main.scrollWidth,
    }));
    assert(size.content <= size.width + 2, locale + ': horizontal overflow');
    await settings.locator('#companion').evaluate((main) => {
      main.scrollTop = 0;
    });
    await settings.screenshot({ path: path.join(folder, locale + '.png') });
    if (locale === 'en' || locale === 'ru') {
      await panel.locator('#credits-supporters-title').scrollIntoViewIfNeeded();
      await settings.screenshot({
        path: path.join(folder, locale + '-supporters.png'),
      });
    }
    report.checks.push(locale + ': navigation, translation and layout');
  }
  await settings.locator('[data-section="languages"]').click();
  await settings.selectOption('#language-interface', 'en');
  await saveSettings(settings);
  await settings.locator('[data-section="credits"]').click();
  await settings.evaluate(async () => {
    const { applyInterfaceTheme, THEME_DEFAULTS } = await import('./interface-theme.mjs');
    applyInterfaceTheme({ ...THEME_DEFAULTS, preset: 'blackwall' });
  });
  await settings.screenshot({ path: path.join(folder, 'blackwall.png') });
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((view) =>
      view.webContents.getURL().endsWith('/settings.html'),
    );
    window.setContentSize(420, 620);
  });
  await settings.waitForFunction(() => innerWidth <= 430);
  assert(
    await settings
      .locator('#companion')
      .evaluate((main) => main.scrollWidth <= main.clientWidth + 2),
  );
  await settings.screenshot({ path: path.join(folder, 'narrow.png') });
  report.checks.push('Blackwall theme and narrow 420px window');
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await panel.evaluate(
      (node) =>
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.target instanceof Element &&
              node.contains(animation.effect.target) &&
              animation.playState === 'running',
          ).length,
    ),
    0,
  );
  await settings.locator('[data-section="support"]').click();
  assert.equal(await panel.isVisible(), false);
  await settings.locator('[data-section="credits"]').click();
  await panel.waitFor();
  await settings.locator('#settings-window-close').click();
  assert.equal(await settings.locator('#settings-draft-actions').isVisible(), false);
  report.checks.push('Reduced motion, tab switching and closing without a settings draft');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
