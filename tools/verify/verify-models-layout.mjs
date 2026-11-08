// SPDX-License-Identifier: GPL-3.0-only
// Isolated native UI; model preparation/restarts stay disabled. No owner profile is changed.
import assert from 'node:assert/strict';
import { settingsView } from './settings-view.mjs';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { displayLanguage, uiText } from '../../apps/desktop/renderer/interface-translations.mjs';
const parent = path.join(root, '.runtime/model-layout-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
  logPrefix: 'model-ui-verification',
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const primary = await application.firstWindow(),
    errors = [];
  let page = primary;
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (item) => item.webContents.getURL() === 'capri://desktop/index.html',
    );
    win.webContents.setBackgroundThrottling(false);
    win.showInactive();
    const original = globalThis.fetch;
    globalThis.fetch = (url, options) =>
      String(url).endsWith('/api/tags')
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                models: [
                  { name: 'qwen3.5:0.8b', size: 1200000123 },
                  { name: 'qwen3.5:2b', size: 2700000123 },
                ],
              }),
            ),
          )
        : original(url, options);
  });
  page = await settingsView(application, 'models');
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await page.locator('#models-choice option').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => !document.getElementById('models-choice').disabled);
  assert.equal(await page.locator('#models-choice option').count(), 6);
  const label = (id) => page.locator(`#models-choice option[value="${id}"]`).textContent();
  assert.match(await label('minimal'), /1\.2 GB · Downloaded/);
  assert.match(await label('balanced'), /2\.7 GB · Downloaded/);
  assert.match(await label('desktop'), /≈ 3\.4 GB/);
  assert.doesNotMatch(await label('desktop'), /Downloaded/);
  const snapshot = await page.evaluate(() => window.capri.modelStatus());
  const measured = snapshot.languageRecommendations?.en ?? [];
  assert.equal(
    await page.locator('#models-language-recommendation').isVisible(),
    Boolean(measured.length),
  );
  assert.deepEqual(
    await page
      .locator('#models-choice optgroup option')
      .evaluateAll((items) => items.map((option) => option.value)),
    measured,
  );
  const chosen = snapshot.profiles.find(
    (profile) => !profile.active && profile.installed && profile.supported,
  );
  assert.ok(chosen);
  await page.selectOption('#models-choice', chosen.id);
  assert.equal(await page.locator('#models-prepare').textContent(), 'Prepare model');
  assert.match(await page.locator('#models-size').textContent(), /^Model files: .* GB$/);
  assert.equal(
    await page.evaluate(() =>
      window.capri.prepareModel('balanced').then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  await page.screenshot({ path: path.join(folder, 'models.png') });
  const sendStatus = (value) =>
    application.evaluate(
      ({ BrowserWindow }, event) => {
        globalThis.modelFixtureStatus = event;
        globalThis.modelFixturePrepared = event.selected;
        BrowserWindow.getAllWindows()
          .filter((win) =>
            ['capri://desktop/index.html', 'capri://desktop/settings.html'].includes(
              win.webContents.getURL(),
            ),
          )
          .forEach((win) => win.webContents.send('capri:event', event));
      },
      { type: 'models.status', ...snapshot, ...value },
    );
  await sendStatus({
    profiles: snapshot.profiles.map((profile) =>
      profile.id === chosen.id ? { ...profile, supported: false, ramGiB: 64 } : profile,
    ),
  });
  assert.equal(await page.locator('#models-choice option:disabled').count(), 0);
  await page.selectOption('#models-choice', chosen.id);
  await page.locator('#models-unavailable').waitFor({ state: 'visible' });
  assert.match(await page.locator('#models-unavailable').textContent(), /more system RAM.*64 GB/);
  assert.equal(await page.locator('#models-prepare').isDisabled(), true);
  assert.equal(await page.locator('#models-local').isDisabled(), true);
  assert.equal(
    await page
      .locator('#models-unavailable')
      .evaluate((element) => getComputedStyle(element).color),
    'rgb(255, 139, 148)',
  );
  await page.screenshot({ path: path.join(folder, 'models-unavailable.png') });
  await sendStatus({ phase: 'idle' });
  await page.selectOption('#models-choice', chosen.id);
  assert.equal(await page.locator('#models-unavailable').isVisible(), false);
  assert.equal(await page.locator('#models-prepare').isDisabled(), false);
  await application.evaluate(({ ipcMain }) => {
    globalThis.modelFixtureProviderSwitches = [];
    globalThis.modelFixturePreparations = [];
    globalThis.modelFixtureApplies = [];
    globalThis.modelFixturePrepareMode = 'ready';
    ipcMain.removeHandler('capri:inference-api-use');
    ipcMain.handle('capri:inference-api-use', (_event, id) => {
      globalThis.modelFixtureProviderSwitches.push(id);
      return false;
    });
    ipcMain.removeHandler('capri:models-prepare');
    ipcMain.handle('capri:models-prepare', (_event, id) => {
      globalThis.modelFixturePreparations.push(id);
      if (globalThis.modelFixturePrepareMode === 'error')
        throw new Error('Synthetic model preparation failure');
      const result = {
        ...globalThis.modelFixtureStatus,
        phase: 'ready',
        selected: globalThis.modelFixturePrepareMode === 'mismatch' ? 'unrelated-model' : id,
      };
      globalThis.modelFixturePrepared = result.selected;
      if (globalThis.modelFixturePrepareMode === 'deferred')
        return new Promise((resolve) => {
          globalThis.modelFixtureResolvePreparation = () => resolve(result);
        });
      return result;
    });
    ipcMain.removeHandler('capri:models-apply');
    ipcMain.handle('capri:models-apply', () => {
      globalThis.modelFixtureApplies.push(globalThis.modelFixturePrepared);
      return false;
    });
    ipcMain.removeHandler('capri:models-cancel');
    ipcMain.handle('capri:models-cancel', () => ({
      ...globalThis.modelFixtureStatus,
      phase: 'idle',
      selected: null,
    }));
  });
  await sendStatus({
    remoteActive: true,
    profiles: snapshot.profiles.map((profile) => ({
      ...profile,
      active: false,
      configured: profile.id === chosen.id,
    })),
  });
  await page.selectOption('#models-choice', chosen.id);
  assert.equal(await page.locator('#models-prepare').textContent(), 'Prepare model');
  const primaryAppearance = () =>
    page.locator('#models-local').evaluate(async (button) => {
      await Promise.all(
        button
          .getAnimations()
          .filter((animation) => animation.effect.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
      const select = document.getElementById('models-choice').getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const painter = canvas.getContext('2d');
      painter.fillStyle = style.backgroundColor;
      painter.fillRect(0, 0, 1, 1);
      const background = painter.getImageData(0, 0, 1, 1).data;
      painter.fillStyle = style.color;
      painter.fillRect(0, 0, 1, 1);
      const foreground = painter.getImageData(0, 0, 1, 1).data;
      const luminance = (rgba) =>
        [...rgba]
          .slice(0, 3)
          .map((value) => value / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const colors = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      return {
        adjacent: button.previousElementSibling.id === 'models-choice',
        prominent: button.classList.contains('model-local-primary'),
        below: rect.top >= select.bottom,
        width: rect.width,
        selectWidth: select.width,
        height: rect.height,
        textColor: style.color,
        backgroundColor: style.backgroundColor,
        contrast: (colors[1] + 0.05) / (colors[0] + 0.05),
      };
    });
  const localPlacement = await primaryAppearance();
  assert(localPlacement.adjacent && localPlacement.prominent && localPlacement.below);
  assert(localPlacement.width >= localPlacement.selectWidth * 0.9 && localPlacement.height >= 40);
  assert(localPlacement.contrast >= 4.5, JSON.stringify(localPlacement));
  await page.locator('#models-local').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixtureProviderSwitches), [
    null,
  ]);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixturePreparations), []);
  assert(
    (await primaryAppearance()).contrast >= 4.5,
    'The hovered primary label keeps its contrast.',
  );
  await page.screenshot({ path: path.join(folder, 'models-local-primary.png') });
  await page.locator('#models-prepare').click();
  await page.waitForFunction(() => !document.getElementById('models-prepare').disabled);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixturePreparations), [
    chosen.id,
  ]);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixtureProviderSwitches), [
    null,
  ]);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixtureApplies), []);
  const alternative = snapshot.profiles.find(
    (profile) => profile.id !== chosen.id && profile.installed && profile.supported,
  );
  assert(alternative);
  const localProfiles = snapshot.profiles.map((profile) => ({
    ...profile,
    active: false,
    configured: profile.id === chosen.id,
  }));
  await sendStatus({
    remoteActive: true,
    phase: 'ready',
    selected: alternative.id,
    profiles: localProfiles,
  });
  await page.selectOption('#models-choice', alternative.id);
  await page.locator('#models-local').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixtureApplies), [
    alternative.id,
  ]);
  await sendStatus({ remoteActive: true, phase: 'idle', profiles: localProfiles });
  await page.locator('#models-local').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixturePreparations), [
    chosen.id,
    alternative.id,
  ]);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixtureApplies), [
    alternative.id,
    alternative.id,
  ]);
  await application.evaluate(() => {
    globalThis.modelFixturePrepareMode = 'mismatch';
  });
  await sendStatus({ remoteActive: true, phase: 'idle', profiles: localProfiles });
  await page.locator('#models-local').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.equal((await application.evaluate(() => globalThis.modelFixtureApplies)).length, 2);
  await application.evaluate(() => {
    globalThis.modelFixturePrepareMode = 'deferred';
  });
  await sendStatus({ remoteActive: true, phase: 'idle', profiles: localProfiles });
  await page.locator('#models-local').click();
  await page.waitForFunction(() => document.getElementById('models-choice').disabled);
  await page.evaluate((id) => {
    const select = document.getElementById('models-choice');
    select.value = id;
    select.dispatchEvent(new Event('change'));
  }, chosen.id);
  await application.evaluate(() => globalThis.modelFixtureResolvePreparation());
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.equal((await application.evaluate(() => globalThis.modelFixtureApplies)).length, 2);
  await sendStatus({ remoteActive: true, phase: 'idle', profiles: localProfiles });
  await page.selectOption('#models-choice', alternative.id);
  await page.evaluate(() => {
    window.modelCancelledSwitch = document.getElementById('models-local').onclick();
  });
  await sendStatus({
    remoteActive: true,
    phase: 'preparing',
    selected: alternative.id,
    profiles: localProfiles,
  });
  await page.locator('#models-cancel').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  await application.evaluate(() => globalThis.modelFixtureResolvePreparation());
  assert.equal(await page.evaluate(() => window.modelCancelledSwitch), false);
  assert.equal((await application.evaluate(() => globalThis.modelFixtureApplies)).length, 2);
  assert.equal(await page.locator('#models-local').isDisabled(), false);
  await application.evaluate(() => {
    globalThis.modelFixturePrepareMode = 'error';
  });
  await sendStatus({ remoteActive: true, phase: 'idle', profiles: localProfiles });
  await page.selectOption('#models-choice', alternative.id);
  await page.locator('#models-local').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.equal((await application.evaluate(() => globalThis.modelFixtureApplies)).length, 2);
  const missing = snapshot.profiles.find((profile) => !profile.installed && profile.supported);
  assert(missing);
  await sendStatus({ phase: 'idle' });
  await page.selectOption('#models-choice', missing.id);
  assert.equal(await page.locator('#models-local').isDisabled(), true);
  assert.match(
    await page.locator('#models-local-help').textContent(),
    /Prepare the selected model first/,
  );
  await sendStatus({
    phase: 'idle',
    profiles: localProfiles.map((profile) =>
      profile.id === alternative.id ? { ...profile, upstreamInstalled: false } : profile,
    ),
  });
  await page.selectOption('#models-choice', alternative.id);
  assert.equal(await page.locator('#models-local').isDisabled(), true);
  await sendStatus({
    phase: 'idle',
    profiles: localProfiles.map((profile) =>
      profile.id === alternative.id ? { ...profile, upstreamInstalled: undefined } : profile,
    ),
  });
  assert.equal(await page.locator('#models-local').isDisabled(), true);
  const originalInference = await page.evaluate(() => window.capri.inferenceApiStatus());
  await application.evaluate(({ ipcMain }, original) => {
    ipcMain.removeHandler('capri:inference-api-status');
    ipcMain.handle('capri:inference-api-status', () => ({ ...original, setupRequired: true }));
    ipcMain.removeHandler('capri:models-refresh');
    ipcMain.handle('capri:models-refresh', () => globalThis.modelFixtureStatus);
  }, originalInference);
  await sendStatus({
    remoteActive: false,
    phase: 'idle',
    profiles: localProfiles.map((profile) => ({
      ...profile,
      active: profile.id === chosen.id,
    })),
  });
  await page.selectOption('#models-choice', chosen.id);
  assert.equal(await page.locator('#models-local').isDisabled(), true);
  await page.locator('#settings-window-close').click();
  page = await settingsView(application, 'models');
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  await page.locator('#models-local').click();
  await page.waitForFunction(() => !document.getElementById('models-local').disabled);
  assert.deepEqual(await application.evaluate(() => globalThis.modelFixtureProviderSwitches), [
    null,
    null,
  ]);
  await application.evaluate(({ ipcMain }, original) => {
    ipcMain.removeHandler('capri:inference-api-status');
    ipcMain.handle('capri:inference-api-status', () => original);
  }, originalInference);
  await sendStatus({ phase: 'idle' });
  await page.locator('#settings-window-close').click();
  page = await settingsView(application, 'models');
  await page.selectOption('#models-choice', chosen.id);
  await sendStatus({
    phase: 'downloading',
    selected: chosen.id,
    progress: { total: 100, completed: 30 },
  });
  await page.locator('#models-progress').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#models-choice').isDisabled(), true);
  assert.equal(await page.locator('#models-local').isDisabled(), true);
  await sendStatus({ phase: 'ready', selected: chosen.id, progress: null });
  await page.locator('#models-apply').waitFor({ state: 'visible' });
  const other = snapshot.profiles.find((profile) => profile.id !== chosen.id && profile.supported);
  await page.selectOption('#models-choice', other.id);
  assert.equal(await page.locator('#models-apply').isVisible(), false);
  const recommendations = { en: [other.id], ru: [chosen.id] };
  const expectRecommendation = async (language, interfaceLanguage, id) => {
    await sendStatus({ languageRecommendations: recommendations });
    const text = uiText('Recommended for {language}', interfaceLanguage, {
      language: displayLanguage(language, interfaceLanguage),
    });
    await page.waitForFunction(
      (label) => document.getElementById('models-language-label').textContent === label,
      text,
    );
    const group = page.locator('#models-choice optgroup');
    assert.equal(await group.getAttribute('label'), text);
    assert.equal(await group.locator('option').first().getAttribute('value'), id);
    assert.equal(await page.locator('#models-choice').inputValue(), other.id);
  };
  await expectRecommendation('en', 'en', other.id);
  page = await settingsView(application, 'languages');
  await page.selectOption('#language-conversation', 'ru');
  page = await settingsView(application, 'models');
  await expectRecommendation('ru', 'en', chosen.id);
  page = await settingsView(application, 'languages');
  await page.selectOption('#language-interface', 'ru');
  page = await settingsView(application, 'models');
  await expectRecommendation('ru', 'ru', chosen.id);
  await page.screenshot({ path: path.join(folder, 'models-ru.png') });
  page = await settingsView(application, 'languages');
  await page.selectOption('#language-interface', 'en');
  await page.selectOption('#language-conversation', 'custom');
  await page.locator('#language-custom').fill('Example');
  page = await settingsView(application, 'models');
  await sendStatus({ languageRecommendations: recommendations });
  assert.equal(await page.locator('#models-choice optgroup').count(), 0);
  assert.equal(await page.locator('#models-language-recommendation').isVisible(), false);
  const persisted = await primary.evaluate(() => window.capri.bootstrap());
  assert.equal(persisted.languages.conversation, 'en');
  assert.equal(persisted.models.current, snapshot.current);
  page = await settingsView(application, 'languages');
  await page.locator('#language-custom').fill('');
  await page.selectOption('#language-conversation', 'en');
  page = await settingsView(application, 'applications');
  await page.locator('#spotify-access').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#spotify-access').textContent(), 'Enable Spotify');
  assert.equal(await page.locator('#spotify-check').isDisabled(), true);
  assert.equal(await page.locator('#spotify-repair').isVisible(), false);
  assert.equal(
    await page.evaluate(() =>
      window.capri.setSpotifyAccess(true).then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  const showSpotify = (settings) =>
    application.evaluate(
      ({ BrowserWindow }, event) =>
        BrowserWindow.getAllWindows()
          .filter((win) =>
            ['capri://desktop/index.html', 'capri://desktop/settings.html'].includes(
              win.webContents.getURL(),
            ),
          )
          .forEach((win) => win.webContents.send('capri:event', event)),
      { type: 'spotify.settings', settings },
    );
  await showSpotify({ enabled: true, prepared: true, phase: 'idle', connection: 'connected' });
  await page.waitForFunction(
    () => document.getElementById('spotify-access').textContent === 'Disable Spotify',
  );
  assert.equal(await page.locator('#spotify-check').isEnabled(), true);
  assert.equal(await page.locator('#spotify-result').textContent(), 'Connected to Spotify.');
  await showSpotify({ enabled: true, prepared: false, phase: 'idle' });
  await page.locator('#spotify-repair').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#spotify-access').textContent(), 'Disable Spotify');
  assert.equal(await page.locator('#spotify-check').isDisabled(), true);
  await page.screenshot({ path: path.join(folder, 'spotify.png') });
  await page.locator('#settings-window-close').click();
  page = primary;
  // Enter compact mode using its actual pin toggle rather than changing renderer state.
  if ((await page.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await page.locator('#presence-toggle').click({ force: true });
  await page.locator('#presence-toggle').click({ force: true });
  await page.waitForFunction(() => document.body.dataset.presence === 'core');
  const results = [];
  const compactGap = 4; // The core grid uses the same gap as the toolbar.
  for (const [width, height] of [
    [480, 660],
    [380, 480],
    [320, 360],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows().find(
          (item) => item.webContents.getURL() === 'capri://desktop/index.html',
        );
        win.setContentSize(size.width, size.height);
      },
      { width, height },
    );
    for (const busy of [false, true]) {
      await page.evaluate((busy) => {
        const notice = document.getElementById('notice');
        notice.hidden = !busy;
        document.getElementById('notice-message').textContent = busy
          ? 'A detailed notification that must not cover the compact controls. '.repeat(12)
          : '';
        document.getElementById('clip-result').hidden = !busy;
        document.getElementById('microphone-preview').hidden = !busy;
        document.getElementById('microphone-text').textContent = busy
          ? 'A long recognition preview during a spoken command. '.repeat(6)
          : '';
        document.getElementById('screen-indicator').hidden = !busy;
        document.getElementById('message').value = busy
          ? 'A multiline message that also needs enough room in the input box. '.repeat(6)
          : '';
        document.getElementById('message').dispatchEvent(new Event('input'));
      }, busy);
      await page.waitForTimeout(500);
      const geometry = await page.evaluate(() => {
        const box = (id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const buttons = [...document.querySelectorAll('#handle .window-actions button')]
          .filter((button) => !button.hidden)
          .map((button) => {
            const r = button.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          });
        return {
          header: box('handle'),
          core: box('presence-core'),
          dock: box('input-dock'),
          symbol: document.querySelector('.core-symbol').getBoundingClientRect().height,
          buttons,
          width: innerWidth,
          height: innerHeight,
        };
      });
      assert.ok(
        geometry.header.bottom + compactGap <= geometry.core.y,
        JSON.stringify({ width, height, busy, geometry }),
      );
      assert.ok(
        geometry.core.bottom + compactGap <= geometry.dock.y,
        JSON.stringify({ width, height, busy, geometry }),
      );
      assert.ok(
        geometry.header.y >= 0 && geometry.dock.bottom <= height + 1,
        JSON.stringify({ width, height, busy, geometry }),
      );
      for (const button of geometry.buttons)
        assert.ok(
          button.x >= 0 &&
            button.right <= width &&
            button.y >= 0 &&
            button.bottom <= geometry.core.y,
        );
      const composerVisible = await page.locator('.composer').evaluate((element) => {
        const r = element.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          document.elementFromPoint(r.right - 25, r.top + r.height / 2)?.closest('.composer') ===
            element
        );
      });
      assert.equal(
        composerVisible,
        true,
        'Composer must remain visible without scrolling notifications',
      );
      results.push({ width, height, notifications: busy, symbol: geometry.symbol });
      await page.screenshot({
        path: path.join(folder, `core-${width}-${height}-${busy ? 'busy' : 'idle'}.png`),
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      compactLayouts: results,
      modelChoices: 6,
      downloadedSizes: true,
      measuredLanguageRecommendations: measured,
      languageRecommendations: true,
      spotifySettings: true,
      screenshots: folder,
      ownerDataAccessed: false,
      modelSwitched: false,
      localPrimary: localPlacement,
    }),
  );
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
