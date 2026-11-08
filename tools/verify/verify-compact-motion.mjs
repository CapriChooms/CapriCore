// SPDX-License-Identifier: GPL-3.0-only
import { saveSettings } from './settings-view.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'compact-motion-'));
const report = { folder, checks: [], errors: [] };
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
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
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (p) => p.on('pageerror', (e) => report.errors.push(e.message)));
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  const inferenceLabel = page.locator('#inference-label');
  await inferenceLabel.waitFor({ state: 'visible' });
  const inference = await page.evaluate(async () => (await window.capri.bootstrap()).inference);
  assert.equal(await inferenceLabel.getAttribute('data-mode'), 'local');
  assert.ok((await inferenceLabel.getAttribute('title')).endsWith(inference.model));
  const showInference = (value) =>
    page.evaluate(async (value) => {
      const { renderInferenceLabel } = await import('./inference-panel.mjs');
      renderInferenceLabel(value, { text: (text) => text });
    }, value);
  await showInference({ setupRequired: true });
  assert.equal(await inferenceLabel.getAttribute('title'), 'API · OFFLINE');
  const apiInference = {
    remote: true,
    providerHost: 'openrouter.ai',
    model: 'nvidia/nemotron-3.5-super-vl:free',
  };
  await showInference(apiInference);
  assert.equal(
    await inferenceLabel.getAttribute('title'),
    'API · OpenRouter · nvidia/nemotron-3.5-super-vl:free',
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/index.html'))
      .showInactive(),
  );
  const update = (value) =>
    page.evaluate(
      async (value) =>
        window.capri.setCompanionSettings({
          ...(await window.capri.bootstrap()).companion,
          ...value,
        }),
      value,
    );
  const sendEvent = (data) =>
    application.evaluate(
      ({ BrowserWindow }, data) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/index.html'))
          .webContents.send('capri:event', data),
      data,
    );
  const startup = (visible) =>
    sendEvent({
      type: 'startup.progress',
      finished: !visible,
      stages: ['core', 'models', 'recognition', 'voice'].map((id) => ({
        id,
        state: 'running',
        started: Date.now(),
        estimate: 150,
      })),
    });
  await update({ floatEnabled: false, glitchEnabled: false });
  async function compact() {
    if ((await page.getAttribute('body', 'data-presence')) !== 'core')
      await page.evaluate(() => window.capri.windowAction('portrait'));
    await page.waitForFunction(() => document.body.dataset.presence === 'core');
    await page.waitForTimeout(250);
  }
  async function verifyToolbar() {
    const [top, quick] = await page.evaluate(() =>
      ['#handle .window-actions button', '#quick-actions button'].map((selector) =>
        [...document.querySelectorAll(selector)]
          .map((button) => {
            const { left, right, top, bottom, width } = button.getBoundingClientRect();
            return { id: button.id || button.dataset.quick, left, right, top, bottom, width };
          })
          .filter(({ width }) => width > 0),
      ),
    );
    const detach =
      (await page.getAttribute('body', 'data-presence')) === 'core' ? [] : ['avatar-detach'];
    assert.deepEqual(
      top.map(({ id }) => id),
      ['support-author', 'report-bug', 'presence-toggle', ...detach, 'hide', 'quit'],
    );
    assert.deepEqual(
      quick.map(({ id }) => id),
      [
        'microphone-toggle',
        'voice-toggle',
        'music-toggle',
        'history-toggle',
        'screen-indicator',
        'applications',
        'time',
        'languages',
        'settings-open',
      ],
    );
    for (const row of [top, quick])
      row.forEach(({ left, top, width }, index) => {
        const compactQuick = row === quick && detach.length === 0;
        assert.equal(width, compactQuick ? 24 : 26);
        if (!index) return;
        assert(
          Math.abs(left - row[index - 1].right - (compactQuick ? 2 : 4)) < 0.1,
          'Uneven toolbar gap: ' + JSON.stringify(row),
        );
        assert(Math.abs(top - row[0].top) < 0.1, 'Toolbar buttons wrapped');
      });
    assert(Math.abs(top.at(-1).right - quick.at(-1).right) < 0.1, 'Toolbar columns misaligned');
    assert(
      Math.abs(quick[0].top - top[0].bottom - 4) < 0.1,
      'Uneven toolbar row gap: ' + JSON.stringify([top[0], quick[0]]),
    );
    const composer = await page.evaluate(() => {
      const row = document.querySelector('.composer');
      const rect = (node) => {
        const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const thinking = document.getElementById('thinking-toggle');
      return {
        row: rect(row),
        gap: parseFloat(getComputedStyle(row).columnGap),
        buttons: [...row.querySelectorAll(':scope > button')]
          .filter((node) => node.getBoundingClientRect().width > 0)
          .map((node) => ({ id: node.id, ...rect(node) })),
        neighbors: [thinking.previousElementSibling?.id, thinking.nextElementSibling?.id],
        message: rect(document.getElementById('message')),
      };
    });
    assert.deepEqual(
      composer.buttons.map((button) => button.id),
      ['attachment-open', 'thinking-toggle', 'input-microphone', 'send'],
    );
    assert.deepEqual(composer.neighbors, ['attachment-open', 'input-microphone']);
    assert.ok(composer.message.width >= 60, 'Composer keeps usable typing space.');
    const ordered = composer.buttons.toSorted((a, b) => a.left - b.left);
    for (const [index, button] of ordered.entries()) {
      assert.ok(
        button.left >= composer.row.left &&
          button.right <= composer.row.right + 0.5 &&
          button.top >= composer.row.top &&
          button.bottom <= composer.row.bottom + 0.5,
        JSON.stringify(composer),
      );
      if (index)
        assert.ok(
          Math.abs(button.left - ordered[index - 1].right - composer.gap) < 0.5,
          'Composer gaps must stay uniform.',
        );
    }
  }
  await startup(false);
  await page.locator('#startup-progress').waitFor({ state: 'hidden' });
  await compact();
  const compactRects = () =>
    page.evaluate(() =>
      ['handle', 'presence-core', 'quick-actions', 'input-dock'].map((id) => {
        const { left, top, bottom } = document.getElementById(id).getBoundingClientRect();
        return { id, left, top, bottom };
      }),
    );
  const [handle] = await compactRects();
  const drag = await application.evaluate(
    async ({ BrowserWindow, screen }, { modulePath, handle }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/index.html'),
      );
      const original = win.getBounds();
      const area = screen.getDisplayMatching(original).workArea;
      win.setPosition(
        area.x + Math.round((area.width - original.width) / 2),
        area.y + Math.round(Math.max(0, area.height - original.height) / 2),
        false,
      );
      const initial = win.getContentBounds();
      const load = process.getBuiltinModule('node:module').createRequire(process.execPath);
      const { PointerController } = load(modulePath);
      const beginWindow = PointerController.prototype.beginWindow;
      const getCursor = screen.getCursorScreenPoint;
      let controller;
      let cursor = {
        x: initial.x + Math.round(handle.left + 8),
        y: initial.y + Math.round((handle.top + handle.bottom) / 2),
      };
      // Drive the real verification window's drag IPC without moving the physical cursor.
      PointerController.prototype.beginWindow = function (...args) {
        controller = this;
        globalThis.compactMotionPointerFixture = this;
        return beginWindow.apply(this, args);
      };
      screen.getCursorScreenPoint = () => cursor;
      try {
        await win.webContents.executeJavaScript('window.capri.startDrag()');
        if (!controller) throw new Error('Drag IPC did not reach the pointer controller');
        cursor = { x: cursor.x, y: area.y + 1 };
        const { verification, ignored } = controller;
        controller.verification = false;
        try {
          controller.tick();
        } finally {
          controller.verification = verification;
          if (controller.ignored !== ignored) {
            controller.ignored = ignored;
            win.setIgnoreMouseEvents(ignored, { forward: true });
          }
        }
        const moving = win.getContentBounds();
        await win.webContents.executeJavaScript('window.capri.endDrag()');
        return { original, moving, area, released: win.getContentBounds() };
      } finally {
        screen.getCursorScreenPoint = getCursor;
        PointerController.prototype.beginWindow = beginWindow;
      }
    },
    { modulePath: path.join(root, 'apps/desktop/main/pointer-controller.mjs'), handle },
  );
  assert(
    handle.top > 100,
    'The drag fixture must have substantial transparent space above the dock',
  );
  async function verifyCompactAtTop(bounds, phase) {
    const rects = await compactRects();
    assert.ok(
      bounds.y + rects[0].top <= drag.area.y + 32 &&
        rects.every(
          ({ top, bottom }) =>
            bottom > top &&
            bounds.y + top >= drag.area.y - 1 &&
            bounds.y + bottom <= drag.area.y + drag.area.height + 1,
        ),
      `${phase}: compact dock must stay visible near the top (${JSON.stringify({ bounds, area: drag.area, rects })})`,
    );
  }
  await verifyCompactAtTop(drag.released, 'Released');
  await verifyCompactAtTop(drag.moving, 'Dragging');
  const getContentBounds = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/index.html'))
        .getContentBounds(),
    );
  const waitForRegions = () =>
    page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await window.capri.bootstrap();
    });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await waitForRegions();
  await verifyCompactAtTop(await getContentBounds(), 'Hit regions refreshed');
  await page.evaluate(() => window.capri.windowAction('portrait'));
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await waitForRegions();
  const expanded = await getContentBounds();
  const { area } = drag;
  assert.ok(
    expanded.x >= area.x - 1 &&
      expanded.y >= area.y - 1 &&
      expanded.x + expanded.width <= area.x + area.width + 1 &&
      expanded.y + expanded.height <= area.y + area.height + 1,
    `Expanded portrait must fit its work area (${JSON.stringify({ expanded, area })})`,
  );
  await application.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/index.html'))
      .setBounds(bounds, false);
  }, drag.original);
  await compact();
  report.checks.push('Drag to the work-area top, retain compact placement, expand fully onscreen');
  for (const [width, height] of [
    [480, 660],
    [380, 480],
    [320, 360],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/index.html'))
          .setContentSize(...size),
      [width, height],
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    await verifyToolbar();
    const priorThinking = await page.locator('#thinking-toggle').getAttribute('aria-pressed');
    await page.locator('#thinking-toggle').click();
    await page.waitForFunction(
      (prior) =>
        document.getElementById('thinking-toggle').getAttribute('aria-pressed') !== prior &&
        document.getElementById('thinking-toggle').getAttribute('aria-busy') === 'false',
      priorThinking,
    );
    await page.locator('#thinking-toggle').click();
    await page.waitForFunction(
      (prior) =>
        document.getElementById('thinking-toggle').getAttribute('aria-pressed') === prior &&
        document.getElementById('thinking-toggle').getAttribute('aria-busy') === 'false',
      priorThinking,
    );
    await page.evaluate(() => window.capri.windowAction('portrait'));
    await page.waitForFunction(() => document.body.dataset.presence !== 'core');
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => innerWidth),
      width,
      'Expansion must preserve test width',
    );
    await verifyToolbar();
    await compact();
    assert.equal(await page.evaluate(() => innerWidth), width, 'Collapse must preserve test width');
    for (const [busy, preparing] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      await startup(preparing);
      await page.evaluate((busy) => {
        document.getElementById('notice').hidden = !busy;
        document.getElementById('notice-message').textContent = busy
          ? 'A recoverable error with details. '.repeat(20)
          : '';
        const input = document.getElementById('message');
        input.value = busy
          ? 'A longer multiline draft, with controls that must remain available. '.repeat(8)
          : '';
        input.dispatchEvent(new Event('input'));
      }, busy);
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        return {
          header: rect(document.getElementById('handle')),
          core: rect(document.getElementById('presence-core')),
          input: rect(document.querySelector('.composer')),
          hud: rect(document.getElementById('memory-hud')),
          shade: rect(document.getElementById('window-shade')),
          startup: document.getElementById('startup-progress').hidden
            ? null
            : rect(document.getElementById('startup-progress')),
          buttons: [...document.querySelectorAll('#handle button,#quick-actions button')]
            .filter((el) => el.getBoundingClientRect().width > 0)
            .map(rect),
          identity: rect(document.getElementById('inference-label')),
          mode: rect(document.getElementById('inference-mode')),
          windowActions: rect(document.querySelector('#handle .window-actions')),
          width: innerWidth,
          height: innerHeight,
        };
      });
      for (const r of [...layout.buttons, layout.core, layout.input, layout.hud]) {
        assert(
          r.x >= -1 && r.y >= -1 && r.right <= layout.width + 1 && r.bottom <= layout.height + 1,
          JSON.stringify(layout),
        );
      }
      for (let a = 0; a < layout.buttons.length; a++)
        for (let b = a + 1; b < layout.buttons.length; b++) {
          const x = layout.buttons[a],
            y = layout.buttons[b];
          assert(
            x.right <= y.x + 1 || y.right <= x.x + 1 || x.bottom <= y.y + 1 || y.bottom <= x.y + 1,
            'Toolbar collision',
          );
        }
      assert(layout.core.bottom <= layout.input.y, 'Signal overlaps input');
      assert(layout.header.width <= 310 && layout.core.width === 48);
      assert(layout.mode.width > 0 && layout.mode.right <= layout.identity.right + 1);
      assert(
        layout.identity.right <= layout.windowActions.x + 1 ||
          layout.identity.bottom <= layout.windowActions.y + 1,
        'Inference label overlaps toolbar buttons',
      );
      if (!busy && !preparing)
        assert(layout.hud.bottom - layout.header.y < 185, JSON.stringify(layout));
      if (preparing) {
        assert(layout.startup, 'Startup progress must be visible');
        assert(layout.startup.width <= 310, 'Startup must match the mini-panel width');
        assert(layout.core.bottom <= layout.startup.y, 'Startup covers the signal');
        assert(layout.startup.bottom <= layout.input.y, 'Startup covers input');
        for (const button of layout.buttons)
          assert(button.bottom <= layout.startup.y, 'Startup covers a toolbar button');
      } else assert.equal(layout.startup, null);
      assert(layout.shade.width < 350, 'Compact backdrop must shrink with controls');
      if (width === 480 && !busy)
        await page.screenshot({
          path: path.join(folder, preparing ? 'compact-startup.png' : 'compact.png'),
        });
    }
  }
  await startup(false);
  await showInference(inference);
  report.checks.push(
    'Three window sizes, active and completed startup, notifications, multiline drafts, compact dimming, no clipped/overlapping controls',
  );
  await page.evaluate(() => {
    document.getElementById('notice').hidden = true;
    const input = document.getElementById('message');
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/index.html'))
      .setContentSize(480, 660),
  );
  await page.waitForFunction(() => innerWidth === 480);
  await compact();
  assert.equal(
    await page.locator('#message').isVisible(),
    true,
    'Attached core retains its input.',
  );
  await page.locator('#presence-toggle').click();
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await page.locator('#message').fill('Preserved detached draft');
  await page.evaluate(() => {
    document.getElementById('attachment-drafts').hidden = false;
    document.getElementById('attachment-list').textContent = 'Isolated attachment draft';
  });
  await sendEvent({ type: 'avatar.detach', phase: 'detached' });
  await page.waitForFunction(
    () =>
      document.body.dataset.avatarDock === 'compact' &&
      document.body.dataset.presence === 'portrait',
  );
  await waitForRegions();
  assert.equal(await page.locator('#message').isVisible(), true);
  assert.equal(await page.locator('#attachment-drafts').isVisible(), true);
  const detachedLayout = async () => {
    await waitForRegions();
    return {
      regions: await application.evaluate(() =>
        globalThis.compactMotionPointerFixture.getRegions(),
      ),
      visual: await page.evaluate(() => {
        const rect = (node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        };
        return {
          shade: rect(document.getElementById('window-shade')),
          buttons: [...document.querySelectorAll('#handle button, #quick-actions button')]
            .map((node) => ({ id: node.id, ...rect(node) }))
            .filter((node) => node.width > 0 && node.height > 0),
        };
      }),
    };
  };
  const expandedDock = await detachedLayout();
  await page.locator('#presence-toggle').click();
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  for (const selector of ['#input-dock', '#message', '#attachment-drafts', '#input-dock > footer'])
    assert.equal(await page.locator(selector).isHidden(), true, selector);
  const collapsedDock = await detachedLayout();
  await page.screenshot({
    path: path.join(folder, 'detached-panel-only.png'),
    omitBackground: true,
  });
  assert.ok(collapsedDock.visual.shade.height < expandedDock.visual.shade.height - 30);
  assert.ok(collapsedDock.regions.footprint.height < expandedDock.regions.footprint.height - 30);
  for (const button of collapsedDock.visual.buttons) {
    const x = button.x + button.width / 2;
    const y = button.y + button.height / 2;
    assert.ok(
      collapsedDock.regions.controls.some(
        (rect) =>
          x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
      ),
      'Collapsed toolbar remains interactive: ' + button.id,
    );
  }
  assert.ok(collapsedDock.visual.buttons.some((button) => button.id === 'settings-open'));
  await page.locator('#presence-toggle').click();
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  assert.equal(await page.locator('#message').isVisible(), true);
  assert.equal(await page.locator('#message').inputValue(), 'Preserved detached draft');
  assert.equal(await page.locator('#attachment-drafts').isVisible(), true);
  assert.equal(await page.locator('#input-dock > footer').isVisible(), true);
  await page.evaluate(() => {
    document.getElementById('attachment-drafts').hidden = true;
    document.getElementById('attachment-list').replaceChildren();
  });
  await page.locator('#message').fill('');
  await sendEvent({ type: 'avatar.detach', phase: 'attached' });
  await page.waitForFunction(() => document.body.dataset.avatarDetach === 'attached');
  await compact();
  assert.equal(await page.locator('#message').isVisible(), true);
  await application.evaluate(() => delete globalThis.compactMotionPointerFixture);
  report.checks.push(
    'Detached core retains the toolbar and hides the lower input dock; hit regions and shade shrink; expanding restores the draft; attached core keeps input.',
  );
  const [settings] = await Promise.all([
    application.waitForEvent('window'),
    page.locator('[data-quick="time"]').click(),
  ]);
  await settings.locator('[data-section="time"][aria-current="page"]').waitFor();
  const closeSettings = settings.locator('#settings-window-close');
  await closeSettings.click();
  report.checks.push('Same aligned toolbar grid in both modes and working timer shortcut');
  for (const [value, section] of [
    [inference, 'models'],
    [apiInference, 'api'],
  ]) {
    await showInference(value);
    await inferenceLabel.click();
    await page.locator('#inference-picker').waitFor({ state: 'visible' });
    await page.locator(`#inference-picker [data-settings="${section}"]`).click();
    await settings.locator(`[data-section="${section}"][aria-current="page"]`).waitFor();
    await closeSettings.click();
  }
  await showInference(inference);
  report.checks.push(
    'Inference label opens a source picker with Models and API settings shortcuts',
  );
  assert.deepEqual(
    await page
      .locator('#handle .window-controls button')
      .evaluateAll((els) => els.map((e) => e.id)),
    ['presence-toggle', 'avatar-detach', 'hide', 'quit'],
  );
  await page.evaluate(() => window.capri.openSettings('appearance'));
  await settings.locator('#companion-expand-reply').waitFor();
  assert(await settings.locator('#companion-expand-reply').isChecked());
  await settings.locator('#companion-expand-reply').uncheck();
  await saveSettings(settings);
  await settings.locator('#settings-window-close').click();
  for (const expand of [false, true]) {
    await update({ expandOnReply: expand });
    await compact();
    const id = 'compact-fixture-' + expand;
    const message = {
      id,
      role: 'assistant',
      text: '',
      turnId: id,
      createdAt: new Date().toISOString(),
      status: 'streaming',
    };
    await sendEvent({ type: 'turn.started', turnId: id, silent: true, assistant: message });
    await sendEvent({ type: 'turn.delta', turnId: id, text: 'An isolated test reply.' });
    await page.waitForFunction(
      (expected) => document.body.dataset.presence === expected,
      expand ? 'portrait' : 'core',
    );
    await sendEvent({
      type: 'turn.completed',
      turnId: id,
      assistant: { ...message, text: 'An isolated test reply.', status: 'completed' },
    });
    await compact();
    await sendEvent({ type: 'turn.started', turnId: id, silent: true, assistant: message });
    await sendEvent({
      type: 'turn.completed',
      turnId: id,
      assistant: { ...message, text: 'A direct tool reply.', status: 'completed' },
    });
    await page.waitForFunction(
      (expected) => document.body.dataset.presence === expected,
      expand ? 'portrait' : 'core',
    );
  }
  report.checks.push(
    'Default expansion, checkbox saved, streamed replies obey both modes, button order',
  );
  await compact();
  await page.locator('#presence-core').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  report.checks.push('Signal still expands portrait manually');
  for (const expand of [false, true]) {
    await update({ expandOnReply: expand });
    await sendEvent({ type: 'power.state', phase: 'sleeping' });
    await sendEvent({ type: 'backend', phase: 'sleeping', message: 'Going to sleep…' });
    await page.waitForFunction(() => document.body.dataset.sleeping === 'true');
    await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
    await page.locator('#presence-toggle').click();
    await page.waitForFunction(() => document.body.dataset.presence === 'core');
    await sendEvent({ type: 'power.state', phase: 'asleep' });
    await sendEvent({ type: 'backend', phase: 'asleep', message: 'Sleeping' });
    await page.waitForTimeout(600);
    assert.equal(await page.getAttribute('body', 'data-presence'), 'core');
    assert(await page.locator('#sleep-indicator').isHidden());
    await page.locator('#presence-core').click();
    await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
    assert.equal(await page.getAttribute('body', 'data-phase'), 'asleep');
    assert(await page.locator('#sleep-indicator').isVisible());
    await page.locator('#presence-toggle').click();
    await page.waitForFunction(() => document.body.dataset.presence === 'core');
    await sendEvent({ type: 'power.state', phase: 'waking' });
    await sendEvent({ type: 'backend', phase: 'starting', message: 'Starting local core…' });
    await sendEvent({ type: 'power.state', phase: 'awake' });
    await sendEvent({ type: 'backend', phase: 'ready', message: 'Ready' });
    await page.waitForFunction(
      (expected) => document.body.dataset.presence === expected,
      expand ? 'portrait' : 'core',
    );
  }
  await sendEvent({ type: 'backend', phase: 'offline', message: 'Disconnected' });
  await page.waitForFunction(() => document.body.dataset.presence === 'portrait');
  await page.locator('#presence-toggle').click();
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  await sendEvent({ type: 'backend', phase: 'offline', message: 'Disconnected' });
  await page.waitForTimeout(600);
  assert.equal(await page.getAttribute('body', 'data-presence'), 'core');
  await sendEvent({ type: 'backend', phase: 'ready', message: 'Ready' });
  report.checks.push(
    'Manual collapse during sleep, no automatic re-expansion while asleep or offline, wake respects reply preference',
  );
  await page.evaluate(() => window.capri.openSettings('motion'));
  await settings.locator('#companion-float-amplitude').waitFor();
  assert.equal(
    await settings.locator('[data-section="window"]').getAttribute('aria-current'),
    'page',
  );
  await settings.locator('#companion-float-enabled').check();
  await settings.locator('#companion-float-amplitude').fill('24');
  await settings.locator('#companion-float-period').fill('4');
  await saveSettings(settings);
  assert(await settings.locator('#companion-motion-heading').isHidden());
  await settings.screenshot({ path: path.join(folder, 'motion-settings.png') });
  await settings.locator('#settings-window-close').click();
  await compact();
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.getElementById('companion').dispatchEvent(new PointerEvent('pointerleave'));
  });
  const floats = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(350);
    floats.push(
      await page.evaluate(() => parseFloat(document.body.style.getPropertyValue('--float-y')) || 0),
    );
    assert(
      await page.evaluate(() =>
        ['handle', 'presence-core', 'input-dock'].every((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        }),
      ),
      'Floating controls must remain inside the window',
    );
  }
  assert(
    Math.max(...floats) - Math.min(...floats) > 4,
    'Motion must be visible at maximum amplitude',
  );
  await page.evaluate(() =>
    document.getElementById('companion').dispatchEvent(new PointerEvent('pointerenter')),
  );
  const frozen = await page.evaluate(() => document.body.style.getPropertyValue('--float-y'));
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => document.body.style.getPropertyValue('--float-y')),
    frozen,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  const reduced = await page.evaluate(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    offset: document.body.style.getPropertyValue('--float-y'),
    translate: getComputedStyle(document.getElementById('companion')).translate,
    hidden: document.hidden,
  }));
  assert.equal(reduced.translate, 'none', JSON.stringify(reduced));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const input = document.getElementById('message');
    input.value = 'A draft';
    input.focus();
    document.getElementById('companion').dispatchEvent(new PointerEvent('pointerleave'));
  });
  const typed = await page.evaluate(() => document.body.style.getPropertyValue('--float-y'));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--float-y')), typed);
  await update({ floatEnabled: false });
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => parseFloat(document.body.style.getPropertyValue('--float-y'))),
    0,
  );
  report.checks.push(
    'Motion settings, visible maximum movement, pointer freeze, reduced motion and disabled motion',
  );
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
