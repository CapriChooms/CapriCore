// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { SETTINGS_SECTIONS } from '../../apps/desktop/renderer/settings-registry.mjs';
import { coreGuides } from '../../apps/desktop/renderer/settings-guide-core.mjs';
import { skillGuides } from '../../apps/desktop/renderer/settings-guide-skills.mjs';
import { advancedGuides } from '../../apps/desktop/renderer/settings-guide-advanced.mjs';
import { settingsGuideSteps } from '../../apps/desktop/renderer/settings-guide.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const entries = [coreGuides, skillGuides, advancedGuides].flatMap(Object.entries);
const guides = new Map(entries);
const content = Object.fromEntries(guides);
assert.equal(entries.length, guides.size, 'Each tab has one guide');
assert.deepEqual([...guides.keys()].sort(), SETTINGS_SECTIONS.map(([id]) => id).sort());
for (const [id, steps] of guides) {
  assert.ok(steps.length, id);
  for (const [target, en, ru] of steps) {
    assert.ok(target.trim(), id);
    for (const pair of [en, ru]) {
      assert.equal(pair.length, 2, id);
      assert.ok(
        pair.every((value) => value.trim()),
        id,
      );
    }
    assert.match(ru[1], /[а-я]/iu, id);
  }
}

const parent = path.join(root, '.runtime/settings-guide-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'run-'));
const report = { passed: false, locales: {}, checks: [], errors: [] };
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
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
  });

