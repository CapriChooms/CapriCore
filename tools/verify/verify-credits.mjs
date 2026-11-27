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
import { uiText } from '../../apps/desktop/interface-translations.mjs';

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
  await settings.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    let release;
    const rosterGate = new Promise((resolve) => (release = resolve));
    window.releaseCreditsRoster = () => {
      window.fetch = originalFetch;
      CanvasRenderingContext2D.prototype.fillText = fillText;
      CanvasRenderingContext2D.prototype.drawImage = drawImage;
      release();
    };
    window.fetch = async (source, options) => {
      if (typeof source === 'string' && source.endsWith('hall-of-fame.json')) {
        window.creditsRosterPending = true;
        await rosterGate;
        window.creditsRosterPending = false;
      }
      return originalFetch(source, options);
    };
    window.creditsRasterizedNames = [];
    window.creditsSheetDraws = 0;
    CanvasRenderingContext2D.prototype.fillText = function (name, x, y, ...args) {
      window.creditsRasterizedNames.push({ name, x, y });
      return fillText.call(this, name, x, y, ...args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('canvas.credits-ray-sheet')) window.creditsSheetDraws++;
      return drawImage.apply(this, args);
    };
  });
  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  await settings.locator('[data-section="credits"]').click();
  const panel = settings.locator('#credits-panel');
  await panel.waitFor();
  await settings.waitForFunction(
    () =>
      window.creditsRosterPending === true &&
      document.getElementById('companion').getAttribute('aria-busy') === 'false',
    undefined,
    { timeout: 5000 },
  );
  const teamRays = panel.locator('.credits-god-rays > canvas.credits-ray-sheet');
  assert.equal(await teamRays.count(), roster.team.length);
  await settings.waitForFunction(() => {
    const canvases = [...document.querySelectorAll('canvas.credits-ray-sheet')];
    return canvases.length > 0 && canvases.every((canvas) => canvas.width > 1 && canvas.height > 1);
  });
  const painted = await teamRays.evaluateAll((canvases) => {
    window.creditsOpeningCanvases = canvases;
    return canvases.map((canvas) => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const hasRays = data.some((channel, index) => index % 4 === 3 && channel > 10);
      return {
        hasRays,
        pointerEvents: getComputedStyle(canvas.parentElement).pointerEvents,
        cssAnimations: canvas.getAnimations().length,
      };
    });
  });
  assert(
    painted.every(
      ({ hasRays, pointerEvents, cssAnimations }) =>
        hasRays && pointerEvents === 'none' && !cssAnimations,
    ),
  );
  assert.equal(
    await panel.locator('.credits-god-rays[aria-hidden="true"]').count(),
    roster.team.length,
  );
  await settings.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const rasterizedNames = () => settings.evaluate(() => window.creditsRasterizedNames);
  const initialMasks = await rasterizedNames();
  for (const { name } of roster.team.filter(({ name }) => name !== 'Hastur-Dev'))
    assert(
      initialMasks.some((entry) => entry.name === name),
      `Missing nickname in projection mask: ${name}`,
    );
  const hasturLines = await panel
    .getByRole('link', { name: 'Hastur-Dev', exact: true })
    .evaluate((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      return Array.from(range.getClientRects(), ({ left, top }) => ({ left, top }));
    });
  assert.equal(hasturLines.length, 2, 'The default grid wraps Hastur-Dev over two lines');
  const hasturMask = initialMasks.filter(({ name }) =>
    ['Hastur-Dev', 'Hastur-', 'Dev'].includes(name),
  );
  assert.deepEqual(
    hasturMask.map(({ name }) => name),
    ['Hastur-', 'Dev'],
  );
  const [firstLine, secondLine] = hasturLines;
  const [firstMask, secondMask] = hasturMask;
  assert(Math.abs(secondMask.x - firstMask.x - (secondLine.left - firstLine.left)) < 0.5);
  assert(Math.abs(secondMask.y - firstMask.y - (secondLine.top - firstLine.top)) < 0.5);
  const { initialDraws, initialProjection } = await teamRays.first().evaluate((canvas) => ({
    initialDraws: window.creditsSheetDraws,
    initialProjection: canvas.toDataURL(),
  }));
  assert(initialDraws > 0, 'Composed ray textures are written to the visible sheets');
  await settings.waitForFunction(
    ({ initialDraws, initialProjection }) =>
      window.creditsSheetDraws > initialDraws &&
      document.querySelector('canvas.credits-ray-sheet').toDataURL() !== initialProjection,
    { initialDraws, initialProjection },
    { polling: 80, timeout: 3000 },
  );
  assert.deepEqual(
    await rasterizedNames(),
    initialMasks,
    'Animation reuses the rasterized letters',
  );
  assert.equal(
    await panel.locator('.credits-team .credits-spark-sheet').count(),
    roster.team.length,
  );
  await settings.waitForFunction(() => {
    const canvases = [...document.querySelectorAll('.credits-team .credits-spark-sheet')];
    return canvases.every((canvas) => {
      const hex = getComputedStyle(canvas).getPropertyValue('--name-glow').trim();
      const color = hex
        .slice(1)
        .match(/../g)
        .map((value) => parseInt(value, 16));
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          pixels[offset + 3] > 36 &&
          color.every((component, index) => Math.abs(pixels[offset + index] - component) < 42)
        )
          return true;
      }
      return false;
    });
  });
  report.checks.push('All team nicknames have visible sparks in their own palette');
  await settings.evaluate(() => window.releaseCreditsRoster());
  await panel.getByText(roster.supporters[0], { exact: true }).waitFor();
  assert.equal(
    await teamRays.evaluateAll((canvases) =>
      canvases.every((canvas, index) => canvas === window.creditsOpeningCanvases[index]),
    ),
    true,
    'The supporter registry updates without rebuilding or restarting team rays',
  );
  report.checks.push(
    'Team rays paint before the pending roster and align with both lines of the wrapped nickname',
  );
  const text = await panel.textContent();
  for (const person of [...roster.team.map(({ name }) => name), ...roster.supporters])
    assert(text.includes(person), 'Missing credit: ' + person);
  assert.deepEqual(
    await panel.locator('#credits-community-helpers .credits-name-gradient').allTextContents(),
    roster.communityHelpers,
  );
  assert.deepEqual(
    await panel.locator('.credits-team').evaluate((list) => {
      const center = (list.getBoundingClientRect().left + list.getBoundingClientRect().right) / 2;
      const rows = new Map();
      for (const card of list.children) {
        const { left, right } = card.getBoundingClientRect();
        const row = rows.get(card.offsetTop) ?? { left, right };
        rows.set(card.offsetTop, { left: Math.min(row.left, left), right: Math.max(row.right, right) });
      }
      return [...rows.values()].map(({ left, right }) => Math.round((left + right) / 2 - center));
    }),
    [0, 0],
  );
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
  await application.evaluate(({ shell }) => {
    globalThis.openedCreditProfiles = [];
    shell.openExternal = async (url) => globalThis.openedCreditProfiles.push(url);
  });
  const profiles = new Map([
    ['Overyx', 'https://github.com/Overyx'],
    ['Hastur-Dev', 'https://github.com/hastur-dev'],
    ['Frkn97', 'https://github.com/Frkn97'],
    ['lattelix', 'https://github.com/lattelix'],
  ]);
  const team = panel.locator('#credits-team');
  assert.equal(await team.getByRole('link').count(), profiles.size);
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, url] of profiles) {
    const link = team.getByRole('link', { name, exact: true });
    assert.equal(await link.getAttribute('href'), url);
    await link.click();
  }
  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  assert.deepEqual(await application.evaluate(() => globalThis.openedCreditProfiles), [
    ...profiles.values(),
  ]);
  report.checks.push('Linked team names open the expected GitHub profiles in the system browser');
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
    assert.equal(
      await team.locator('.credits-team-card').first().locator('.credits-team-role').textContent(),
      uiText('Main developer', locale),
    );
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
