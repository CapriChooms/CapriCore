// SPDX-License-Identifier: GPL-3.0-only
/** Capture every Settings category in a clean Electron profile for visual review. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
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
const sidebarOnly = process.argv.includes('--sidebar');
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
    sidebarOnly ? 'languages' : supportOnly ? 'support' : 'general',
  );
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
  if (!supportOnly) {
    assert.equal(
      await settings.locator('[data-settings-group="capri"] [data-section="languages"]').count(),
      1,
    );
    await owner.locator('[data-quick="languages"]').click();
    await settings.locator('[data-section="languages"][aria-current="page"]').waitFor();
    assert.equal(await settings.locator('#language-interface').isVisible(), true);
    assert.equal(await owner.locator('#screen-indicator svg circle').count(), 1);
    await owner
      .locator('#screen-indicator')
      .screenshot({ path: path.join(folder, 'screen-observation-icon.png') });
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
      if (supportOnly && !['support', 'updates'].includes(section)) continue;
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
        const marks = await settings.locator('.support-links button').evaluateAll((buttons) =>
          buttons.map((button) => {
            const icon = button.querySelector('.brand-icon');
            const label = button.lastElementChild.getBoundingClientRect();
            const bounds = button.getBoundingClientRect();
            return {
              id: button.dataset.community,
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              left: label.left - bounds.left,
              right: bounds.right - label.right,
              ink: getComputedStyle(button).color,
              mask: icon && getComputedStyle(icon).maskImage,
              background: icon && getComputedStyle(icon).backgroundImage,
              animation: icon && getComputedStyle(icon).animationName,
            };
          }),
        );
        assert.deepEqual(
          marks.map(({ id }) => id),
          [
            'boosty',
            'lava',
            'discord',
            'tiktok',
            'youtube',
            'github',
            'website',
            'faq',
            'releases',
          ],
        );
        const [boosty, lava, ...other] = marks;
        assert.equal(boosty.y, lava.y);
        assert.ok(boosty.x + boosty.width < lava.x);
        assert.ok(Math.abs(boosty.width - lava.width) < 1);
        for (const { id, left, right } of marks)
          assert.ok(left >= 5 && right >= 5, `${id} label needs side padding (${left}, ${right})`);
        assert.equal(new Set(other.map(({ ink }) => ink)).size, 1);
        for (const mark of [boosty, lava]) {
          assert.ok(mark.mask.includes(`/brand/${mark.id}.svg`));
          assert.match(mark.background, /linear-gradient/);
          assert.equal(mark.animation, 'support-brand-shimmer');
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
        await settings.emulateMedia({ reducedMotion: 'no-preference' });
      }
      if (section === 'updates' && supportOnly) {
        await settings.locator('#updates-lava').waitFor();
        assert.match(await settings.locator('#updates-lava').textContent(), /Lava\.top/);
      }
      const metrics = await settings.locator('#companion').evaluate((main) => ({
        width: main.clientWidth,
        content: main.scrollWidth,
        height: main.clientHeight,
        extent: main.scrollHeight,
      }));
      assert.ok(metrics.content <= metrics.width + 2, `${section} overflows horizontally`);
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
      console.log('PASS Support and Updates. Screenshots: ' + folder);
      break verifyLayout;
    }
    await settings.locator('[data-section="appearance"]').click();
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
    assert.equal(blue.composerFrame, green.composerFrame, 'Background does not change the accent');
    for (const key of ['portraitFill', 'graphFill', 'contextFill'])
      assert.notEqual(blue[key], green[key], `${key} follows the background`);
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
