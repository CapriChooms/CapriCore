// SPDX-License-Identifier: GPL-3.0-only
import { saveSettings, settingsView } from './settings-view.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/index.mjs';
import { SETTINGS_SECTIONS } from '../../apps/desktop/renderer/settings-registry.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'settings-')),
  require = createRequire(import.meta.url);
const entry = path.join(folder, 'test-main.mjs');
const main = pathToFileURL(path.join(root, 'apps/desktop/main.mjs')).href;
writeFileSync(
  entry,
  `
import { app } from 'electron';
try {
  await import(${JSON.stringify(main)});
} catch (error) {
  console.error(error);
  app.exit(1);
}
`,
);
const report = { folder, checks: [], errors: [] };
const record = (name, data = {}) => {
  report.checks.push({ name, ...data });
  console.log('PASS ' + name);
};
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
    executablePath: require('electron'),
    args: [entry, '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const page = await application.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  assert.equal(await page.locator('#menu').count(), 0);
  assert.equal(
    await page
      .locator('.identity')
      .innerText()
      .then((text) => text.includes('OBS')),
    false,
  );
  await page.evaluate(() => document.getElementById('settings-open').click());
  const findSettings = async () => {
    for (let i = 0; i < 100; i++) {
      const view = application.windows().find((w) => w.url().endsWith('/settings.html'));
      if (view) return view;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Settings window did not open');
  };
  const settings = await findSettings();
  await settings.waitForSelector('[data-section="general"][aria-current="page"]');
  // Check the Windows-presented pixels before any second open, focus or resize.
  // DOM visibility or a renderer screenshot cannot detect a gray native window.
  if (process.platform === 'win32') {
    let frame;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !frame?.rendered) {
      frame = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const window = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('/settings.html'),
        );
        const visible = window?.isVisible(),
          opacity = window?.getOpacity();
        if (!visible || opacity < 0.99) return { visible, opacity };
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 320, height: 320 },
        });
        const image = sources.find((source) => source.id === window.getMediaSourceId())?.thumbnail;
        if (!image || image.isEmpty()) return { visible, opacity, thumbnail: false };
        const bitmap = image.toBitmap();
        let chromatic = 0,
          accents = 0;
        for (let pixel = 0; pixel < bitmap.length; pixel += 64) {
          const [blue, green, red] = bitmap.subarray(pixel, pixel + 3);
          if (blue - red >= 12) chromatic++;
          if (green >= 110 && green - red >= 25) accents++;
        }
        const samples = bitmap.length / 64;
        return {
          visible,
          opacity,
          samples,
          chromatic,
          accents,
          rendered: chromatic > samples / 5 && accents > 5,
        };
      });
      if (!frame.rendered) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!frame.rendered) {
      frame.notice = await settings.locator('#settings-notice').textContent();
      frame.section = await settings.locator('[data-section][aria-current="page"]').count();
    }
    assert.equal(
      Boolean(frame.rendered),
      true,
      `First Settings open did not present its themed native frame (${JSON.stringify(frame)})`,
    );
    record('First Settings open presents the themed Windows frame without a second click');
  }
  const navigate = async (section) => {
    await settings.locator(`[data-section="${section}"]`).click();
    await settings.waitForFunction(
      (id) =>
        document.querySelector(`[data-section="${id}"]`).getAttribute('aria-current') === 'page',
      section,
      { timeout: 20000 },
    );
  };
  const navigation = settings.locator('#settings-navigation');
  const groupedSections = await navigation
    .locator('[data-settings-group]')
    .evaluateAll((groups) =>
      Object.fromEntries(
        groups.map((group) => [
          group.dataset.settingsGroup,
          [...group.querySelectorAll('[data-section]')].map((node) => node.dataset.section),
        ]),
      ),
    );
  assert.deepEqual(groupedSections, {
    capri: ['general', 'appearance', 'window'],
    conversation: ['dialogue', 'initiative', 'languages', 'microphone', 'voice', 'calls'],
    models: ['models', 'api'],
    capabilities: ['computer', 'screen', 'applications', 'files', 'time'],
    community: ['updates', 'discord', 'bug', 'support'],
  });
  await settings.screenshot({ path: path.join(folder, 'settings-grouped.png') });
  record('Settings sidebar groups all existing tabs and shows each one once');

  const search = settings.locator('#settings-search');
  const results = settings.locator('#settings-search-results');
  const generalControls = settings.locator('#general-panel .general-setting');
  assert.equal(await generalControls.count(), 12);
  assert.equal(await generalControls.locator('#general-reset-settings').count(), 1);
  assert.equal(
    await generalControls.evaluateAll((rows) =>
      rows.every((row) => {
        const description = row.querySelector('input, button').getAttribute('aria-describedby');
        return row.ownerDocument.getElementById(description)?.textContent.trim();
      }),
    ),
    true,
  );
  await search.fill('primary display');
  await search.press('Enter');
  await settings.waitForFunction(
    () => document.activeElement.dataset.windowAction === 'reset-position',
  );
  await search.fill('');
  record('General controls describe their actions and help text is searchable');
  const resultFor = (id, section) =>
    results.locator(`button[data-setting-result="${id}"][data-result-section="${section}"]`);
  await search.fill('  PoRtRaIt zoom  ');
  const portraitResult = resultFor('settings-portrait-zoom', 'appearance');
  await portraitResult.waitFor();
  assert.match(await portraitResult.innerText(), /Portrait zoom/);
  assert.equal(await results.locator('[data-setting-result]').count(), 1);
  assert.equal(await navigation.isVisible(), false);
  await portraitResult.press('Enter');
  await settings.waitForFunction(() => document.activeElement.id === 'settings-portrait-zoom');
  assert.equal(
    await navigation.locator('[data-section="appearance"]').getAttribute('aria-current'),
    'page',
  );
  assert.equal(
    await settings
      .locator('#settings-portrait-zoom')
      .evaluate((control) =>
        Boolean(
          control.closest('.setting-search-match') ||
            [...control.labels].some((label) => label.closest('.setting-search-match')),
        ),
      ),
    true,
  );
  assert.equal(await portraitResult.isVisible(), true);
  await settings.screenshot({ path: path.join(folder, 'settings-search.png') });
  await search.fill('capri-test-unmatched-setting');
  assert.equal(await results.locator('[data-setting-result]').count(), 0);
  const emptyState = results.getByRole('status');
  assert.equal(await emptyState.isVisible(), true);
  assert(
    (await emptyState.innerText()).trim(),
    'An unmatched query should show an empty-state message',
  );
  await search.press('Escape');
  assert.equal(await search.inputValue(), '');
  assert.equal(await results.isVisible(), false);
  assert.equal(await navigation.isVisible(), true);
  record(
    'Search finds a specific control, focuses and highlights it, and restores the sidebar on Escape',
  );

  await search.fill('Circles');
  const chartStyleResult = resultFor('memory-style', 'appearance');
  await chartStyleResult.waitFor();
  assert.match(await chartStyleResult.innerText(), /Chart style/);
  record('Searching for a select option finds its setting');

  await search.fill('API key');
  await resultFor('api-key', 'api').click();
  await settings.waitForFunction(() => document.activeElement.id === 'api-key');
  assert.equal(await settings.locator('#api-form').isVisible(), true);
  assert.equal(await settings.locator('#api-key').inputValue(), '');
  await settings.locator('#api-cancel').click();
  await search.press('Escape');
  await navigate('general');
  record('Search opens the API connection form and focuses the empty key field');

  const originalBounds = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/index.html'))
      .getBounds(),
  );
  if (process.platform === 'win32') {
    // Verification-mode companions start hidden, so the real monitor stays idle.
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith('/index.html'))
        .showInactive(),
    );
    try {
      await page.waitForFunction(
        () =>
          Boolean(
            document
              .querySelector('#process-graphs-hud [data-metric="CPU"] path')
              ?.getAttribute('d'),
          ),
        null,
        { timeout: 15000 },
      );
    } catch (error) {
      const probe = await page.evaluate(async () => ({
        visible: document.visibilityState,
        data: await window.capri.memoryStatus().catch((failure) => failure.message),
      }));
      throw new Error('Process graph did not update: ' + JSON.stringify(probe), { cause: error });
    }
    assert.equal(await page.locator('#process-graphs-hud .process-graph').count(), 4);
    assert.match(await page.locator('[data-metric="RAM"]').innerText(), /\d.*GB/);
    assert.match(await page.locator('[data-metric="GPU"]').innerText(), /°C/);
    record('System charts display live CPU load, memory in GB, and a GPU temperature field');
  }
  for (const mode of ['portrait', 'core']) {
    await page.evaluate((mode) => {
      if (document.body.dataset.presence !== mode)
        document.getElementById('presence-toggle').click();
    }, mode);
    await page.waitForFunction((mode) => document.body.dataset.presence === mode, mode);
    for (const width of [430, 320]) {
      await application.evaluate(
        ({ BrowserWindow }, { width, bounds }) => {
          const win = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().endsWith('/index.html'),
          );
          win.setResizable(true);
          win.setBounds({ ...bounds, width });
        },
        { width, bounds: originalBounds },
      );
      await page.waitForFunction((width) => Math.abs(innerWidth - width) <= 2, width);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const rects = await page.evaluate(() => {
        const measure = () =>
          Object.fromEntries(
            [
              'portrait-panel',
              'process-graphs-hud',
              'microphone-preview',
              'input-dock',
              'monitor-display',
            ].map((id) => {
              const b = document.getElementById(id).getBoundingClientRect();
              return [
                id,
                {
                  x: b.x,
                  y: b.y,
                  right: b.right,
                  bottom: b.bottom,
                  width: b.width,
                  height: b.height,
                },
              ];
            }),
          );
        const mic = document.getElementById('microphone-preview');
        mic.hidden = true;
        const before = measure();
        mic.hidden = false;
        document.querySelector('#microphone-label .ticker-copy').textContent = 'LISTENING';
        document.querySelector('#microphone-text .ticker-copy').textContent = 'AUTO-EUROPE';
        const after = measure();
        return {
          before,
          after,
          composer: document.querySelector('.composer').getBoundingClientRect().y,
          viewport: innerWidth,
        };
      });
      for (const id of ['portrait-panel', 'input-dock'])
        assert.deepEqual(
          rects.before[id],
          rects.after[id],
          `${mode}/${width}: microphone must not move ${id}: ${JSON.stringify(rects)}`,
        );
      const mic = rects.after['microphone-preview'],
        toggle = rects.after['monitor-display'];
      assert(
        mic.right <= toggle.x + 1 && toggle.right <= rects.viewport && mic.bottom <= rects.composer,
        JSON.stringify({ mode, width, rects }),
      );
      const graphs = rects.after['process-graphs-hud'];
      assert(
        graphs.height > 0 &&
          mic.height > 0 &&
          graphs.bottom <= mic.y + 1 &&
          graphs.right <= toggle.x + 1 &&
          (mode !== 'portrait' || rects.after['portrait-panel'].bottom <= graphs.y + 1),
        JSON.stringify({ mode, width, rects }),
      );
      await page.screenshot({ path: path.join(folder, `dock-${mode}-${width}.png`) });
      await page.evaluate(() => {
        document.getElementById('microphone-preview').hidden = true;
        document.querySelector('#microphone-text .ticker-copy').textContent = '';
      });
    }
  }
  await application.evaluate(({ BrowserWindow }, bounds) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html'),
    );
    win.setBounds(bounds);
    win.setResizable(false);
  }, originalBounds);
  await page.evaluate(() => {
    if (document.body.dataset.presence !== 'portrait')
      document.getElementById('presence-toggle').click();
  });
  record(
    'System charts and microphone fit portrait/core at 320 and 430 pixels without a layout shift',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    const { OverflowTicker } = await import('./overflow-ticker.mjs');
    const host = document.createElement('span');
    host.id = 'ticker-fixture';
    host.style.cssText = 'display:block;width:80px';
    document.querySelector('.dock-telemetry').append(host);
    window.fixtureTicker = new OverflowTicker(host);
    window.fixtureTicker.set('A long language or recognition status that cannot fit in this slot.');
  });
  await page.waitForFunction(
    () => document.getElementById('ticker-fixture').dataset.overflow === 'true',
  );
  assert.equal(
    await page
      .locator('#ticker-fixture .ticker-copy')
      .evaluate((el) => getComputedStyle(el).animationName),
    'telemetry-ticker',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('#ticker-fixture .ticker-copy')
      .evaluate((el) => getComputedStyle(el).animationName),
    'none',
  );
  await page.evaluate(() => window.fixtureTicker.set('EN'));
  await page.waitForFunction(
    () => document.getElementById('ticker-fixture').dataset.overflow === 'false',
  );
  await page.evaluate(() =>
    window.fixtureTicker.set('الاستماع والتعرف على الكلام باللغة العربية الآن'),
  );
  await page.waitForFunction(
    () => document.getElementById('ticker-fixture').dataset.overflow === 'true',
  );
  assert(
    await page
      .locator('#ticker-fixture')
      .evaluate(
        (el) =>
          getComputedStyle(el).direction === 'rtl' &&
          parseFloat(el.style.getPropertyValue('--ticker-shift')) > 0,
      ),
  );
  await page.evaluate(() => {
    window.fixtureTicker.destroy();
    delete window.fixtureTicker;
    document.getElementById('ticker-fixture').remove();
  });
  record(
    'Long status text scrolls only on overflow, short text stays still and reduced motion disables animation',
  );
  for (const [id, , panelId] of SETTINGS_SECTIONS) {
    await navigate(id);
    const fit = await settings.locator('#' + panelId).evaluate((panel) => {
      const a = panel.getBoundingClientRect(),
        b = document.getElementById('companion').getBoundingClientRect();
      return { x: a.x, right: a.right, left: b.left, end: b.right };
    });
    assert(fit.x >= fit.left - 2 && fit.right <= fit.end + 2, JSON.stringify({ id, fit }));
  }
  assert.equal(await page.locator('.preferences-panel:not([hidden])').count(), 0);
  for (const view of [page, settings]) {
    const duplicates = await view
      .locator('[data-panel-cut]:has(> .panel-frame)')
      .evaluateAll((elements) =>
        elements
          .filter((el) =>
            ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(
              (key) => parseFloat(getComputedStyle(el)[key]) > 0,
            ),
          )
          .map((el) => el.id || el.className),
      );
    assert.deepEqual(
      duplicates,
      [],
      'SVG-framed controls must not also draw rectangular CSS borders',
    );
  }
  record('All settings categories open in a separate window; no legacy overlay or duplicate OBS');
  await navigate('appearance');
  assert.equal(await settings.locator('#memory-style').inputValue(), 'rings');
  assert.equal(await settings.locator('#process-graphs').isChecked(), true);
  assert.equal(await page.locator('#avatar-zoom-in,#avatar-zoom-out,#avatar-reset').count(), 0);
  await settings.locator('#memory-monitor').uncheck();
  assert.equal(await settings.locator('#memory-interval').isEnabled(), true);
  await page.locator('#memory-hud').waitFor({ state: 'hidden' });
  await page.locator('#process-graphs-hud').waitFor({ state: 'visible' });
  await settings.locator('#process-graphs').uncheck();
  assert.equal(await settings.locator('#memory-interval').isDisabled(), true);
  await page.locator('#process-graphs-hud').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.capri.memoryStatus()), null);
  await settings.locator('#memory-monitor').check();
  await page.locator('#memory-hud').waitFor({ state: 'visible' });
  await settings.locator('#process-graphs').check();
  await page.locator('#memory-hud').waitFor({ state: 'hidden' });
  await page.locator('#process-graphs-hud').waitFor({ state: 'visible' });
  record('Capri shows rings or graphs and stops sampling when both are off');
  await navigate('window');
  assert.equal(await settings.locator('#dimming-enabled').isVisible(), true);
  assert.equal(await settings.locator('#companion-float-enabled').isVisible(), true);
  assert.equal(
    await settings.locator('[data-section="dimming"],[data-section="motion"]').count(),
    0,
  );
  await navigate('computer');
  assert.equal(await settings.locator('#computer-fx-enabled').isChecked(), true);
  await settings.locator('#computer-fx-theme').selectOption('blackwall');
  await saveSettings(settings);
  await settings.waitForFunction(
    async () => (await window.capri.computerAppearance()).theme === 'blackwall',
  );
  await settings.locator('#computer-fx-intensity').fill('72');
  await settings.locator('#computer-fx-intensity').dispatchEvent('change');
  await saveSettings(settings);
  await settings.waitForFunction(
    async () => (await window.capri.computerAppearance()).intensity === 72,
  );
  await settings.locator('#computer-fx-enabled').uncheck();
  await saveSettings(settings);
  await settings.waitForFunction(
    async () => (await window.capri.computerAppearance()).enabled === false,
  );
  assert.equal(await settings.locator('#computer-fx-intensity').isDisabled(), true);
  assert.equal((await settings.evaluate(() => window.capri.computerTaskStatus())).active, false);
  await settings.locator('#computer-fx-enabled').check();
  await saveSettings(settings);
  await settings.locator('#settings-draft-actions').waitFor({ state: 'hidden' });
  await settings.evaluate(() => window.capri.previewComputerAppearance());
  assert.equal(
    await application.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((w) =>
          w.webContents.getURL().endsWith('/control-overlay.html'),
        ).length,
    ),
    0,
  );
  await navigate('general');
  await navigate('computer');
  assert.equal(await settings.locator('#computer-fx-theme').inputValue(), 'blackwall');
  record(
    'Control effects persist, disable cleanly and preview without granting or starting control',
  );
  assert.equal(await settings.locator('#computer-task-goal').isVisible(), true);
  assert.equal(await settings.locator('#computer-task-run').isDisabled(), true);
  const deniedTask = await settings.evaluate(async () => {
    try {
      await window.capri.runComputerTask('Open a fixture');
      return '';
    } catch (error) {
      return error.message;
    }
  });
  assert.match(deniedTask, /Full computer access/);
  assert.equal((await settings.evaluate(() => window.capri.computerTaskStatus())).active, false);
  await settings.screenshot({ path: path.join(folder, 'computer-task-panel.png') });
  await settings.locator('#computer-access-toggle').click();
  const fullAccessDialog = settings.locator('#confirmation-dialog[open]');
  await fullAccessDialog.waitFor();
  assert.equal(
    await fullAccessDialog
      .locator('.confirmation-card')
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
    '0px',
  );
  assert.equal(await fullAccessDialog.locator('.confirmation-card > .panel-frame').count(), 1);
  await settings.screenshot({ path: path.join(folder, 'single-outline-confirmation.png') });
  const grantButton = fullAccessDialog.locator('[data-choice="confirm"]');
  assert.equal(await grantButton.isDisabled(), true);
  await grantButton.waitFor({ state: 'visible' });
  await settings.waitForFunction(
    () => !document.querySelector('#confirmation-dialog [data-choice="confirm"]').disabled,
    null,
    { timeout: 6000 },
  );
  await fullAccessDialog.locator('[data-choice="cancel"]').click();
  assert.equal((await settings.evaluate(() => window.capri.computerAccessStatus())).enabled, false);
  record('Full-computer access waits three seconds and cancellation keeps the grant disabled');
  const encrypted = await application.evaluate(async ({ safeStorage }) => {
    const value = 'capri-test-credential-not-a-real-key';
    const encrypted = safeStorage.encryptString(value);
    return {
      available: safeStorage.isEncryptionAvailable(),
      roundTrip: safeStorage.decryptString(encrypted) === value,
      plaintextStored: encrypted.includes(Buffer.from(value)),
    };
  });
  assert.deepEqual(encrypted, { available: true, roundTrip: true, plaintextStored: false });
  record('Windows credential encryption round-trips without storing plaintext');
  await navigate('models');
  const context = settings.locator('#models-context');
  assert.deepEqual(
    await context.locator('option').evaluateAll((options) => options.map((o) => o.value)),
    ['32768', '65536', '131072', '262144'],
  );
  assert.equal(await settings.locator('#models-context-apply').isDisabled(), true);
  await context.selectOption('65536');
  assert.equal(await settings.locator('#models-context-apply').isEnabled(), true);
  await context.selectOption('32768');
  assert.equal(await settings.locator('#models-context-apply').isDisabled(), true);
  const badContext = await settings.evaluate(async () => {
    try {
      await window.capri.applyContextWindow(123);
      return '';
    } catch (error) {
      return error.message;
    }
  });
  assert.match(badContext, /Unsupported context window/);
  record(
    'Context choices use real settings IPC, distinguish draft from active and reject invalid values',
  );
  await navigate('appearance');
  await settings.locator('#companion-glitch-strength').fill('81');
  await search.fill('Context window');
  await resultFor('models-context', 'models').click();
  await settings.locator('[data-section="models"][aria-current="page"]').waitFor({
    state: 'attached',
  });
  assert.equal(await settings.locator('#settings-draft-actions').isHidden(), true);
  assert.equal(await settings.locator('#confirmation-dialog[open]').count(), 0);
  assert.equal(
    await settings.locator('[data-section="models"]').getAttribute('aria-current'),
    'page',
  );
  assert.equal(await search.inputValue(), 'Context window');
  await search.press('Escape');
  await navigate('general');
  await settings.locator('#settings-window-close').click();
  await settings.locator('#settings-draft-actions').waitFor();
  await settings.locator('#settings-discard').click();
  assert.equal(
    (await settings.evaluate(() => window.capri.bootstrap())).companion.glitchStrength,
    65,
  );
  record('Search and sidebar navigation retain edits until explicit close');
  await settingsView(application, 'microphone');
  await navigate('microphone');
  await settings.locator('#speech-pause').fill('1.8');
  await navigate('general');
  await saveSettings(settings);
  assert.equal(
    (await settings.evaluate(() => window.capri.bootstrap())).speech.trailingSilenceSeconds,
    1.8,
  );
  record('Save on close keeps microphone settings across tabs without creating capture');
  await navigate('appearance');
  await settings.locator('#settings-portrait-zoom').fill('300');
  await saveSettings(settings);
  await settings.waitForFunction(
    async () => (await window.capri.bootstrap()).avatarLayout.zoom === 3,
  );
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).avatarLayout.zoom, 3);
  record('300 percent zoom uses one shared state');
  await settings.locator('#companion-glitch-strength').fill('76');
  await page.evaluate(async () =>
    window.capri.setCompanionSettings({
      ...(await window.capri.bootstrap()).companion,
      glitchStrength: 35,
    }),
  );
  await saveSettings(settings, { wait: false });
  await settings.waitForTimeout(150);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).companion.glitchStrength, 35);
  await settings.locator('#settings-discard').click();
  await settingsView(application, 'appearance');
  assert.equal(await settings.locator('#companion-glitch-strength').inputValue(), '35');
  record(
    'External preferences cannot be overwritten by a stale draft; discard loads the current value',
  );
  await navigate('voice');
  assert.equal(await settings.locator('#voice-effects-preview').isDisabled(), false);
  await settings.locator('#voice-effects-preset').selectOption('synthetic');
  await saveSettings(settings);
  await settings.waitForFunction(
    async () => (await window.capri.bootstrap()).voiceEffects.preset === 'synthetic',
  );
  const audio = await page.evaluate(async () => {
    const { VoiceEffects } = await import('./voice-effects.mjs');
    const { VOICE_EFFECT_DEFAULTS } = await import('./voice-effects-settings.mjs');
    const context = new OfflineAudioContext(1, 48000, 48000),
      effect = new VoiceEffects(context, context.destination);
    effect.configure({
      ...VOICE_EFFECT_DEFAULTS,
      enabled: true,
      preset: 'custom',
      mix: 100,
      electronicMix: 100,
      carrierHz: 60,
    });
    const source = context.createBufferSource(),
      buffer = context.createBuffer(1, 48000, 48000),
      pcm = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / 48000);
    source.buffer = buffer;
    source.connect(effect.input);
    source.start();
    const rendered = (await context.startRendering()).getChannelData(0);
    const amplitude = (hz) => {
      let s = 0,
        c = 0;
      for (let i = 4096; i < rendered.length; i++) {
        s += rendered[i] * Math.sin((2 * Math.PI * hz * i) / 48000);
        c += rendered[i] * Math.cos((2 * Math.PI * hz * i) / 48000);
      }
      return (2 * Math.hypot(s, c)) / (rendered.length - 4096);
    };
    const result = {
      lower: amplitude(160),
      upper: amplitude(280),
      original: amplitude(220),
      peak: Math.max(...rendered.map(Math.abs)),
    };
    effect.destroy();
    return result;
  });
  assert(
    audio.lower > 0.02 && audio.upper > 0.02 && audio.original < 0.01 && audio.peak < 1,
    JSON.stringify(audio),
  );
  record('Electronic voice produces real modulation sidebands without clipping', audio);
  await navigate('time');
  const stopwatch = await page.evaluate(() => window.capri.timeAction({ action: 'stopwatch' }));
  await page.waitForSelector('#stopwatch-hud:not([hidden])');
  await page.waitForFunction(
    () => document.querySelector('#stopwatch-hud').textContent !== '00:00:00',
  );
  const first = await page.locator('#stopwatch-hud').textContent();
  await page.evaluate(() =>
    window.capri.send({ id: crypto.randomUUID(), text: 'How much time has passed?' }),
  );
  await page.waitForTimeout(1100);
  await page.evaluate(() => window.capri.send({ id: crypto.randomUUID(), text: 'А сейчас?' }));
  const messages = (await page.evaluate(() => window.capri.bootstrap())).messages;
  assert(messages.at(-1).text.includes(':') && !messages.at(-1).text.includes('{time}'));
  await page.evaluate((id) => window.capri.timeAction({ action: 'pause', id }), stopwatch.id);
  const paused = await page.locator('#stopwatch-hud').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#stopwatch-hud').textContent(), paused);
  record('Stopwatch HUD, fresh elapsed replies and pause agree', { first, paused });
  for (const locale of ['ru', 'ar', 'en']) {
    await page.evaluate(
      async (language) =>
        window.capri.setLanguages({
          ...(await window.capri.bootstrap()).languages,
          interface: language,
        }),
      locale,
    );
    await settings.waitForFunction(
      (language) => document.documentElement.lang === language,
      locale,
    );
    await navigate('appearance');
    assert.equal(
      await settings.evaluate(() => document.documentElement.dir),
      locale === 'ar' ? 'rtl' : 'ltr',
    );
    assert.equal(await settings.locator('#companion-glitch-strength').isVisible(), true);
    if (locale === 'ru') {
      await search.fill('масштаб портрета');
      await portraitResult.waitFor();
      assert.match(await portraitResult.innerText(), /Масштаб портрета/);
      await search.press('Escape');
    }
    await settings.screenshot({ path: path.join(folder, 'settings-' + locale + '.png') });
  }
  record(
    'Localized search works in Russian and settings switch through RTL Arabic back to English',
  );
  await navigate('initiative');
  await settings.locator('#initiative-level').selectOption('conversational');
  await settings.locator('#initiative-hourly-limit').fill('17');
  await saveSettings(settings);
  await settings.waitForFunction(
    async () => (await window.capri.bootstrap()).initiative.hourlyLimit === 17,
  );
  record('Custom initiative limit saves through actual IPC');
  await navigate('models');
  await settings.waitForFunction(() => document.querySelector('.model-progress-card').hidden);
  record('Idle model selection has no download progress card');
  await navigate('updates');
  await settings.locator('#updates-access-details').evaluate((node) => (node.open = true));
  assert.equal(await settings.locator('#updates-classic-token-page').isVisible(), true);
  record('Classic token path is visible without a failed access attempt');
  await application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === 'capri://desktop/index.html',
    );
    owner.hide();
    owner.showInactive();
  });
  await settings.waitForTimeout(200);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === 'capri://desktop/settings.html')
        .isVisible(),
    ),
    false,
  );
  await page.evaluate(() => window.capri.openSettings('general'));
  await settings.waitForSelector('[data-section="general"][aria-current="page"]');
  record('Tray-style hide/restore does not resurrect settings; explicit reopening works');
  for (let i = 0; i < 10; i++) {
    await settings.evaluate(() => window.capri.closeSettings());
    await page.evaluate(() => window.capri.openSettings('general'));
  }
  assert.equal(application.windows().length, 2);
  const prefs = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => {
      const p = window.webContents.getLastWebPreferences();
      return {
        url: window.webContents.getURL(),
        sandbox: p.sandbox,
        isolated: p.contextIsolation,
        node: p.nodeIntegration,
      };
    }),
  );
  assert(prefs.every((p) => p.sandbox && p.isolated && !p.node));
  await settings.evaluate(() => window.capri.closeSettings());
  const endpoint = JSON.parse(
    readFileSync(path.join(folder, 'data/secrets/desktop-actions.json'), 'utf8'),
  );
  const permissionResponse = await fetch(new URL('/action', endpoint.url), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + endpoint.token, 'content-type': 'application/json' },
    body: JSON.stringify({
      tool: 'settings_control',
      id: 'd'.repeat(64),
      args: { action: 'request', setting: 'screenObservation', value: true },
    }),
  });
  assert.equal(permissionResponse.status, 200);
  const proposal = await permissionResponse.json();
  assert.equal(proposal.needsApproval, true);
  assert.equal(proposal.captureStarted, false);
  await page.locator('#action-approval:not([hidden])').waitFor();
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).screenObservation.active,
    false,
  );
  await page.evaluate(() => window.capri.send({ id: crypto.randomUUID(), text: 'confirm' }));
  await settings.waitForSelector('[data-section="screen"][aria-current="page"]');
  const afterApproval = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(afterApproval.screenObservation.active, false);
  assert.equal(afterApproval.screen.active, false);
  assert.equal(await page.locator('#action-approval').isVisible(), false);
  record(
    'Real settings request and typed confirm open the screen picker without capturing a frame',
  );
  const installation = afterApproval.fileAccess.scopes.find(
    (scope) => scope.kind === 'installation',
  );
  assert.equal(installation.root, folder);
  assert.equal(installation.write, true);
  const fileAction = async (args, id) => {
    const response = await fetch(new URL('/action', endpoint.url), {
      method: 'POST',
      headers: { authorization: 'Bearer ' + endpoint.token, 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'filesystem_control', id: id.repeat(64), args }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const ownFile = { scopeId: installation.id, path: 'installation-access-fixture.json' };
  assert.equal(
    (await fileAction({ ...ownFile, action: 'write_text', text: '{"version":1}' }, 'a')).ok,
    true,
  );
  const original = await fileAction({ ...ownFile, action: 'read_text' }, 'b');
  assert.equal(
    (
      await fileAction(
        {
          ...ownFile,
          action: 'replace_text',
          expectedHash: original.expectedHash,
          text: '{"version":2}',
        },
        'c',
      )
    ).ok,
    true,
  );
  assert.equal(readFileSync(path.join(folder, ownFile.path), 'utf8'), '{"version":2}');
  await navigate('files');
  assert.equal(
    await settings.locator('#file-access-list input[type="checkbox"]').first().isChecked(),
    true,
  );
  assert.equal(await page.locator('#action-approval').isVisible(), false);
  record(
    'Default installation scope is visible and real native file replacement needs no extra dialog',
  );
  await settings.screenshot({ path: path.join(folder, 'settings.png') });
  record('Repeated opening reuses two isolated windows', { prefs });
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log('Report: ' + path.join(folder, 'report.json'));