let app;
try {
  app = await launch();
  const main = await app.firstWindow();
  await main.waitForFunction(() => document.body.dataset.phase === 'ready');
  const settings = await settingsView(app, 'general');
  settings.on('pageerror', (error) => report.errors.push(error.message));
  const opener = settings.locator('#settings-guide-open');
  const modal = settings.locator('dialog.settings-guide');
  const next = modal.locator('#settings-guide-next');
  const title = modal.locator('.guide-title');
  const open = async (section, pending) => {
    await settingsView(app, section);
    await settings.waitForFunction(() => !document.getElementById('settings-guide-open').disabled);
    if (pending !== undefined)
      assert.equal((await opener.getAttribute('data-guide-pending')) !== null, pending, section);
    await opener.evaluate((button) => button.click());
    await settings.locator(`dialog.settings-guide[open][data-section="${section}"]`).waitFor();
  };
  const setLanguage = async (locale) => {
    await main.evaluate(async (language) => {
      const value = await window.capri.bootstrap();
      return window.capri.setLanguages({ ...value.languages, interface: language });
    }, locale);
    await settings.waitForFunction(
      (language) => document.documentElement.lang === language,
      locale,
    );
  };
  const pulse = () =>
    opener.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        pending: button.hasAttribute('data-guide-pending'),
        animation: style.animationName,
        duration: style.animationDuration,
        color: style.getPropertyValue('--toolbar-pulse-color').trim(),
        accent: style.getPropertyValue('--settings-control-ink').trim(),
      };
    });
  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  await settings.waitForSelector('#settings-guide-open[data-guide-pending]:enabled');
  const initialPulse = await pulse();
  const heart = await main.locator('.support-button').evaluate((button) => {
    const style = getComputedStyle(button);
    return { animation: style.animationName, duration: style.animationDuration };
  });
  assert.equal(initialPulse.animation, 'support-glow');
  assert.deepEqual(heart, { animation: initialPulse.animation, duration: initialPulse.duration });
  assert.ok(initialPulse.accent);
  assert.equal(initialPulse.color, initialPulse.accent);
  const resetHelp = settings.locator(
    '.settings-help-row:has(> #general-reset-settings) > [data-settings-info]',
  );
  await resetHelp.click();
  await modal.waitFor({ state: 'visible' });
  await settings.locator('#general-reset-settings[data-settings-guide-highlight]').waitFor();
  await next.evaluate((button) => button.click());
  await modal.waitFor({ state: 'hidden' });
  assert.equal((await pulse()).pending, true, 'A contextual explanation is not a full tour');
  await open('general');
  await next.evaluate((button) => button.click());
  await settings.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  assert.equal((await pulse()).pending, true);
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal((await pulse()).animation, 'none');
  assert.equal((await pulse()).pending, true);
  await settings.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  for (const [locale, language] of [
    ['en', 1],
    ['ru', 2],
  ]) {
    await setLanguage(locale);
    let stepCount = 0;
    for (const [section] of SETTINGS_SECTIONS) {
      await open(section, locale === 'en');
      assert.equal(await modal.getAttribute('lang'), locale);
      const steps = settingsGuideSteps(section, content);
      const results = await modal.evaluate((dialog, catalog) => {
        const results = [];
        const next = dialog.querySelector('#settings-guide-next');
        const pane = document.getElementById('companion');
        while (dialog.open && results.length <= catalog.length) {
          const target = pane.querySelector('[data-settings-guide-highlight]');
          const catalogIndex = Number(dialog.dataset.catalogStep);
          const selector = catalog[catalogIndex]?.[3]?.spotlight ?? catalog[catalogIndex]?.[0];
          const frame = dialog.querySelector('.guide-spotlight');
          const bounds = frame.getBoundingClientRect();
          const card = dialog.querySelector('.guide-dialog').getBoundingClientRect();
          const control = target?.matches('label') ? target.control : target;
          const labels = control?.matches('input[type="checkbox"], [role="switch"]')
            ? [...(control.labels ?? [])].filter((label) => label.checkVisibility())
            : [];
          results.push({
            index: Number(dialog.dataset.step),
            catalogIndex,
            title: dialog.querySelector('.guide-title').textContent,
            description: dialog.querySelector('.guide-description').textContent,
            correctTarget: Boolean(
              target &&
                (target.matches(selector) ||
                  (target.matches('#desktop-ai-details > summary') &&
                    target.parentElement.querySelector(selector))),
            ),
            spotlight: Boolean(
              target &&
                !frame.hidden &&
                (catalog[catalogIndex]?.[3]?.spotlight || bounds.bottom < card.top),
            ),
            labelsCovered: labels.every((label) => {
              const rect = label.getBoundingClientRect();
              return (
                bounds.left <= rect.left &&
                bounds.right >= rect.right &&
                bounds.top <= rect.top &&
                bounds.bottom >= rect.bottom
              );
            }),
            animated: dialog.getAnimations({ subtree: true }).length > 0,
          });
          next.click();
        }
        return results;
      }, steps);
      assert.ok(results.length && results.length <= steps.length, section);
      assert.deepEqual(
        results,
        results.map(({ catalogIndex }, index) => ({
          index: index + 1,
          catalogIndex,
          title: steps[catalogIndex][language][0],
          description: steps[catalogIndex][language][1],
          correctTarget: true,
          spotlight: true,
          labelsCovered: true,
          animated: false,
        })),
        `${section} (${locale})`,
      );
      assert.equal(await modal.evaluate((dialog) => dialog.open), false);
      assert.equal((await pulse()).pending, false, `${section} is finished`);
      if (locale === 'en') {
        const helpButtons = await settings.evaluate(() =>
          [...document.querySelectorAll('[data-settings-info][data-guide-step]')]
            .filter((button) => button.checkVisibility({ visibilityProperty: true }))
            .map((button) => ({
              index: Number(button.dataset.guideStep),
              enabled: !button.matches(':disabled'),
            })),
        );
        assert.equal(
          new Set(helpButtons.map(({ index }) => index)).size,
          helpButtons.length,
          `${section} has multiple info buttons for a guide step`,
        );
        for (const { index } of helpButtons.filter(({ enabled }) => enabled)) {
          const help = settings.locator(`[data-settings-info][data-guide-step="${index}"]:visible`);
          assert.equal(await help.count(), 1, `${section} step ${index}`);
          await help.evaluate((button) => button.click());
          try {
            await modal.waitFor({ state: 'visible', timeout: 5000 });
          } catch (error) {
            throw new Error(`${section} step ${index} info did not open`, { cause: error });
          }
          assert.equal(await modal.getAttribute('data-catalog-step'), String(index), section);
          assert.equal(await title.textContent(), steps[index][language][0], section);
          await settings.keyboard.press('Escape');
          await modal.waitFor({ state: 'hidden' });
          await settings.waitForTimeout(50);
        }
      }
      stepCount += results.length;
    }
    report.locales[locale] = { guides: guides.size, steps: stepCount };
    console.log(
      `PASS ${locale}: ${guides.size} tabs, ${stepCount} translated steps with spotlights`,
    );
  }
  report.checks.push('Every visible settings info button opens its unique guide step');

  for (const [section, selectors] of [
    ['support', ['.support-donation-card', '[aria-labelledby="support-community-title"]']],
    [
      'credits',
      [
        '.credits-hero',
        '.credits-team-section',
        '[aria-labelledby="credits-major-title"]',
        '[aria-labelledby="credits-helpers-title"]',
        '.credits-supporters-section',
      ],
    ],
    [
      'developer',
      [
        '#developer-refresh-card',
        '[aria-labelledby="developer-timing-title"]',
        '[aria-labelledby="developer-logs-title"]',
      ],
    ],
  ]) {
    await settingsView(app, section);
    for (const [index, selector] of selectors.entries()) {
      const help = settings
        .locator(`[data-settings-info][data-guide-step="${index}"]:visible`)
        .first();
      await help.waitFor();
      await help.click();
      await modal.waitFor({ state: 'visible' });
      const block = settings.locator(`${selector}[data-settings-guide-highlight]`);
      await block.waitFor();
      const coverage = await modal.evaluate((dialog) => {
        const pane = document.querySelector('#companion').getBoundingClientRect();
        const block = document
          .querySelector('[data-settings-guide-highlight]')
          .getBoundingClientRect();
        const frame = dialog.querySelector('.guide-spotlight').getBoundingClientRect();
        return {
          left: frame.left <= Math.max(pane.left + 2, block.left),
          right: frame.right >= Math.min(pane.right - 2, block.right),
          top: frame.top <= Math.max(pane.top + 3, block.top),
          bottom: frame.bottom >= Math.min(pane.bottom - 3, block.bottom),
        };
      });
      assert.deepEqual(
        coverage,
        { left: true, right: true, top: true, bottom: true },
        `${section} ${selector}`,
      );
      await settings.keyboard.press('Escape');
      await modal.waitFor({ state: 'hidden' });
    }
  }
  report.checks.push('Support, Credits and developer contextual guides frame each whole block');

  await settingsView(app, 'voice');
  for (const [selector, screenshot] of [
    ['#voice-model-details', 'voice-guide-hardware.png'],
    ['#voice-model-import', 'voice-guide-training.png'],
  ]) {
    const help = settings.locator(`.settings-help-row:has(> ${selector}) > [data-settings-info]`);
    const expectedStep = await help.getAttribute('data-guide-step');
    await help.click();
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.getAttribute('data-catalog-step'), expectedStep);
    assert.equal(await settings.locator(`${selector}[data-settings-guide-highlight]`).count(), 1);
    await settings.screenshot({ path: path.join(folder, screenshot), animations: 'disabled' });
    await settings.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await help.evaluate((button) => button === document.activeElement), true);
  }
  report.checks.push('Context help in Spoken replies starts at the right step and returns focus');

  const voiceSteps = settingsGuideSteps('voice', content);
  for (const [source, target] of [
    ['api', '#tts-api-provider'],
    ['local', '#voice-model-details'],
    ['api', '#tts-api-provider'],
    ['local', '#voice-model-details'],
  ]) {
    await settings.locator(`#voice-source-${source}`).click();
    await settings.locator(target).waitFor({ state: 'visible' });
    const index = voiceSteps.findIndex((step) => step[0] === target);
    assert.ok(index >= 0, `${source} voice guide step`);
    const help = settings.locator(`[data-settings-info][data-guide-step="${index}"]:visible`);
    await help.waitFor();
    await settings.waitForTimeout(100);
    assert.equal(await help.count(), 1, `${source} voice help after switching`);
    await help.evaluate((button) => button.click());
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.getAttribute('data-catalog-step'), String(index));
    await settings.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await settings.waitForTimeout(50);
  }
  report.checks.push('Voice source switching keeps one correctly linked help button per step');

  await settings.evaluate(([englishTitle, englishDescription]) => {
    const originalFetch = window.fetch;
    window.fetch = (url, ...args) => {
      if (String(url).endsWith('/locales/guide-fr.json'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              [englishTitle]: 'Masquer Capri dans la zone de notification',
              [englishDescription]: 'La fenêtre se ferme mais Capri continue de fonctionner.',
              '{title} (guide)': '{title} (guide)',
              'Step {current} of {total}': 'Étape {current} sur {total}',
            }),
            { status: 200 },
          ),
        );
      if (String(url).endsWith('/locales/guide-de.json'))
        return Promise.resolve(new Response('', { status: 404 }));
      if (String(url).endsWith('/locales/guide-ar.json'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              [englishTitle]: 'إخفاء كابري في منطقة الإعلام',
              [englishDescription]: 'تختفي النافذة وتواصل كابري العمل في الخلفية.',
              'Step {current} of {total}': 'الخطوة {current} من {total}',
              Back: 'السابق',
              Next: 'التالي',
              'Skip step': 'تخطي الخطوة',
            }),
            { status: 200 },
          ),
        );
      return originalFetch(url, ...args);
    };
  }, guides.get('general')[0][1]);
  await setLanguage('fr');
  await open('general');
  assert.equal(await modal.getAttribute('lang'), 'fr');
  assert.equal(await title.getAttribute('lang'), 'fr');
  assert.equal(await title.textContent(), 'Masquer Capri dans la zone de notification');
  assert.match(await modal.locator('.guide-step').textContent(), /^Étape 1 sur /u);
  assert.equal(
    await settings
      .locator('[data-settings-info][data-guide-step="0"]')
      .evaluateAll((buttons) =>
        buttons.some((button) => button.getAttribute('aria-label')?.includes('Masquer Capri')),
      ),
    true,
  );
  await settingsView(app, 'models');
  await modal.waitFor({ state: 'hidden' });
  report.checks.push('French guide uses its translation, and external navigation closes the tour');

  await setLanguage('de');
  await open('general');
  assert.equal(await title.getAttribute('lang'), 'en');
  assert.equal(await title.textContent(), guides.get('general')[0][1][0]);
  await settings.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  report.checks.push('Missing guide translations fall back to English with the correct language');

  await setLanguage('ar');
  await open('general');
  assert.equal(await title.textContent(), 'إخفاء كابري في منطقة الإعلام');
  assert.equal(await title.evaluate((element) => getComputedStyle(element).direction), 'rtl');
  assert.equal(await modal.evaluate((element) => getComputedStyle(element).direction), 'rtl');
  const rtlNext = await next.boundingBox();
  const rtlBack = await modal.locator('#settings-guide-back').boundingBox();
  assert.ok(rtlNext.x + rtlNext.width < rtlBack.x, 'RTL navigation follows the reading direction');
  await settings.screenshot({
    path: path.join(folder, 'arabic-settings-guide.png'),
    animations: 'disabled',
  });
  assert.match(
    await modal
      .locator('.guide-progress')
      .evaluate((element) => getComputedStyle(element).backgroundImage),
    /270deg/u,
  );
  await settings.keyboard.press('ArrowLeft');
  assert.equal(await modal.getAttribute('data-step'), '2');
  assert.equal(await title.getAttribute('lang'), 'en');
  assert.equal(await title.evaluate((element) => getComputedStyle(element).direction), 'ltr');
  await setLanguage('en');
  await settings.waitForFunction(
    () => document.querySelector('dialog.settings-guide').dataset.uiLocale === 'en',
  );
  assert.equal(await modal.evaluate((element) => getComputedStyle(element).direction), 'ltr');
  await settings.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  report.checks.push('Arabic guide direction, navigation, English fallback and language switch');

  await setLanguage('en');
  await settingsView(app, 'appearance');
  const theme = settings.locator('#theme-preset');
  await theme.selectOption('blackwall');
  const pane = settings.locator('#companion');
  const originalScroll = await pane.evaluate((node) => ((node.scrollTop = 70), node.scrollTop));
  await open('appearance');
  const firstTitle = await title.textContent();
  await settings.keyboard.press('ArrowRight');
  assert.equal(await modal.getAttribute('data-step'), '2');
  await settings.keyboard.press('ArrowLeft');
  assert.equal(await title.textContent(), firstTitle);
  await modal.locator('#settings-guide-skip').click();
  assert.equal(await modal.getAttribute('data-step'), '2');
  await settings.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((button) => button === document.activeElement), true);
  assert.equal(await theme.inputValue(), 'blackwall');
  assert.equal(await pane.evaluate((node) => node.scrollTop), originalScroll);
  assert.equal(await settings.locator('[data-settings-guide-highlight]').count(), 0);
  report.checks.push('Arrow keys, skip and Escape work without changing drafts or scroll position');

  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  await open('appearance');
  assert.ok(
    await modal
      .locator('.guide-spotlight')
      .evaluate((node) => node.getAnimations({ subtree: true }).length >= 4),
  );
  await modal.locator('.guide-close').click();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/settings.html'),
    );
    const { x, y } = window.getBounds();
    window.setBounds({ x, y, width: 410, height: 410 });
  });
  await open('appearance');
  await settings.waitForFunction(() => innerWidth <= 412 && innerHeight <= 412);
  const card = await modal.locator('.guide-dialog').boundingBox();
  const button = await next.boundingBox();
  assert.ok(
    card.x >= 0 && card.y >= 0 && card.x + card.width <= 412 && card.y + card.height <= 412,
  );
  assert.ok(button.y + button.height <= card.y + card.height);
  await settings.screenshot({
    path: path.join(folder, 'narrow-settings-guide.png'),
    animations: 'disabled',
  });
  assert.deepEqual(report.errors, []);
  report.checks.push('Animated entrance and usable controls on a 410 × 410 Settings window');
  await app.close();
  app = await launch();
  await (await app.firstWindow()).waitForFunction(() => document.body.dataset.phase === 'ready');
  const reopened = await settingsView(app, 'general');
  const reopenedOpener = reopened.locator('#settings-guide-open');
  await reopened.waitForSelector('#settings-guide-open:enabled');
  assert.equal(await reopenedOpener.getAttribute('data-guide-pending'), null);
  await reopenedOpener.evaluate((button) => button.click());
  await reopened.locator('dialog.settings-guide[open][data-section="general"]').waitFor();
  report.checks.push(
    'Incomplete guides reuse the heart pulse and theme accent, respect reduced motion, and completed guides remain available across app restarts',
  );
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, folder }));
}
