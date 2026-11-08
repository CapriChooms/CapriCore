// SPDX-License-Identifier: GPL-3.0-only
// Isolated real renderers/native windows; no models, audio or physical cursor input.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { COMPANION_DEFAULTS } from '../../apps/desktop/companion-settings.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/hotfix-063');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-'));
mkdirSync(path.join(folder, 'desktop'));
writeFileSync(
  path.join(folder, 'desktop/companion.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: { ...COMPANION_DEFAULTS, replyAutoHide: false, floatEnabled: false },
  }),
);
writeFileSync(
  path.join(folder, 'desktop/transcript.json'),
  JSON.stringify({
    schemaVersion: 1,
    messages: [
      {
        id: 'ui-answer',
        turnId: 'ui-turn',
        role: 'assistant',
        text: 'A synthetic answer for checking the collapsed home frame.',
        createdAt: '2025-01-01T00:00:00.000Z',
        status: 'complete',
      },
    ],
  }),
);
const server = createServer((_request, response) =>
  response.setHeader('content-type', 'application/json').end('{"data":[]}'),
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  TEMP: folder,
  TMP: folder,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
const report = {
  passed: false,
  folder,
  checks: [],
  errors: [],
  missingResources: [],
  physicalCursorInput: false,
  modelsStarted: false,
  samples: [],
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
  const owner = await application.firstWindow();
  owner.on('response', (response) => {
    if (response.status() === 404) report.missingResources.push(response.url());
  });
  await owner.waitForFunction(() => document.body.dataset.initialized === 'true');
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL().endsWith('/index.html'))
      .webContents.send('capri:event', { type: 'startup-intro.skip' }),
  );
  await owner.emulateMedia({ reducedMotion: 'reduce' });
  if ((await owner.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await owner.locator('#presence-toggle').click();
  await owner.waitForFunction(() => document.body.dataset.presence === 'portrait');
  const snapshot = () =>
    owner.evaluate(() => {
      const box = (id) => {
        const { x, y, width, height } = document.getElementById(id).getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        frame: box('portrait-panel'),
        handle: box('handle'),
        actions: box('quick-actions'),
        stage: box('subtitle-stage'),
        reveal: box('subtitle-reveal'),
        hidden: document.body.dataset.replyHidden,
        revealInToolbar: document
          .getElementById('quick-actions')
          .contains(document.getElementById('subtitle-reveal')),
      };
    });
  for (const height of [760, 580, 460]) {
    await application.evaluate(
      ({ BrowserWindow }, height) =>
        BrowserWindow.getAllWindows()
          .find((view) => view.webContents.getURL().endsWith('/index.html'))
          .setContentSize(480, height),
      height,
    );
    await owner.waitForTimeout(150);
    const expanded = await snapshot();
    await owner.locator('#subtitle-collapse').click();
    await owner.waitForFunction(() => document.body.dataset.replyHidden === 'true');
    const collapsed = await snapshot();
    assert.deepEqual(collapsed.frame, expanded.frame, 'Collapse must preserve frame geometry');
    assert(
      collapsed.handle.y > expanded.handle.y + 50,
      'Toolbar must move down instead of stretching the frame',
    );
    assert.equal(collapsed.stage.height, 0);
    assert(collapsed.revealInToolbar);
    assert(
      collapsed.actions.y + collapsed.actions.height <= collapsed.frame.y - 9,
      'Toolbar must not overlap the frame status',
    );
    await owner.screenshot({
      path: path.join(folder, `collapsed-${height}.png`),
      omitBackground: true,
    });
    await owner.locator('#subtitle-reveal').click();
    await owner.waitForFunction(() => document.body.dataset.replyHidden === 'false');
    assert.deepEqual((await snapshot()).frame, expanded.frame);
    report.samples.push({ height, expanded, collapsed });
  }
  report.checks.push(
    'Collapsed answer keeps the original home frame at three viewport heights; both toolbar rows move down; reveal stays in the quick-action row',
  );
  await owner.locator('#history-toggle').click();
  await owner.waitForFunction(() => !document.getElementById('history-panel').hidden);
  const history = await owner.evaluate(() => {
    const actions = document.getElementById('quick-actions').getBoundingClientRect(),
      panel = document.getElementById('history-panel').getBoundingClientRect();
    return {
      actionsBottom: actions.bottom,
      panelTop: panel.top,
      pressed: document.getElementById('history-toggle').getAttribute('aria-expanded'),
    };
  });
  assert(history.actionsBottom <= history.panelTop + 1);
  assert.equal(history.pressed, 'true');
  await owner.locator('#history-close').click();
  report.checks.push('Opening history retains separate toolbar and conversation rows');

  const settings = await settingsView(application, 'credits');
  await settings.locator('.credits-team-card[data-in-view]').first().waitFor();
  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  await settings.waitForTimeout(200);
  const rays = await settings.evaluate(() =>
    [...document.querySelectorAll('.credits-team-card')].map((card) => {
      const ink = card.querySelector('.credits-team-name'),
        layer = card.querySelector('.credits-god-rays');
      return {
        name: ink.textContent,
        layers: card.querySelectorAll('.credits-ray-sheet').length,
        projections: card.querySelectorAll('.credits-glyph-ray').length,
        ariaHidden: layer.getAttribute('aria-hidden'),
        overflow: getComputedStyle(layer).overflow,
        contain: getComputedStyle(layer).contain,
        mask: getComputedStyle(layer).maskImage,
        sheen: getComputedStyle(card.querySelector('.credits-glyph-sheen'), '::before')
          .animationName,
        driftOwnsRays: card.querySelector('.credits-drift').contains(layer),
      };
    }),
  );
  assert.equal(rays.length, 3);
  for (const ray of rays) {
    assert.equal(ray.layers, 3);
    assert.equal(ray.projections, 30);
    assert.equal(ray.ariaHidden, 'true');
    assert.equal(ray.overflow, 'visible');
    assert.equal(ray.contain, 'none');
    assert(ray.mask.includes('radial-gradient'));
    assert.equal(ray.sheen, 'credits-glyph-sheen');
    assert(ray.driftOwnsRays);
  }
  assert(
    await settings
      .locator('#companion')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 2),
  );
  await settings.screenshot({ path: path.join(folder, 'credits-rays.png') });
  report.rays = rays;
  report.checks.push(
    'Three team names emit glyph-derived feathered rays with a letter sheen, shared drift, decorative accessibility and no horizontal page overflow',
  );
  await settings.locator('#settings-window-close').click();

  await owner.evaluate(() => window.capri.windowAction('hide'));
  let chip;
  for (let attempt = 0; attempt < 100; attempt++) {
    chip = application.windows().find((view) => view.url().endsWith('/minimized-chip.html'));
    if (chip) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert(chip);
  await chip.waitForFunction(() => Boolean(window.capriChip));
  await chip.mouse.move(0, 0);
  const normal = await chip.locator('button').evaluate((node) => ({
    color: getComputedStyle(node).color,
    fill: getComputedStyle(node.querySelector('.shell')).fill,
  }));
  await chip.locator('button').hover();
  await chip.waitForTimeout(220);
  const hover = await chip.locator('button').evaluate((node) => ({
    color: getComputedStyle(node).color,
    fill: getComputedStyle(node.querySelector('.shell')).fill,
    filter: getComputedStyle(node.querySelector('svg')).filter,
  }));
  assert.notEqual(hover.color, normal.color);
  assert.notEqual(hover.fill, normal.fill);
  assert.notEqual(hover.filter, 'none');
  await chip.screenshot({ path: path.join(folder, 'chip-hover.png'), omitBackground: true });
  report.checks.push('Restore chip hover changes the themed colour, shell and glow');
  const chipBounds = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((view) => view.webContents.getURL().endsWith('/minimized-chip.html'))
        .getBounds(),
    );
  let initial = await chipBounds();
  // Only this disposable Electron process sees the injected cursor. No OS cursor is moved.
  await application.evaluate(
    ({ screen }, pointer) => {
      const original = screen.getCursorScreenPoint.bind(screen);
      globalThis.__chipFixtureCursor = pointer;
      screen.getCursorScreenPoint = () => globalThis.__chipFixtureCursor ?? original();
    },
    { x: initial.x + 26, y: initial.y + 26 },
  );
  await chip.mouse.move(26, 26);
  await chip.mouse.down();
  await application.evaluate(
    (_electron, pointer) => {
      globalThis.__chipFixtureCursor = pointer;
    },
    { x: initial.x - 120 + 26, y: initial.y - 80 + 26 },
  );
  await chip.mouse.move(-94, -54);
  await chip.waitForTimeout(80);
  await chip.mouse.up();
  const moved = await chipBounds();
  assert.equal(moved.width, initial.width);
  assert.equal(moved.height, initial.height);
  assert.equal(moved.x, initial.x - 120);
  assert.equal(moved.y, initial.y - 80);
  assert(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (view) => view.webContents.getURL().endsWith('/minimized-chip.html') && view.isVisible(),
      ),
    ),
  );
  await application.evaluate(
    (_electron, pointer) => {
      globalThis.__chipFixtureCursor = pointer;
    },
    { x: moved.x + 26, y: moved.y + 26 },
  );
  await chip.locator('button').click();
  await owner.waitForFunction(() => document.visibilityState === 'visible');
  await owner.evaluate(() => window.capri.windowAction('hide'));
  await chip.waitForFunction(() => document.visibilityState === 'visible');
  assert.deepEqual(await chipBounds(), moved);
  report.checks.push(
    'Actual chip renderer pointer gesture moves its native window at unchanged size; post-drag click does not restore; ordinary click restores; next minimize preserves the moved position (injected DIP cursor, not physical mouse)',
  );
  await chip.emulateMedia({ reducedMotion: 'reduce' });
  await chip.locator('button').hover();
  assert.equal(
    await chip.locator('.sheen').evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  report.checks.push('Restore chip respects reduced motion');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missingResources, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
