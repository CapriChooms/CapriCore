// SPDX-License-Identifier: GPL-3.0-only
/** Floating credits in the real settings window, with a disposable profile and no models. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/credits-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'motion-'));
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
const report = { passed: false, folder, checks: [], samples: [], errors: [], externalRequests: [] };
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
  const settings = await settingsView(application, 'credits');
  settings.on('request', (req) => {
    if (/^https?:/u.test(req.url()) && !req.url().startsWith('http://127.0.0.1:'))
      report.externalRequests.push(req.url());
  });
  const panel = settings.locator('#credits-panel');
  await panel.locator('.credits-supporter').last().waitFor({ state: 'attached' });
  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  const settle = () =>
    settings.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const snapshot = () =>
    settings.evaluate(() => {
      const panel = document.getElementById('credits-panel');
      const viewport = document.getElementById('companion');
      const root = viewport.getBoundingClientRect();
      const animations = document.getAnimations().filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element && panel.contains(target);
      });
      const running = animations.filter((animation) => animation.playState === 'running');
      const names = [...panel.querySelectorAll('.credits-floating-item')].map((item) => {
        const drift = item.querySelector('.credits-drift');
        const text = item.querySelector('.credits-name-gradient');
        const style = getComputedStyle(item);
        const ink = getComputedStyle(text);
        const transform = getComputedStyle(drift).transform;
        const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
        const rect = text.getBoundingClientRect();
        const kind = item.classList.contains('credits-team-card')
          ? 'team'
          : item.classList.contains('credits-supporter')
            ? 'supporter'
            : 'featured';
        return {
          key: `${kind}:${text.textContent}`,
          kind,
          name: text.textContent,
          visible:
            !item.hidden &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > root.left &&
            rect.left < root.right &&
            rect.bottom > root.top &&
            rect.top < root.bottom,
          observed: item.hasAttribute('data-in-view'),
          border: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          gradient: ink.backgroundImage,
          fill: ink.webkitTextFillColor,
          bloom: ink.textShadow,
          transform,
          offset: { x: matrix.m41, y: matrix.m42 },
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          running: running.some((animation) => animation.effect.target === drift),
        };
      });
      return {
        total: names.length,
        running: running.length,
        runningNames: names.filter((name) => name.running).length,
        observed: names.filter((name) => name.observed).length,
        visible: names.filter((name) => name.visible),
        offscreenRunning: names.filter((name) => name.running && !name.observed).length,
        heroHeight: panel.querySelector('.credits-hero').getBoundingClientRect().height,
        overflow: viewport.scrollWidth - viewport.clientWidth,
        names,
      };
    });
  const waitForMotion = () =>
    settings.waitForFunction(
      () =>
        document.getAnimations().some((animation) => {
          const target = animation.effect?.target;
          return (
            target instanceof Element &&
            target.matches('#credits-panel .credits-drift') &&
            animation.playState === 'running'
          );
        }),
      undefined,
      { timeout: 10000 },
    );
  const assertGeometry = (sample, label) => {
    report.samples.push({
      label,
      total: sample.total,
      visible: sample.visible.length,
      observed: sample.observed,
      runningNames: sample.runningNames,
      running: sample.running,
      heroHeight: sample.heroHeight,
    });
    assert(
      sample.runningNames > 0 && sample.runningNames < 60,
      `${label}: bounded active names (${sample.runningNames} running, ${sample.visible.length} visible, ${sample.observed} observed)`,
    );
    assert.equal(sample.offscreenRunning, 0, label + ': unseen names do no animation work');
    assert(sample.observed < 60, label + ': observer follows the viewport');
    assert(sample.overflow <= 2, label + ': horizontal overflow');
    for (let a = 0; a < sample.visible.length; a++)
      for (let b = a + 1; b < sample.visible.length; b++) {
        const x = sample.visible[a].rect;
        const y = sample.visible[b].rect;
        assert(
          x.right <= y.left + 0.5 ||
            y.right <= x.left + 0.5 ||
            x.bottom <= y.top + 0.5 ||
            y.bottom <= x.top + 0.5,
          `${label}: nickname overlap: ${sample.visible[a].name} / ${sample.visible[b].name}`,
        );
      }
  };
  await settle();
  await waitForMotion();
  let sample = await snapshot();
  assert.equal(
    sample.total,
    roster.team.length +
      roster.supporters.length +
      (roster.majorSupporters?.length ?? 0) +
      (roster.communityHelpers?.length ?? 0),
  );
  assert.equal(await panel.locator('.credits-supporter').count(), roster.supporters.length);
  for (const member of roster.team) {
    assert(
      await panel.locator('#credits-team').getByText(member.name, { exact: true }).isVisible(),
    );
    assert(
      await panel.locator('#credits-team').getByText(member.role, { exact: true }).isVisible(),
    );
  }
  assert(sample.heroHeight <= 115, 'Hall of Fame title must remain compact');
  for (const name of sample.names) {
    assert(
      name.border.every((width) => width === '0px'),
      'Nicknames have no card border',
    );
    assert.equal(name.background, 'rgba(0, 0, 0, 0)', 'Nicknames have no card fill');
    assert.equal(name.backgroundImage, 'none', 'Nicknames have no background panel');
    assert(name.gradient.includes('gradient('), 'Nickname text has a color gradient');
    assert.equal(name.fill, 'rgba(0, 0, 0, 0)', 'Gradient is clipped into readable text');
    assert.notEqual(name.bloom, 'none', 'Nickname text has lightweight bloom');
  }
  assertGeometry(sample, 'top');
  await settings.screenshot({ path: path.join(folder, 'top.png') });
  report.checks.push(
    'Complete roster and three team roles; compact title; unboxed gradient text with bloom',
  );

  await panel.locator('#credits-supporters-title').scrollIntoViewIfNeeded();
  await settle();
  await waitForMotion();
  sample = await snapshot();
  assertGeometry(sample, 'supporters');
  const before = new Map(sample.visible.map((name) => [name.key, name.offset]));
  await settings.waitForTimeout(280);
  const moved = await snapshot();
  assert(
    moved.visible.some(
      (name) => before.has(name.key) && Math.abs(before.get(name.key).y - name.offset.y) > 0.05,
    ),
    'Visible names bob vertically between frames',
  );
  assert(
    moved.visible.every(
      (name) => !before.has(name.key) || Math.abs(before.get(name.key).x - name.offset.x) < 0.05,
    ),
    'Nickname motion stays vertical',
  );
  assertGeometry(moved, 'supporters after motion');

  // Sample frame delivery without adding a renderer timer or a per-name measurement loop.
  report.frames = await settings.evaluate(
    () =>
      new Promise((resolve) => {
        const stamps = [];
        const frame = (stamp) => {
          stamps.push(stamp);
          if (stamps.length < 121) requestAnimationFrame(frame);
          else {
            const intervals = stamps.slice(1).map((value, index) => value - stamps[index]);
            const sorted = intervals.toSorted((a, b) => a - b);
            resolve({
              count: intervals.length,
              elapsedMs: stamps.at(-1) - stamps[0],
              medianMs: sorted[Math.floor(sorted.length / 2)],
              p95Ms: sorted[Math.floor(sorted.length * 0.95)],
              maxMs: sorted.at(-1),
            });
          }
        };
        requestAnimationFrame(frame);
      }),
  );
  report.checks.push('Visible vertical movement and 120-frame renderer sample recorded');
  const initialNames = new Set(sample.visible.map((name) => name.key));
  await settings.locator('#companion').evaluate((main) => {
    main.scrollTop = main.scrollHeight / 2;
  });
  await settings.waitForTimeout(100);
  await settle();
  sample = await snapshot();
  assertGeometry(sample, 'middle');
  assert(
    sample.visible.every((name) => !initialNames.has(name.key)),
    'Viewport moved to a new roster region',
  );
  assert(
    sample.names.filter((name) => initialNames.has(name.key)).every((name) => !name.running),
    'Names left above the viewport release their animations',
  );
  await settings.screenshot({ path: path.join(folder, 'middle.png') });
  report.checks.push('Scrolling bounds motion work to the viewport and stops names left behind');

  const search = panel.getByLabel('Find a nickname', { exact: true });
  await search.fill(roster.supporters.at(-1));
  await settle();
  sample = await snapshot();
  assert(
    sample.names.filter((name) => name.kind === 'supporter' && name.running).length <= 1,
    'Search does not retain animations for filtered supporter names',
  );
  await search.fill('');
  await settle();
  await waitForMotion();
  report.checks.push('Search releases filtered nickname animations');

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL().endsWith('/settings.html'))
      .setContentSize(420, 620);
  });
  await settings.waitForFunction(() => innerWidth <= 430);
  await settings.locator('#companion').evaluate((main) => {
    main.scrollTop = main.scrollHeight / 2;
  });
  await settle();
  await settings.waitForTimeout(100);
  sample = await snapshot();
  assertGeometry(sample, 'narrow middle');
  await settings.screenshot({ path: path.join(folder, 'narrow.png') });
  report.checks.push('Narrow window keeps names separate and avoids horizontal overflow');

  const runningCount = () =>
    panel.evaluate(
      (node) =>
        document.getAnimations().filter((animation) => {
          const target = animation.effect?.target;
          return (
            target instanceof Element && node.contains(target) && animation.playState === 'running'
          );
        }).length,
    );
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  await settle();
  assert.equal(await runningCount(), 0, 'Reduced motion suppresses every credits animation');
  await settings.emulateMedia({ reducedMotion: 'no-preference' });
  await settle();
  await waitForMotion();
  await settings.locator('[data-section="support"]').click();
  await settle();
  assert.equal(await runningCount(), 0, 'Hidden credits tab suppresses every credits animation');
  await settings.locator('[data-section="credits"]').click();
  await settle();
  await waitForMotion();
  await settings.locator('#settings-window-close').click();
  await settings.waitForTimeout(150);
  report.nativeAfterClose = {
    visible: await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((view) => view.webContents.getURL().endsWith('/settings.html'))
        .isVisible(),
    ),
    renderer: await settings.evaluate(() => ({
      hidden: document.hidden,
      pageHidden: document.getElementById('credits-panel').hasAttribute('data-page-hidden'),
      draftPrompt: !document.getElementById('settings-draft-actions').hidden,
    })),
    running: await runningCount(),
  };
  assert.equal(report.nativeAfterClose.visible, false, 'Close hides the native settings window');
  assert.equal(await runningCount(), 0, 'Hidden native window suppresses every credits animation');
  await settingsView(application, 'credits');
  await settings.waitForFunction(() => !document.hidden);
  await settle();
  await waitForMotion();
  report.checks.push(
    'Reduced motion, hidden tab and hidden native window stop all effects; reopening resumes',
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack || String(error);
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
