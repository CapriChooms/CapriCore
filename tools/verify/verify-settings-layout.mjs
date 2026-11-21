// SPDX-License-Identifier: GPL-3.0-only
/** Capture every Settings category in a clean Electron profile for visual review. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { loadCommunityLinks } from '../../apps/desktop/community-links.mjs';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
} from '../../apps/desktop/renderer/settings-registry.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'settings-layout-'));
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

let application;
const narrow = process.argv.includes('--narrow');
const supportOnly = process.argv.includes('--support');
const supportLinks = [
  'boosty-donate',
  'lava-donate',
  'discord',
  'tiktok',
  'youtube',
  'github',
  'website',
];
const sidebarOnly = process.argv.includes('--sidebar');
const themeOnly = process.argv.includes('--theme');
verifyLayout: try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const owner = await application.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  let settings = await settingsView(
    application,
    sidebarOnly ? 'languages' : supportOnly ? 'support' : themeOnly ? 'appearance' : 'general',
  );
  if (supportOnly)
    await application.evaluate(({ shell }) => {
      globalThis.supportExternalLinks = [];
      shell.openExternal = async (url) => globalThis.supportExternalLinks.push(url);
    });
  if (sidebarOnly) {
    const divider = settings.locator('#settings-divider');
    const sidebar = settings.locator('#settings-sidebar');
    const skill = sidebar.locator('[data-section="reasoning"]');
    const width = async () => (await sidebar.boundingBox()).width;
    const drag = async (delta) => {
      const bounds = await divider.boundingBox();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + 24;
      await settings.mouse.move(x, y);
      await settings.mouse.down();
      await settings.mouse.move(x + delta, y, { steps: 5 });
      await settings.mouse.up();
    };
    const checkLayout = () =>
      settings.locator('#companion').evaluate((panel) => ({
        width: panel.clientWidth,
        fits: panel.scrollWidth <= panel.clientWidth + 2,
      }));
    const resizeSettings = (width) =>
      application.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows().find((view) =>
          view.webContents.getURL().endsWith('/settings.html'),
        );
        window.setContentSize(width, 600);
      }, width);

    await settings.locator('#language-interface').selectOption('ru');
    await settings.waitForFunction(() => document.documentElement.lang === 'ru');
    await skill.scrollIntoViewIfNeeded();
    const caption = await skill.locator('span').textContent();
    const initial = await width();
    assert.equal(
      await skill.locator('span').evaluate((element) => getComputedStyle(element).overflowWrap),
      'normal',
    );
    assert.ok((await skill.getAttribute('title')).includes(caption));
    await drag(122);
    const expanded = await width();
    assert.equal(expanded, initial + 122);
    assert.equal(await divider.getAttribute('aria-valuenow'), String(expanded));
    assert.equal(
      await settings.evaluate(() => localStorage.getItem('capri.settings.sidebarWidth.v1')),
      String(expanded),
    );
    assert.ok((await checkLayout()).fits);
    const label = skill.locator('span');
    assert.ok(await label.evaluate((span) => span.scrollWidth <= span.clientWidth));
    await settings.screenshot({
      path: path.join(folder, 'sidebar-ru.png'),
      animations: 'disabled',
    });

    await resizeSettings(420);
    await settings.waitForFunction(() => innerWidth === 420);
    assert.equal(await width(), 160);
    assert.equal(await divider.getAttribute('aria-valuemax'), '160');
    const small = await checkLayout();
    assert.ok(small.width >= 260 && small.fits);

    await resizeSettings(680);
    await settings.waitForFunction(() => innerWidth === 680);
    assert.equal(await width(), expanded);
    await settings.locator('#language-interface').selectOption('en');
    await settings.waitForFunction(() => document.documentElement.lang === 'en');
    await settings.locator('#settings-window-close').click();
    assert.equal(
      await application.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((view) =>
          view.webContents.getURL().endsWith('/settings.html'),
        );
        for (let i = 0; i < 100 && window.isVisible(); i++)
          await new Promise((resolve) => setTimeout(resolve, 25));
        return window.isVisible();
      }),
      false,
    );
    settings = await settingsView(application, 'languages');
    await settings.waitForFunction(() => innerWidth === 680);
    assert.equal(await width(), expanded);
    await divider.press('Home');
    assert.equal(await width(), 120);
    await settings.locator('#language-interface').selectOption('ar');
    await settings.waitForFunction(() => document.documentElement.dir === 'rtl');
    const beta = sidebar.locator('[data-section="chess"] .beta-badge');
    await beta.scrollIntoViewIfNeeded();
    assert.equal(await beta.textContent(), 'BETA');
    const betaBounds = await beta.evaluate((badge) => ({
      badge: badge.getBoundingClientRect().toJSON(),
      caption: badge.parentElement.getBoundingClientRect().toJSON(),
    }));
    assert.ok(
      betaBounds.badge.left >= betaBounds.caption.left - 1 &&
        betaBounds.badge.right <= betaBounds.caption.right + 1,
      JSON.stringify(betaBounds),
    );
    await drag(-120);
    assert.equal(await width(), 240);
    await divider.press('ArrowLeft');
    assert.equal(await width(), 252);
    assert.ok((await checkLayout()).fits);
    await settings.screenshot({
      path: path.join(folder, 'sidebar-ar.png'),
      animations: 'disabled',
    });
    console.log(
      `PASS Settings sidebar drag, keyboard, saved width and RTL. Screenshots: ${folder}`,
    );
    break verifyLayout;
  }
  if (!supportOnly && !themeOnly) {
    assert.equal(
      await settings.locator('[data-settings-group="capri"] [data-section="languages"]').count(),
      1,
    );
    await owner.locator('[data-quick="languages"]').click();
    await settings.locator('[data-section="languages"][aria-current="page"]').waitFor();
    assert.equal(await settings.locator('#language-interface').isVisible(), true);
    await settings.evaluate(() => window.capri.setSkill({ id: 'capri.screen', showButton: true }));
    await owner.locator('#screen-indicator:not([hidden]) svg path').waitFor();
    assert.equal(await owner.locator('#screen-indicator svg path').count(), 1);
    await owner
      .locator('#screen-indicator')
      .screenshot({ path: path.join(folder, 'screen-observation-icon.png') });
    await settings.evaluate(() => window.capri.setSkill({ id: 'capri.screen', showButton: false }));
  }
  if (narrow) {
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((view) =>
        view.webContents.getURL().endsWith('/settings.html'),
      );
      window.setContentSize(420, 600);
    });
    await settings.waitForFunction(() => innerWidth <= 430);
  }
  const errors = [];
  settings.on('pageerror', (error) => errors.push(error.message));
  if (process.argv.includes('--manual')) {
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((view) =>
        view.webContents.getURL().endsWith('/settings.html'),
      );
      window.setTitle('Capri Settings | Layout review');
      window.center();
    });
    console.log('Isolated Settings is ready for manual review. Close it to exit.');
    await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((view) =>
        view.webContents.getURL().endsWith('/settings.html'),
      );
      if (!window.isVisible()) return;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10 * 60 * 1000);
        window.once('hide', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    });
  } else {
    for (const [index, [section, , panel]] of SETTINGS_SECTIONS.entries()) {
      if (themeOnly || (supportOnly && !['support', 'updates'].includes(section))) continue;
      const tab = settings.locator(`[data-section="${section}"]`);
      await tab.click();
      try {
        await tab.and(settings.locator('[aria-current="page"]')).waitFor({ timeout: 8000 });
      } catch (error) {
        const notice = await settings.locator('#settings-notice').textContent();
        await settings.screenshot({ path: path.join(folder, `failed-${section}.png`) });
        throw new Error(`${section} navigation failed: ${notice || errors.join('; ')}`, {
          cause: error,
        });
      }
      await settings.locator(`#${panel}`).waitFor();
      await settings.waitForFunction(
        () => document.getElementById('companion').getAttribute('aria-busy') === 'false',
      );
      assert.ok(
        (await settings
          .locator(
            `#${panel} :is(.settings-card, .settings-disclosure):not(.skill-settings-header *):visible`,
          )
          .count()) > 0,
        `${section} has no visible settings blocks`,
      );
      if (narrow)
        assert.ok(
          await settings.evaluate(() => innerWidth <= 430),
          `${section} lost the resized window width`,
        );
      await settings.locator('#companion').evaluate((main) => {
        main.scrollTop = 0;
      });
      await settings.evaluate(() => document.fonts.ready);
      if (section === 'support') {
        const support = settings.locator('[data-companion-tab="support"]');
        assert.equal(
          await support.locator('[data-community="faq"], [data-community="releases"]').count(),
          0,
        );
        const boostyDonation = support.getByRole('button', {
          name: 'Donate via Boosty',
          exact: true,
        });
        const primary = settings.getByRole('button', { name: 'Donate via Lava.top', exact: true });
        const browser = settings.getByRole('button', {
          name: 'Open donation in browser',
          exact: true,
        });
        assert.equal(await boostyDonation.getAttribute('data-community'), 'boosty-donate');
        if (supportOnly) {
          for (const id of supportLinks) {
            const link = support.locator(`[data-community="${id}"]`);
            await link.waitFor();
            await link.evaluate((button) => button.onclick());
          }
        }
        assert.equal(await primary.getAttribute('id'), 'support-donation-open');
        assert.equal(await browser.getAttribute('data-community'), 'lava-donate');
        const primaryBounds = await primary.boundingBox();
        const browserBounds = await browser.boundingBox();
        assert.ok(primaryBounds && browserBounds);
        assert.ok(browserBounds.y >= primaryBounds.y + primaryBounds.height);
        const marks = await support
          .locator('.support-links button:has(.brand-icon)')
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const icon = button.querySelector('.brand-icon');
              const label = button.lastElementChild.getBoundingClientRect();
              const bounds = button.getBoundingClientRect();
              const labelText = button.lastElementChild.firstChild;
              const range = document.createRange();
              const keepsWordsWhole =
                labelText?.nodeType === Node.TEXT_NODE &&
                [...labelText.data.matchAll(/\S+/gu)].every((word) => {
                  range.setStart(labelText, word.index);
                  range.setEnd(labelText, word.index + word[0].length);
                  return range.getClientRects().length === 1;
                });
              return {
                id:
                  button.id === 'support-donation-open'
                    ? 'lava'
                    : button.dataset.community.replace(/-donate$/, ''),
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                keepsWordsWhole,
                left: label.left - bounds.left,
                right: bounds.right - label.right,
                mask: icon && getComputedStyle(icon).maskImage,
                background: icon && getComputedStyle(icon).backgroundImage,
                iconColor: icon && getComputedStyle(icon).backgroundColor,
                filter: icon && getComputedStyle(icon).filter,
                animation: icon && getComputedStyle(icon).animationName,
                fills: [...button.querySelectorAll('.brand-icon path')].map(
                  (path) => getComputedStyle(path).fill,
                ),
                strokes: [...button.querySelectorAll('.brand-icon path')].map(
                  (path) => getComputedStyle(path).stroke,
                ),
              };
            }),
          );
        assert.deepEqual(
          marks.map(({ id }) => id),
          ['boosty', 'lava', 'discord', 'tiktok', 'youtube', 'github', 'website'],
        );
        const [boosty, lava, discord, tiktok, youtube, github, website] = marks;
        if (narrow) {
          assert.equal(boosty.x, lava.x);
          assert.ok(boosty.y + boosty.height < lava.y);
        } else {
          assert.equal(boosty.y, lava.y);
          assert.ok(boosty.x + boosty.width < lava.x);
        }
        assert.ok(Math.abs(boosty.width - lava.width) < 1);
        assert.ok(Math.abs(boosty.height - lava.height) < 1);
        assert.ok(
          boosty.keepsWordsWhole && lava.keepsWordsWhole,
          'donation labels keep whole words',
        );
        for (const { id, left, right } of marks)
          assert.ok(left >= 5 && right >= 5, `${id} label needs side padding (${left}, ${right})`);
        assert.ok(discord.mask.includes('/brand/discord.svg'));
        assert.equal(discord.iconColor, 'rgb(88, 101, 242)');
        assert.ok(github.mask.includes('/brand/github.svg'));
        assert.equal(github.iconColor, 'rgb(240, 246, 252)');
        assert.ok(tiktok.strokes.includes('rgb(255, 255, 255)'));
        assert.match(tiktok.filter, /rgb\(37, 244, 238\).*rgb\(254, 44, 85\)/);
        assert.ok(youtube.fills.includes('rgb(255, 51, 51)'));
        assert.ok(website.fills.includes('rgb(0, 244, 82)'));
        assert.ok(website.fills.includes('rgb(255, 0, 61)'));
        assert.equal(
          await support.locator('[data-community="website"]').getAttribute('aria-label'),
          'capri-core.com',
        );
        assert.deepEqual(
          await support
            .locator('.site-brand-wordmark > span')
            .evaluateAll((words) =>
              words.map((word) => [word.textContent, getComputedStyle(word).color]),
            ),
          [
            ['CAPRI', 'rgb(0, 244, 82)'],
            ['CORE', 'rgb(255, 0, 61)'],
          ],
        );
        for (const mark of [boosty, lava]) {
          assert.ok(mark.mask.includes(`/brand/${mark.id}.svg`));
          assert.match(mark.background, /linear-gradient/);
          assert.equal(mark.animation, 'support-brand-shimmer');
        }
        if (supportOnly) {
          const frame = support.locator('#support-frame');
          await frame.waitFor();
          await settings.waitForFunction(() => {
            const canvases = document.querySelectorAll('#support-frame canvas');
            return canvases.length === 4 && [...canvases].every((canvas) => canvas.width > 1);
          });
          const geometry = await frame.evaluate((element) => {
            const card = element.closest('.support-donation-card');
            const cardBounds = card.getBoundingClientRect();
            const cardStyle = getComputedStyle(card);
            const frameBounds = element.getBoundingClientRect();
            const scrollport = card.closest('#companion');
            const scrollLeft = scrollport.getBoundingClientRect().left + scrollport.clientLeft;
            const [top, right, bottom, left] = [...element.querySelectorAll('canvas')].map(
              (canvas) => canvas.getBoundingClientRect(),
            );
            const heart = getComputedStyle(card.querySelector('.support-heart')).color;
            const canvas = element.querySelector('canvas');
            const context = canvas.getContext('2d');
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const channels = heart.match(/\d+/g).map(Number);
            let matchingPixels = 0;
            for (let index = 0; index < data.length; index += 4) {
              if (
                data[index + 3] > 75 &&
                channels.every((channel, offset) => Math.abs(data[index + offset] - channel) < 18)
              )
                matchingPixels++;
            }
            window.supportFramePaints = 0;
            const clear = context.clearRect.bind(context);
            context.clearRect = (...args) => {
              window.supportFramePaints++;
              return clear(...args);
            };
            return {
              cardBorder: cardStyle.borderWidth,
              cardOverflow: cardStyle.overflow,
              followsCard:
                Math.abs(frameBounds.top - cardBounds.top) <= 5 &&
                Math.abs(frameBounds.right - cardBounds.right) <= 5 &&
                Math.abs(frameBounds.bottom - cardBounds.bottom) <= 5 &&
                Math.abs(frameBounds.left - cardBounds.left) <= 5,
              paintOutsets: [
                cardBounds.top - top.top,
                right.right - cardBounds.right,
                bottom.bottom - cardBounds.bottom,
                cardBounds.left - left.left,
              ],
              clearsCorners:
                [top, bottom].every(
                  (strip) => strip.left < frameBounds.left && strip.right > frameBounds.right,
                ) &&
                [left, right].every(
                  (strip) => strip.top < frameBounds.top && strip.bottom > frameBounds.bottom,
                ),
              fitsHorizontally:
                left.left >= scrollLeft - 1 &&
                right.right <= scrollLeft + scrollport.clientWidth + 1,
              matchingPixels,
              pointerEvents: getComputedStyle(element).pointerEvents,
              decorative: element.getAttribute('aria-hidden'),
              bloom: Boolean(element.querySelector('filter feGaussianBlur')),
            };
          });
          assert.equal(geometry.cardBorder, '0px', 'the effect is the only card border');
          assert.equal(geometry.cardOverflow, 'visible', 'the card does not clip its sparks');
          assert.ok(geometry.followsCard, 'the effect follows the donation card perimeter');
          assert.ok(
            geometry.paintOutsets.every((outset) => outset > 10),
            `all four glow strips extend beyond the old clipping margin (${geometry.paintOutsets})`,
          );
          assert.ok(geometry.fitsHorizontally, 'the Settings scrollport does not crop the glow');
          assert.ok(geometry.clearsCorners, 'the strips leave painting space beyond the corners');
          assert.ok(geometry.matchingPixels > 20, 'frame pixels match the heart color');
          assert.equal(geometry.pointerEvents, 'none');
          assert.equal(geometry.decorative, 'true');
          assert.ok(geometry.bloom);
          await settings.waitForFunction(() => window.supportFramePaints >= 2);
        }
        await settings.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
          await settings
            .locator('.support-donations .brand-icon')
            .evaluateAll((icons) =>
              icons.every((icon) => getComputedStyle(icon).animationName === 'none'),
            ),
          true,
        );
        if (supportOnly) {
          await settings.waitForFunction(
            () => matchMedia('(prefers-reduced-motion: reduce)').matches,
          );
          await settings.waitForTimeout(120);
          const paints = await settings.evaluate(() => window.supportFramePaints);
          await settings.waitForTimeout(120);
          assert.equal(await settings.evaluate(() => window.supportFramePaints), paints);
        }
        await settings.emulateMedia({ reducedMotion: 'no-preference' });
      }
      if (section === 'updates' && supportOnly) {
        await settings.getByRole('button', { name: 'Lava.top', exact: true }).waitFor();
        const boosty = settings.getByRole('button', { name: 'Boosty', exact: true });
        await boosty.waitFor();
        await boosty.evaluate((button) => button.onclick());
      }
      const metrics = await settings.locator('#companion').evaluate((main) => ({
        width: main.clientWidth,
        content: main.scrollWidth,
        height: main.clientHeight,
        extent: main.scrollHeight,
      }));
      assert.ok(
        metrics.content <= metrics.width + 2,
        `${section} overflows horizontally (${metrics.content}px in ${metrics.width}px)`,
      );
      const heading = await settings
        .locator(`#${panel} h2:visible`)
        .first()
        .evaluate((heading) => {
          const font = Number.parseFloat(getComputedStyle(heading).fontSize);
          const bounds = heading.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width, font };
        });
      const name = `${String(index + 1).padStart(2, '0')}-${section}`;
      await settings.screenshot({ path: path.join(folder, name + '.png'), animations: 'disabled' });
      assert.ok(
        heading.height <= heading.font * 2.6,
        `${section} heading has a collapsed text column (${heading.width}×${heading.height} at ${heading.font}px)`,
      );
      const step = Math.max(200, metrics.height - 120);
      const end = metrics.extent - metrics.height;
      for (let offset = step, row = 2; end > 10; offset += step, row++) {
        const scroll = Math.min(end, offset);
        await settings.locator('#companion').evaluate((main, scroll) => {
          main.scrollTop = scroll;
        }, scroll);
        await settings.screenshot({
          path: path.join(folder, `${name}-${row}.png`),
          animations: 'disabled',
        });
        if (scroll === end) break;
      }
    }
    assert.deepEqual(errors, []);
    if (supportOnly) {
      const opened = await application.evaluate(() => globalThis.supportExternalLinks);
      const links = loadCommunityLinks(root);
      assert.deepEqual(opened.sort(), [...supportLinks, 'boosty'].map((id) => links[id]).sort());
      await settingsView(application, 'updates');
      await settings.locator('#support-frame').waitFor({ state: 'hidden' });
      await settings.waitForTimeout(120);
      const paints = await settings.evaluate(() => window.supportFramePaints);
      await settings.waitForTimeout(120);
      assert.equal(await settings.evaluate(() => window.supportFramePaints), paints);
      await settingsView(application, 'support');
      await settings.waitForFunction(
        () => document.getElementById('companion').getAttribute('aria-busy') === 'false',
      );
      await settings.locator('#companion').evaluate((main) => {
        main.scrollTop = 0;
      });
      await settings.waitForFunction((previous) => window.supportFramePaints > previous, paints);
      await settings.evaluate(() => window.capri.closeSettings());
      await settings.locator('#support-frame').waitFor({ state: 'hidden' });
      const hiddenPaints = await settings.evaluate(() => window.supportFramePaints);
      await settings.waitForTimeout(120);
      assert.equal(await settings.evaluate(() => window.supportFramePaints), hiddenPaints);
      console.log('PASS Support and Updates. Screenshots: ' + folder);
      break verifyLayout;
    }
    await settings.locator('[data-section="appearance"]').click();
    await settings.locator('#theme-preset').selectOption('cyberpunk-2077');
    await settings.locator('#settings-window-close').focus();
    await settings.mouse.move(3, 3);
    await owner.waitForFunction(
      () => document.documentElement.dataset.interfaceTheme === 'cyberpunk-2077',
    );
    await settings.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[data-section="appearance"]')).color ===
          'rgb(118, 239, 233)' &&
        !document.getAnimations().some((effect) => effect instanceof CSSTransition),
    );
    const gameMenuColors = await settings.evaluate(() => {
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      return {
        selection: style('[data-section="appearance"]').color,
        dropdown: style('#theme-preset').color,
        dropdownBorder: style('#theme-preset').borderTopColor,
        preview: style('#glitch-preview').color,
        previewBorder: style('#glitch-preview').borderTopColor,
        frame: style('#companion-settings .panel-outline').stroke,
        themeCard: style('[data-companion-group="Interface theme"]').borderTopColor,
      };
    });
    assert.equal(gameMenuColors.selection, 'rgb(118, 239, 233)');
    for (const [part, color] of Object.entries(gameMenuColors))
      assert.equal(color, gameMenuColors.selection, `${part} uses the menu selection color`);
    const controlFills = await settings.evaluate(() => {
      const fill = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
      return {
        dropdown: fill('#theme-preset'),
        secondDropdown: fill('#memory-style'),
        preview: fill('#glitch-preview'),
        search: fill('#settings-search'),
        backdrop: fill('#settings-header'),
      };
    });
    assert.notEqual(controlFills.dropdown, controlFills.backdrop);
    for (const part of ['secondDropdown', 'preview', 'search'])
      assert.equal(
        controlFills[part],
        controlFills.dropdown,
        `${part} uses the same dark cyan fill`,
      );
    await settings.locator('#companion-panel-title').scrollIntoViewIfNeeded();
    await settings.screenshot({ path: path.join(folder, 'theme-cyberpunk-2077.png') });
    await settings.locator('#theme-preset').selectOption('amethyst');
    const groupIcons = await settings
      .locator('[data-settings-group] > p > svg')
      .evaluateAll((icons) =>
        icons.map((icon) => ({
          path: icon.querySelector('path').getAttribute('d'),
          decorative: icon.getAttribute('aria-hidden') === 'true',
          accent: getComputedStyle(icon).stroke === getComputedStyle(icon).color,
        })),
      );
    assert.equal(groupIcons.length, SETTINGS_GROUPS.length);
    assert.equal(new Set(groupIcons.map(({ path }) => path)).size, SETTINGS_GROUPS.length);
    assert.ok(groupIcons.every(({ decorative, accent }) => decorative && accent));
    assert.equal(
      await settings
        .locator('#companion-settings')
        .evaluate(
          (panel) =>
            getComputedStyle(panel.querySelector('.panel-outline')).stroke ===
            getComputedStyle(panel.querySelector('h3')).color,
        ),
      true,
      'The Settings frame follows the accent preview',
    );
    await settings.locator('#theme-preset').selectOption('custom');
    await settings.locator('#theme-hue').fill('344');
    await settings.locator('#theme-background-hue').fill('351');
    const waitPalette = (accent, background) =>
      owner.waitForFunction(
        ([accent, background]) => {
          const css = document.documentElement.style;
          return (
            css.getPropertyValue('--cyan').startsWith(`hsl(${accent} `) &&
            css.getPropertyValue('--theme-background').startsWith(`hsl(${background} `)
          );
        },
        [accent, background],
      );
    const palette = () =>
      owner.evaluate(() => {
        for (const animation of document.getAnimations())
          if (animation instanceof CSSTransition) animation.finish();
        const read = (selector, property) =>
          getComputedStyle(document.querySelector(selector))[property];
        return {
          portraitFrame: read('#portrait-panel .panel-outline', 'stroke'),
          portraitCorner: read('.frame-corner', 'borderTopColor'),
          replyFrame: read('#subtitle-frame .panel-outline', 'stroke'),
          composerFrame: read('.composer .panel-outline', 'stroke'),
          mic: read('#input-microphone .mic-reticle', 'stroke'),
          attachment: read('#attachment-open svg', 'color'),
          graphBorder: read('.process-graph', 'borderBottomColor'),
          graphFill: read('.process-graph', 'backgroundImage'),
          contextFill: read('#context-hud', 'backgroundColor'),
          portraitFill: read('#portrait-panel', 'backgroundImage'),
        };
      });
    await waitPalette(344, 351);
    const linkPanel = settings.locator('#theme-panel-linked');
    const panelHue = settings.locator('#theme-panel-hue');
    const brightness = settings.locator('#theme-background-brightness');
    assert.equal(await linkPanel.isChecked(), true);
    assert.equal(await panelHue.isDisabled(), true);
    await linkPanel.uncheck();
    await panelHue.fill('238');
    await brightness.fill('14');
    await owner.waitForFunction(() => {
      const styles = document.documentElement.style;
      return (
        styles.getPropertyValue('--theme-panel').startsWith('hsl(238 ') &&
        styles.getPropertyValue('--theme-background').endsWith(' 14%)')
      );
    });
    assert.equal(
      await settings.locator('#theme-background-brightness-output').textContent(),
      '14%',
    );
    const red = await palette();
    await settings.locator('#theme-hue').fill('138');
    await waitPalette(138, 351);
    const green = await palette();
    for (const key of [
      'portraitFrame',
      'portraitCorner',
      'replyFrame',
      'composerFrame',
      'mic',
      'attachment',
      'graphBorder',
    ])
      assert.notEqual(green[key], red[key], `${key} follows the accent`);
    assert.equal(green.contextFill, red.contextFill, 'Accent does not change the context surface');
    await settings.locator('#theme-background-hue').fill('221');
    await waitPalette(138, 221);
    const blue = await palette();
    assert.match(
      await settings.evaluate(() =>
        document.documentElement.style.getPropertyValue('--theme-panel'),
      ),
      /^hsl\(238 /,
    );
    assert.equal(blue.composerFrame, green.composerFrame, 'Background does not change the accent');
    assert.notEqual(blue.portraitFill, green.portraitFill, 'Portrait follows the background');
    for (const key of ['contextFill', 'graphFill'])
      assert.equal(blue[key], green[key], `${key} uses the independent panel color`);
    await settings.locator('[data-companion-group="Interface theme"]').scrollIntoViewIfNeeded();
    const themeCard = await settings
      .locator('[data-companion-group="Interface theme"]')
      .evaluate((card) => ({
        border: getComputedStyle(card).borderInlineStartWidth,
        fits: card.scrollWidth <= card.clientWidth + 2,
      }));
    assert.deepEqual(themeCard, { border: '3px', fits: true });
    await settings.screenshot({
      path: path.join(folder, 'theme-custom.png'),
      animations: 'disabled',
    });
    if (!narrow) {
      await owner.emulateMedia({ reducedMotion: 'reduce' });
      await owner.evaluate(() => window.capri.windowAction('portrait', true));
      await owner.locator('#portrait-panel').waitFor();
      await owner.screenshot({
        path: path.join(folder, 'theme-companion.png'),
        animations: 'disabled',
      });
    }
    assert.equal(await settings.locator('#settings-draft-actions').isHidden(), true);
    await settings.locator('#settings-window-close').click();
    await settings.locator('#settings-draft-actions').waitFor();
    const actionsFit = await settings.locator('#settings-header').evaluate((header) => {
      const bounds = header.getBoundingClientRect();
      return [...header.querySelectorAll('button')].every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right;
      });
    });
    assert.equal(actionsFit, true, 'Save, Discard, Keep editing and Close fit the header');
    await settings.screenshot({
      path: path.join(folder, 'close-draft.png'),
      animations: 'disabled',
    });
    await settings.locator('#settings-discard').click();
    if (themeOnly) {
      await owner.waitForFunction(
        () => document.documentElement.dataset.interfaceTheme === 'capri',
      );
      settings = await settingsView(application, 'appearance');
      await settings.locator('#theme-preset').selectOption('custom');
      await settings.locator('#theme-panel-linked').uncheck();
      await settings.locator('#theme-panel-hue').fill('212');
      await settings.locator('#theme-background-brightness').fill('16');
      await settings.locator('#settings-window-close').click();
      await settings.locator('#settings-apply').click();
      await settings.locator('#settings-draft-actions').waitFor({ state: 'hidden' });
      await settings.locator('#settings-window-close').click();
      settings = await settingsView(application, 'appearance');
      assert.equal(await settings.locator('#theme-preset').inputValue(), 'custom');
      assert.equal(await settings.locator('#theme-panel-linked').isChecked(), false);
      assert.equal(await settings.locator('#theme-panel-hue').inputValue(), '212');
      assert.equal(await settings.locator('#theme-background-brightness').inputValue(), '16');
      console.log('PASS theme preview, layout, discard and save. Screenshots: ' + folder);
      break verifyLayout;
    }
    await settings.evaluate(async () => {
      await window.capri.setSkill({ id: 'capri.timers', enabled: true });
      await window.capri.setSkill({ id: 'capri.timers', showButton: true });
    });
    await owner.evaluate(() => window.capri.timeAction({ action: 'stopwatch' }));
    await owner.locator('#quick-actions #stopwatch-hud').waitFor();
    assert.equal(await owner.locator('#handle #context-hud').count(), 1);
    assert.equal(await owner.locator('[data-quick="time"]').isHidden(), true);
    await owner.evaluate(async () => {
      if (document.body.dataset.presence !== 'core')
        await window.capri.windowAction('portrait', false);
    });
    await owner.waitForFunction(() => document.body.dataset.presence === 'core');
    const toolbarFits = await owner.locator('#quick-actions').evaluate((nav) => {
      const bounds = nav.getBoundingClientRect();
      return [...nav.querySelectorAll('button')]
        .filter((button) => button.getClientRects().length)
        .every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        });
    });
    assert.equal(toolbarFits, true, 'Stopwatch and quick actions fit the compact second row');
    console.log(`PASS ${SETTINGS_SECTIONS.length} Settings categories. Screenshots: ${folder}`);
  }
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
