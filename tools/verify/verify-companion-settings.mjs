// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { saveSettings, settingsView } from './settings-view.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { MAX_API_KEY_LENGTH } from '../../apps/desktop/renderer/api-key.mjs';

const parent = path.join(root, '.runtime/companion-settings-verification');
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
  logPrefix: 'settings-verification',
});
initialize(rt);
const state = path.join(folder, 'desktop');
mkdirSync(state, { recursive: true });
const firstLaunch = path.join(state, 'first-start.json');
writeFileSync(firstLaunch, JSON.stringify({ schemaVersion: 1, preloadModels: false }));
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application, page, owner;
const errors = [];
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  const initial = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(initial.companion.floatEnabled, false);
  assert.deepEqual(
    initial.startup.stages.map(({ id }) => id),
    ['core'],
  );
  assert.equal(existsSync(firstLaunch), false);
  const speechInstallPhase = (phase) =>
    application.evaluate(({ BrowserWindow }, phase) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
        .webContents.send('capri:event', { type: 'speech-install.status', phase });
    }, phase);
  const composer = page.locator('#message');
  await composer.fill('Keep this draft');
  await page.waitForFunction(() => !document.getElementById('send').disabled);
  await speechInstallPhase('installing');
  await page.waitForFunction(() => document.getElementById('send').disabled);
  await composer.press('Enter');
  assert.equal(await composer.inputValue(), 'Keep this draft');
  await composer.press('End');
  await composer.press('Shift+Enter');
  assert.equal(await composer.inputValue(), 'Keep this draft\n');
  await speechInstallPhase('idle');
  await page.waitForFunction(() => !document.getElementById('send').disabled);
  await composer.fill('');
  owner = page;
  await owner.locator('#presence-toggle').click({ force: true });
  page = await settingsView(application, 'api');
  const enableApi = page.locator('#api-add');
  const providerFields = ['provider', 'url', 'model', 'key', 'tools', 'vision', 'context'];
  assert.equal(await enableApi.getAttribute('aria-expanded'), 'false');
  for (const id of providerFields)
    assert.equal(await page.locator('#api-' + id).isDisabled(), true);
  await enableApi.click();
  for (const id of providerFields) assert.equal(await page.locator('#api-' + id).isEnabled(), true);
  await page.locator('#api-model').fill('old-provider/model');
  await page.locator('#api-key').fill('local-ui-test');
  await page.locator('#api-provider').selectOption('proxyapi');
  assert.equal(await page.locator('#api-url').inputValue(), 'https://api.proxyapi.ru/v1');
  assert.equal(await page.locator('#api-model').inputValue(), '');
  assert.equal(await page.locator('#api-key').inputValue(), '');
  await page.locator('#api-key').fill('proxyapi-test');
  await page.locator('#api-url').fill('https://custom.example/v1');
  assert.equal(await page.locator('#api-provider').inputValue(), 'custom');
  assert.equal(await page.locator('#api-key').inputValue(), '');
  await page.locator('#api-key').fill('local-ui-test');
  await page.locator('#api-cancel').click();
  assert.equal(await page.locator('#api-key').inputValue(), '');
  for (const id of providerFields)
    assert.equal(await page.locator('#api-' + id).isDisabled(), true);
  const addConnection = async (name, preset, model, pastedKey) => {
    await enableApi.click();
    await page.locator('#api-name').fill(name);
    await page.locator('#api-provider').selectOption(preset);
    await page.locator('#api-model').fill(model);
    if (pastedKey === undefined) await page.locator('#api-key').fill('fixture-api-key-' + preset);
    else
      await page.locator('#api-key').evaluate((field, text) => {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        field.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, pastedKey);
    await page.locator('#api-save').click();
    await page.locator('.api-connection').filter({ hasText: name }).waitFor();
    assert.equal(await page.locator('#api-key').inputValue(), '');
    const keyState = page
      .locator('.api-connection')
      .filter({ hasText: name })
      .locator('.api-key-state');
    assert.equal(await keyState.inputValue(), '');
    assert.equal(await keyState.getAttribute('placeholder'), 'Encrypted');
    assert.equal(await keyState.evaluate((field) => field.readOnly), true);
  };
  await addConnection('Fixture One', 'proxyapi', 'fixture/one');
  await addConnection('Fixture Two', 'openrouter', 'fixture/two');
  assert.equal(await page.locator('.api-connection').count(), 2);
  assert.equal(await page.locator('#api-local').count(), 0);
  assert.match(await page.locator('#api-mode').textContent(), /Local/);
  // In-window mock only. Verification cannot contact any real provider.
  await page.evaluate(async () => {
    const { InferencePanel } = await import('./inference-panel.mjs');
    const { MAX_API_KEY_LENGTH } = await import('./api-key.mjs');
    const source = await window.capri.inferenceApiStatus();
    const original = document.getElementById('inference-panel');
    original.remove();
    const saved = [],
      validationErrors = [];
    const panel = new InferencePanel({
      ui: { text: (text) => text, language: 'en' },
      onError: (message) => validationErrors.push(message),
      api: {
        saveInferenceApi: async (value) => {
          saved.push(value);
        },
        inferenceApiStatus: async () => source,
        testInferenceApi: async (id) => {
          if (id === 'fixture-gemini')
            throw new Error(
              'API provider returned HTTP 404. Check the base URL and the model ID for this provider.',
            );
          if (id === source.profiles[1].id) throw new Error('API provider returned HTTP 401.');
          return { elapsedMs: 456 };
        },
      },
    });
    panel.show({ ...source, activeId: source.profiles[0].id });
    panel.panel.hidden = false;
    panel.get('test-all').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (
      !panel.get('mode').textContent.includes(source.profiles[0].model) ||
      panel.panel.querySelectorAll('[data-health="available"][data-active="true"]').length !== 1 ||
      panel.panel.querySelectorAll('[data-health="unavailable"]').length !== 1
    )
      throw new Error('Bulk API check or current model indication failed.');
    const paste = (text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      panel
        .get('key')
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
    };
    panel.get('add').click();
    panel.get('model').value = 'gemini-3.8-flash';
    panel.get('provider').value = 'gemini';
    panel.get('provider').dispatchEvent(new Event('change', { bubbles: true }));
    if (
      panel.get('url').value !== 'https://generativelanguage.googleapis.com/v1beta/openai' ||
      panel.get('model').value !== 'gemini-3.8-flash' ||
      panel.get('vision').checked
    )
      throw Error(
        'Google preset must set only its URL, preserve the selected model and keep vision off.',
      );
    if (panel.get('key').maxLength !== MAX_API_KEY_LENGTH)
      throw Error('The key field must use the shared maximum.');
    const copied = 'AIza-synthetic-ui-copy-key';
    paste('\uFEFF  "' + copied + '"  \u200B');
    if (panel.get('key').value !== copied)
      throw Error('Padded quoted key paste was not canonicalized.');
    const validDraft = panel.get('key').value;
    const errorsBefore = validationErrors.length;
    paste('synthetic-first\r\nsynthetic-second');
    if (
      validationErrors.length !== errorsBefore + 1 ||
      panel.get('key').value !== validDraft ||
      saved.length
    )
      throw Error('Multiline key paste must fail before password-input newline removal and IPC.');
    paste('x'.repeat(MAX_API_KEY_LENGTH + 1));
    if (
      validationErrors.length !== errorsBefore + 2 ||
      panel.get('key').value !== validDraft ||
      saved.length
    )
      throw Error('Oversized key paste must be rejected instead of silently truncated.');
    panel.get('key').value = 'synthetic internal space';
    await panel.get('save').onclick();
    if (saved.length || panel.get('key').value !== 'synthetic internal space')
      throw Error('Invalid manual key must stay editable without IPC.');
    panel.get('key').value = 'x'.repeat(MAX_API_KEY_LENGTH + 1);
    await panel.get('save').onclick();
    if (saved.length || panel.get('key').value.length !== MAX_API_KEY_LENGTH + 1)
      throw Error('Oversized manual key must not invoke IPC.');
    panel.get('key').value = '';
    paste('AQ.' + 'synthetic-'.repeat(200));
    await panel.get('save').onclick();
    if (
      saved.length !== 1 ||
      saved[0].key !== 'AQ.' + 'synthetic-'.repeat(200) ||
      panel.get('key').value
    )
      throw Error(
        'Long AQ key save must preserve the canonical value and clear the field after success.',
      );
    panel.show({
      ...source,
      profiles: [
        ...source.profiles,
        {
          id: 'fixture-gemini',
          name: 'Google Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-1.5-pro',
          hasKey: true,
          canConnect: true,
        },
      ],
    });
    await panel.test('fixture-gemini');
    const modelError = panel.rows.get('fixture-gemini').status.textContent;
    if (!modelError.includes('HTTP 404') || modelError.includes('Enter a valid API key'))
      throw Error('Retired model errors must remain distinct from key-format errors.');
    panel.panel.replaceWith(original);
  });
  await enableApi.click();
  await page.locator('#api-provider').selectOption('lemonade');
  assert.equal(await page.locator('#api-url').inputValue(), 'http://127.0.0.1:13305/api/v1');
  assert.equal(await page.locator('#api-model').inputValue(), 'Phi-4-mini-instruct-NPU');
  assert.equal(await page.locator('#api-context').inputValue(), '8192');
  assert.equal(await page.locator('#api-tools').isChecked(), false);
  assert.equal(await page.locator('#api-key').inputValue(), '');
  await page.locator('#api-save').click();
  const lemonade = page.locator('.api-connection').filter({ hasText: 'Phi-4-mini-instruct-NPU' });
  await lemonade.waitFor();
  assert.equal(await lemonade.getByRole('button', { name: 'Test connection' }).isEnabled(), true);
  assert.equal(await lemonade.getByRole('button', { name: 'Use connection' }).isEnabled(), true);
  assert.equal(await lemonade.locator('.api-key-state').count(), 0);
  await addConnection(
    'Fixture Google classic',
    'gemini',
    'gemini-3.8-flash',
    '\uFEFF  "AIza-synthetic-ui-canonical-key"  \u200B',
  );
  await addConnection(
    'Fixture Google auth',
    'gemini',
    'gemini-3.8-flash',
    'AQ.' + 'x'.repeat(MAX_API_KEY_LENGTH - 3),
  );
  const storedApiProfiles = JSON.parse(
    readFileSync(path.join(folder, 'data/secrets/inference-api-profiles.json'), 'utf8'),
  );
  const longAuth = storedApiProfiles.profiles.find(
    (profile) => profile.name === 'Fixture Google auth',
  );
  assert(longAuth?.credential?.ciphertext);
  const longAuthRecovered = await application.evaluate(async ({ safeStorage }, ciphertext) => {
    const value = await safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'));
    const text = typeof value === 'string' ? value : value.result;
    return { length: text.length, canonical: text === 'AQ.' + 'x'.repeat(4093) };
  }, longAuth.credential.ciphertext);
  assert.deepEqual(longAuthRecovered, { length: MAX_API_KEY_LENGTH, canonical: true });
  assert.equal(JSON.stringify(storedApiProfiles).includes('AQ.' + 'x'.repeat(4093)), false);
  await page.screenshot({ path: path.join(folder, 'api-key-encrypted.png') });
  const position = await page.evaluate(() => {
    const main = document.getElementById('companion'),
      nav = document.getElementById('settings-navigation');
    main.scrollTop = 110;
    nav.scrollTop = 140;
    return { top: main.scrollTop, navigation: nav.scrollTop };
  });
  assert.ok(position.top > 0 && position.navigation > 0);
  const closeSettings = async () => {
    await page.locator('#settings-window-close').click();
    for (let i = 0; i < 100; i++) {
      const visible = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (view) =>
            view.webContents.getURL() === 'capri://desktop/settings.html' && view.isVisible(),
        ),
      );
      if (!visible) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail('Settings did not close');
  };
  const assertRestored = async () => {
    await page.locator('[data-section="api"][aria-current="page"]').waitFor();
    await page.waitForFunction((expected) => {
      const main = document.getElementById('companion'),
        nav = document.getElementById('settings-navigation');
      return (
        Math.abs(main.scrollTop - expected.top) < 2 &&
        Math.abs(nav.scrollTop - expected.navigation) < 2
      );
    }, position);
  };
  await closeSettings();
  page = await settingsView(application);
  await assertRestored();
  // Per-section positions survive switching, and a recreated renderer reads only UI location.
  page = await settingsView(application, 'appearance');
  await page.evaluate(() => {
    document.getElementById('companion').scrollTop = 230;
  });
  page = await settingsView(application, 'api');
  await assertRestored();
  await closeSettings();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL() === 'capri://desktop/settings.html')
      .destroy(),
  );
  page = await settingsView(application);
  await assertRestored();
  await page.screenshot({ path: path.join(folder, 'settings-location-restored.png') });
  await owner.evaluate(() => window.capri.openSettings('model-context'));
  await page.locator('[data-section="models"][aria-current="page"]').waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'models-context');
  page = await settingsView(application, 'support');
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('[data-companion-tab="support"]').waitFor({ state: 'visible' });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
      .webContents.send('capri:event', {
        type: 'startup.progress',
        finished: false,
        stages: [{ id: 'voice', state: 'running', estimate: 600, started: Date.now() }],
      }),
  );
  await owner.locator('#startup-progress').waitFor({ state: 'visible' });
  const assertAboveStartup = async () => {
    assert.equal(await owner.locator('.preferences-panel:not([hidden])').count(), 0);
    assert.deepEqual(
      await application.evaluate(({ BrowserWindow }) => {
        const all = BrowserWindow.getAllWindows(),
          main = all.find((window) => window.webContents.getURL() === 'capri://desktop/index.html'),
          settings = all.find(
            (window) => window.webContents.getURL() === 'capri://desktop/settings.html',
          );
        return {
          separate: main.id !== settings.id,
          independent: settings.getParentWindow() === null,
          visible: settings.isVisible(),
        };
      }),
      // Native ownership can restore hidden Settings independently on Windows.
      // The lifecycle controller now manages the two windows explicitly.
      { separate: true, independent: true, visible: true },
    );
  };
  await assertAboveStartup();
  const heartOffset = await page.locator('.support-art').evaluate((art) => {
    const heart = art.querySelector('.support-heart').getBoundingClientRect();
    const orbit = art.querySelector('.support-orbit').getBoundingClientRect();
    return Math.abs(heart.top + heart.height / 2 - orbit.top - orbit.height / 2);
  });
  assert.ok(heartOffset <= 1, 'The support heart must remain centered in its orbit');
  await page.screenshot({ path: path.join(folder, 'support.png') });
  page = await settingsView(application, 'dialogue');
  await page.locator('#personality-text').fill('A warm fictional cyberpunk companion.');
  await saveSettings(page);
  await page.waitForFunction(
    async () =>
      (await window.capri.getPersonality()).text === 'A warm fictional cyberpunk companion.',
  );
  assert.equal(
    (await page.evaluate(() => window.capri.getPersonality())).text,
    'A warm fictional cyberpunk companion.',
  );
  assert.equal(
    readFileSync(path.join(rt.workspace, 'PERSONALITY.md'), 'utf8'),
    'A warm fictional cyberpunk companion.',
  );
  writeFileSync(path.join(rt.workspace, 'PERSONALITY.md'), 'An externally edited companion.');
  assert.equal(
    (await page.evaluate(() => window.capri.getPersonality())).text,
    'An externally edited companion.',
  );
  await page.locator('#personality-text').fill('');
  await saveSettings(page);
  const original = readFileSync(path.join(root, 'config/workspace/PERSONALITY.md'), 'utf8').trim();
  await page.waitForFunction(
    (expected) => document.getElementById('personality-text').value === expected,
    original,
  );
  assert.equal(readFileSync(path.join(rt.workspace, 'PERSONALITY.md'), 'utf8'), original);
  for (const name of ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'TOOLS.md', 'personality.json'])
    assert.equal(existsSync(path.join(rt.workspace, name)), false);
  page = await settingsView(application, 'microphone');
  await page.locator('#wake-sound').selectOption('off');
  await saveSettings(page);
  await page.locator('#settings-draft-actions').waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).companion.wakeSound, 'off');
  assert.equal(
    await page.evaluate(() =>
      window.capri.communityLink('file:///bad').then(
        () => true,
        () => false,
      ),
    ),
    false,
  );
  await page.screenshot({ path: path.join(folder, 'settings.png') });
  page = await settingsView(application, 'languages');
  await assertAboveStartup('#language-panel');
  const width = await page
    .locator('#language-panel')
    .evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(width <= 680 && width > 300);
  await page.screenshot({ path: path.join(folder, 'languages.png') });
  await page.selectOption('#language-interface', 'ru');
  await page.locator('[data-section="support"]').click();
  await page.locator('[data-companion-tab="support"]').waitFor();
  assert.equal(await page.locator('#settings-draft-actions').isHidden(), true);
  await page.locator('#settings-window-close').click();
  await page.locator('#settings-draft-actions').waitFor();
  assert.equal(await page.locator('#confirmation-dialog[open]').count(), 0);
  await page.screenshot({ path: path.join(folder, 'unsaved-settings.png') });
  assert.equal(await page.locator('#language-panel').isVisible(), false);
  assert.equal(await page.locator('#language-interface').inputValue(), 'ru');
  await page.locator('#settings-discard').click();
  await settingsView(application, 'support');
  await page.locator('[data-companion-tab="support"]').waitFor({ state: 'visible' });
  assert.ok((await page.locator('.support-developer').textContent()).includes('Overyx'));
  assert.equal(await page.locator('[data-community="tiktok"]').textContent(), 'TikTok');
  assert.equal(await page.locator('#companion-result').isVisible(), false);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).languages.interface, 'en');
  page = await settingsView(application, 'languages');
  await page.selectOption('#language-interface', 'ru');
  // This fixture intentionally has no installed voice pack. Explicit text mode
  // keeps the navigation check separate from the tested missing-pack dialog.
  await page.selectOption('#language-speech', 'off');
  await page.locator('[data-section="support"]').click();
  await saveSettings(page);
  await page.waitForFunction(
    () =>
      document.documentElement.lang === 'ru' && document.getElementById('language-panel').hidden,
  );
  const savedState = await page.evaluate(() => window.capri.bootstrap());
  await page.evaluate(
    (state) =>
      window.capri.setLanguages(
        { ...state.languages, interface: 'en' },
        state.settingsVersions.languages,
      ),
    savedState,
  );
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  page = await settingsView(application, 'appearance');
  await page.locator('#companion-button-feedback').uncheck();
  await saveSettings(page);
  await page.waitForTimeout(450);
  assert.equal(
    (await page.evaluate(() => window.capri.bootstrap())).companion.buttonFeedback,
    false,
  );
  assert.equal(
    await page
      .locator('#settings-apply')
      .evaluate((el) => el.classList.contains('button-acknowledged')),
    false,
  );
  assert.equal(await owner.locator('#subtitle-pause').count(), 0);
  assert.equal(await owner.locator('[data-quick="spotify"]').count(), 0);
  page = await settingsView(application, 'bug');
  await page.locator('#bug-description').fill('Synthetic voice diagnostic UI check.');
  await page.locator('#bug-steps').fill('Enable voice and send a synthetic message.');
  assert.equal(await page.locator('#bug-category').inputValue(), 'voice');
  assert.equal(await page.locator('#bug-logs').isChecked(), true);
  await assertAboveStartup('#companion-settings');
  await page.screenshot({ path: path.join(folder, 'bug-report.png') });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'support panel',
        'settings navigation',
        'last Settings section, per-section content scroll and sidebar scroll survive reopening and renderer recreation',
        'explicit context shortcut still focuses its control',
        'private personality save',
        'one Personality file for menu edits, external edits and reset',
        'wake settings',
        'external URL allowlist',
        'language panel width',
        'unsaved changes stay/discard/apply',
        'button feedback preference',
        'Google Gemini preset and copied quoted/long auth keys through isolated encrypted IPC',
        'oversized and multiline key paste rejected before browser mutation or IPC',
        'key validation retains invalid drafts and distinguishes model HTTP 404',
        'support author attribution and clean status',
        'independent settings window stays usable during active startup feedback',
        'structured diagnostic report form',
        'no renderer errors',
      ],
      screenshots: folder,
    }),
  );
} catch (error) {
  const snapshot = await Promise.race([
    page
      ?.evaluate(() => ({
        phase: document.body.dataset.phase,
        modal: Boolean(document.querySelector('#confirmation-dialog[open]')),
        panel: document.getElementById('companion-settings')?.hidden,
        contextDisabled: document.getElementById('context-clear')?.disabled,
        focus: document.activeElement?.id,
      }))
      .catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  console.error('Companion UI verification state:', JSON.stringify({ snapshot, errors }));
  throw error;
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
