/** Real Electron UI with isolated preferences; no capture, playback or owner history. */
import assert from 'node:assert/strict';
import { saveSettings, settingsView } from './settings-view.mjs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { uiText } from '../../apps/desktop/renderer/interface-translations.mjs';
const parent = path.join(root, '.runtime/language-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-')),
  errors = [],
  checks = [];
const server = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
  } else if (req.url === '/v1/chat/completions') {
    req.resume();
    res.setHeader('content-type', 'text/event-stream');
    res.end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'Text-only reply.' } }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: server.address().port,
});
initialize(rt);
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
// A pinned portrait lets the presentation finish without any synthetic input.
// No owner preferences are used or changed by this disposable profile.
writeFileSync(
  path.join(folder, 'desktop/presence.json'),
  JSON.stringify({ schemaVersion: 1, pinned: true }),
);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '1',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
const require = createRequire(import.meta.url);
let application, page, companion;
const report = {
  passed: false,
  folder,
  checks,
  physicalMicrophone: false,
  playback: false,
  ownerHistoryChanged: false,
  startupPresentations: [],
};
async function launch() {
  application = await electron.launch({
    executablePath: require('electron'),
    env,
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    timeout: 60000,
  });
  companion = await application.firstWindow();
  page = companion;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('requestfailed', (r) => errors.push(r.url() + ': ' + r.failure()?.errorText));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 20000,
  });
  // Settings intentionally interrupts the intro. Let it settle first, including
  // on slower CI runners, so that cancellation cannot abort pending image loads.
  // Every renderer, console and request error remains a failure of this verifier.
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive(),
  );
  await companion.waitForFunction(
    () => ['completed', 'skipped'].includes(document.body.dataset.startupIntro),
    null,
    { timeout: 20000 },
  );
  report.startupPresentations.push(
    await companion.locator('body').getAttribute('data-startup-intro'),
  );
  page = await settingsView(application, 'languages');
  await page.evaluate(() => {
    window.__verifySetLanguages = async (value) =>
      window.capri.setLanguages(value, (await window.capri.bootstrap()).settingsVersions.languages);
  });
}
const snapshot = () => page.evaluate(() => window.capri.bootstrap());
async function openSection(id) {
  page = await settingsView(application, id);
  if (id === 'voice') await page.locator('#voice-source-local').click();
}
try {
  await launch();
  assert.equal(await page.locator('#language-conversation option').count(), 101);
  assert.equal((await snapshot()).microphone.enabled, false);
  assert.equal(await page.locator('#language-speech option').count(), 2);
  assert.equal(await page.locator('#language-speech option:disabled').count(), 0);
  assert.match(
    await page.locator('#language-speech option[value="follow"]').textContent(),
    /English.*Capri English/,
  );
  checks.push('JSON language catalog loads in the actual sandboxed renderer');
  await page.selectOption('#language-conversation', 'ru');
  await openSection('microphone');
  await page.selectOption('#language-recognition', 'follow');
  await openSection('voice');
  await page.selectOption('#language-speech', 'follow');
  assert.match(
    await page.locator('#language-speech option[value="follow"]').textContent(),
    /Russian.*multilingual Capri/,
  );
  await saveSettings(page);
  await page.waitForFunction(() =>
    window.capri.bootstrap().then((s) => s.languages.conversation === 'ru'),
  );
  let s = await snapshot();
  assert.equal(s.voice.language, 'ru');
  assert.equal(s.microphone.language, 'ru');
  assert.equal(s.microphone.enabled, false);
  assert.equal(s.recognitionAvailability.ja, true);
  checks.push('Russian applies to conversation, recognition and voice without enabling capture');
  await page.evaluate(async () =>
    window.__verifySetLanguages({ ...(await window.capri.bootstrap()).languages, speech: 'ru' }),
  );
  assert.equal(await page.locator('#language-speech').inputValue(), 'follow');
  checks.push(
    'Automatic shows the matching voice without disabled language choices and restores older explicit preferences',
  );
  await openSection('languages');
  await page.selectOption('#language-conversation', 'ja');
  await openSection('microphone');
  await page.selectOption('#language-recognition', 'auto');
  await saveSettings(page);
  await page.waitForFunction(() =>
    window.capri.bootstrap().then((s) => s.microphone.language === 'auto'),
  );
  assert.equal((await snapshot()).voice.language, 'ja');
  checks.push('Japanese voice and automatic Whisper recognition can be selected independently');
  await openSection('languages');
  await page.selectOption('#language-conversation', 'custom');
  await page.locator('#language-custom').fill('Tamil');
  await saveSettings(page);
  await page.waitForFunction(() =>
    window.capri.bootstrap().then((s) => s.languages.conversation === 'custom'),
  );
  s = await snapshot();
  assert.equal(s.voice.language, 'off');
  assert.equal(s.voice.ready, false);
  assert.equal(s.languages.customConversation, 'Tamil');
  checks.push('Unsupported spoken language has an explicit text-only state');
  await page.evaluate(async () => {
    await window.capri.setSkill({ id: 'capri.voice-output', enabled: true });
    await window.capri.setVoiceEnabled(true);
  });
  await companion.evaluate(() =>
    window.capri.send({ id: crypto.randomUUID(), text: 'A synthetic text-only UI check.' }),
  );
  assert.equal(await companion.evaluate(() => document.body.dataset.voiceBusy), 'false');
  assert.equal(await companion.locator('#voice-toggle').isDisabled(), true);
  checks.push(
    'A text-only reply does not leave speech playback busy even with automatic voice enabled',
  );
  await application.close();
  application = null;
  await launch();
  s = await snapshot();
  assert.equal(s.languages.customConversation, 'Tamil');
  assert.equal(s.voice.language, 'off');
  assert.equal(s.microphone.enabled, false);
  assert.deepEqual(errors, []);
  checks.push('Preferences persist on restart; microphone remains off');
  await application.close();
  application = null;
  env.CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS = '0';
  await launch();
  await page.evaluate(async () =>
    window.__verifySetLanguages({
      ...(await window.capri.bootstrap()).languages,
      conversation: 'ru',
      customConversation: '',
      recognition: 'follow',
      speech: 'off',
      autoDetect: false,
    }),
  );
  s = await snapshot();
  assert.equal(s.languages.conversation, 'ru');
  assert.equal(s.microphone.available, false);
  assert.equal(s.microphone.enabled, false);
  await companion.evaluate(() =>
    window.capri.send({
      id: crypto.randomUUID(),
      text: 'A synthetic reply without optional recognition packs.',
    }),
  );
  assert.equal(await companion.evaluate(() => document.body.dataset.voiceBusy), 'false');
  checks.push(
    'Text conversation can change language and reply without installed recognition or voice packs',
  );
  await page.evaluate(async () =>
    window.__verifySetLanguages({
      ...(await window.capri.bootstrap()).languages,
      conversation: 'en',
      speech: 'follow',
      recognition: 'off',
      interface: 'ru',
    }),
  );
  await openSection('voice');
  assert.equal(await page.locator('#language-speech option').count(), 2);
  assert.ok(
    (await page.locator('#language-speech option[value="follow"]').textContent()).endsWith(
      uiText('Not installed', 'ru'),
    ),
  );
  assert.equal(
    await page.locator('#language-status').textContent(),
    uiText('Voice is not installed. Use Install below.', 'ru'),
  );
  assert.equal(await page.locator('#language-install-speech').isVisible(), true);
  assert.equal(
    await page.locator('#language-install-speech').textContent(),
    uiText('Install', 'ru'),
  );
  checks.push(
    'Spoken replies offers one-click installation of a missing English voice, with Russian instructions and no folder picker',
  );
  await openSection('languages');
  await page.locator('#language-conversation').selectOption('pt');
  await saveSettings(page, { wait: false });
  await page.locator('#confirmation-dialog').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#confirmation-title').textContent(),
    uiText('Selected voice is not installed', 'ru'),
  );
  assert.equal(
    (await snapshot()).languages.conversation,
    'en',
    'missing voice is not saved before a decision',
  );
  await page.locator('#confirmation-actions [data-choice="text"]').click();
  await page.waitForFunction(
    async () => (await window.capri.bootstrap()).languages.conversation === 'pt',
  );
  assert.equal((await snapshot()).languages.speech, 'off');
  assert.equal((await snapshot()).voice.language, 'off');
  checks.push(
    'A missing Portuguese voice offers an explicit choice and saves Portuguese text without starting an unavailable TTS model',
  );
  await openSection('voice');
  await page.evaluate(async () => {
    const { LanguagePanel } = await import('./language-panel.mjs');
    const { LANGUAGE_DEFAULTS } = await import('./language-settings.mjs');
    const record = { selections: [], saved: [], enabled: [], errors: [], cancelled: 0 };
    let status = { phase: 'idle' };
    const panel = new LanguagePanel({
      api: {
        installSpeech: async (selection) => {
          record.selections.push(selection);
          return (status = { phase: 'installing', stage: 'voice-models', selection });
        },
        speechInstallStatus: async () => status,
        setLanguages: async (value) => {
          record.saved.push(value);
          return value;
        },
        setVoiceEnabled: async (value) => record.enabled.push(value),
        cancelSpeechInstall: async () => {
          record.cancelled++;
          return status;
        },
        bugReport: async () => true,
      },
      ui: { text: (key) => key, languageName: (id) => id, apply: () => {} },
      onChange: () => {},
      onOpen: async () => true,
      onError: (error) => record.errors.push(error),
      confirm: { ask: async () => 'install' },
    });
    panel.installed({}, { pt: false });
    panel.show({ ...LANGUAGE_DEFAULTS, conversation: 'pt', recognition: 'off' });
    await panel.open(true);
    window.speechInstallFixture = {
      panel,
      record,
      defaults: LANGUAGE_DEFAULTS,
      setStatus: (value) => {
        status = value;
        panel.installStatus(value);
      },
    };
  });
  await page.locator('#language-install-speech').click({ force: true });
  await page.waitForFunction(() => window.speechInstallFixture.record.selections.length === 1);
  assert.equal(await page.locator('#language-conversation').isDisabled(), true);
  assert.equal(await page.locator('#language-install-progress').isVisible(), true);
  await page.evaluate(async () => {
    const fixture = window.speechInstallFixture;
    await fixture.panel.open(false);
    await fixture.panel.open(true);
    fixture.panel.installed({}, { pt: true });
    fixture.setStatus({ phase: 'ready', selection: { speech: 'pt', recognition: 'off' } });
  });
  await page.waitForFunction(() => window.speechInstallFixture.record.enabled.length === 1);
  assert.equal(await page.locator('#language-conversation').inputValue(), 'pt');
  assert.equal(await page.locator('#language-conversation').isDisabled(), false);
  const autoInstall = await page.evaluate(() => window.speechInstallFixture.record);
  assert.deepEqual(autoInstall.selections, [{ speech: 'pt', recognition: 'off' }]);
  assert.equal(autoInstall.saved[0].conversation, 'pt');
  assert.deepEqual(autoInstall.enabled, [true]);
  assert.deepEqual(autoInstall.errors, []);
  checks.push(
    'One-click Portuguese voice installation survives closing/reopening the panel, applies the language and enables speech without another Apply or any microphone capture',
  );
  await page.evaluate(() => {
    const fixture = window.speechInstallFixture;
    fixture.panel.installed({}, { ja: false });
    fixture.panel.show({ ...fixture.defaults, conversation: 'ja', recognition: 'off' });
  });
  await page.locator('#language-install-speech').click({ force: true });
  await page.locator('#language-install-cancel').click({ force: true });
  await page.evaluate(() => window.speechInstallFixture.setStatus({ phase: 'cancelled' }));
  assert.equal(await page.locator('#language-install-speech').isVisible(), true);
  assert.equal(await page.locator('#language-conversation').inputValue(), 'ja');
  await page.evaluate(() =>
    window.speechInstallFixture.setStatus({
      phase: 'error',
      error: 'Voice installation failed. Retry or save a diagnostic report.',
    }),
  );
  assert.equal(await page.locator('#language-install-report').isVisible(), true);
  assert.equal(await page.evaluate(() => window.speechInstallFixture.record.cancelled), 1);
  checks.push(
    'Cancelled or failed installation keeps the selected language, restores retry and exposes a diagnostic report button',
  );
  await page
    .locator('#voice-local-settings')
    .screenshot({ path: path.join(folder, 'voice-installation.png') });
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.pageErrors = errors;
  report.ui = await page
    ?.evaluate(() => ({
      url: location.href,
      phase: document.body.dataset.phase,
      text: document.body.innerText.slice(-500),
    }))
    .catch(() => null);
  console.error(JSON.stringify(report));
  throw error;
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, 'logs/languages-ui-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
