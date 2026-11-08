/** Isolated real Electron localization check. No models, microphone or user screen. */
import assert from 'node:assert/strict';
import { saveSettings, settingsView } from './settings-view.mjs';
import { SETTINGS_SECTIONS } from '../../apps/desktop/renderer/settings-registry.mjs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import {
  INTERFACE_LOCALES,
  uiText,
  displayLanguage,
} from '../../apps/desktop/renderer/interface-translations.mjs';
import { WORKFLOW_ACTION_LABELS } from '../../apps/desktop/renderer/workflows-panel.mjs';
const parent = path.join(root, '.runtime/interface-locales-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-')),
  errors = [],
  checks = [];
let holdReplies = false,
  heldResponse;
const server = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[]}');
  } else if (req.url === '/v1/chat/completions') {
    req.resume();
    res.setHeader('content-type', 'text/event-stream');
    if (holdReplies) {
      heldResponse = res;
      return;
    }
    res.end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'Open' } }] }) +
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
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(
  path.join(folder, 'desktop/languages.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: {
      interface: 'en',
      conversation: 'en',
      recognition: 'follow',
      speech: 'en',
      autoDetect: false,
      customConversation: '',
    },
  }),
);
const require = createRequire(import.meta.url),
  report = {
    passed: false,
    folder,
    checkedLocales: [],
    screenshots: [],
    physicalMicrophone: false,
    screenCapture: false,
    ownerHistoryChanged: false,
  };
let application, page, controls;
const workflowFixture = [
  { action: 'click', selector: { role: 'ControlType.Button', label: 'Open' } },
  { action: 'drag', selector: { role: 'ControlType.Button', label: 'Settings' } },
  { action: 'keys', keys: ['CTRL', 'A'] },
  { action: 'scroll', amount: -120 },
  { action: 'text', selector: { role: 'ControlType.Edit', label: 'Menu' }, text: '{{ownerText}}' },
];
try {
  application = await electron.launch({
    executablePath: require('electron'),
    env,
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    timeout: 60000,
  });
  page = await application.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 30000,
  });
  controls = await settingsView(application, 'languages');
  await controls.evaluate((steps) => {
    document.getElementById('workflow-json').value = JSON.stringify(steps);
    document.getElementById('workflow-edit').click();
  }, workflowFixture);
  await page.evaluate(() => window.capri.send({ id: crypto.randomUUID(), text: 'Languages' }));
  await page.evaluate(() => {
    const data = document.createElement('p');
    data.id = 'localization-private-data';
    data.dataset.untranslated = 'true';
    data.textContent = 'Menu';
    document.getElementById('file-access-list').append(data);
    const input = document.getElementById('message');
    input.value = 'Open';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const initial = await page.evaluate(() => window.capri.bootstrap());
  holdReplies = true;
  const activeRequest = page.evaluate(() =>
    window.capri.send({ id: crypto.randomUUID(), text: 'A synthetic active-reply check.' }),
  );
  await page.waitForFunction(() => window.capri.bootstrap().then((s) => Boolean(s.activeTurnId)));
  await controls.selectOption(
    '#language-interface',
    INTERFACE_LOCALES.find((l) => l.id !== 'en').id,
  );
  await saveSettings(controls);
  await controls.waitForFunction(() => !document.getElementById('language-apply').disabled);
  await page.waitForFunction(() =>
    window.capri.bootstrap().then((s) => s.languages.interface !== 'en'),
  );
  assert.ok(heldResponse, 'The isolated chat request must still be in progress');
  heldResponse.end(
    'data: ' +
      JSON.stringify({ choices: [{ delta: { content: 'Open' } }] }) +
      '\n\ndata: [DONE]\n\n',
  );
  holdReplies = false;
  await activeRequest;
  const expectedMessages = ['Languages', 'Open', 'A synthetic active-reply check.', 'Open'];
  report.interfaceOnlyDuringReply = true;

  assert.equal(
    await controls.locator('#language-interface option').count(),
    INTERFACE_LOCALES.length,
  );
  for (const locale of INTERFACE_LOCALES) {
    await controls.selectOption('#language-interface', locale.id);
    if ((await controls.evaluate(() => window.capri.bootstrap())).languages.interface !== locale.id)
      await saveSettings(controls);
    await controls.waitForFunction(() => !document.getElementById('language-apply').disabled);
    await page.waitForFunction(
      (id) => window.capri.bootstrap().then((s) => s.languages.interface === id),
      locale.id,
    );
    assert.equal(
      await controls.locator('#language-panel h2').textContent(),
      uiText('Languages', locale.id),
    );
    assert.equal(
      await controls.locator('label[for="language-interface"]').textContent(),
      uiText('Interface language', locale.id),
    );
    assert.equal(
      await controls.locator('#settings-apply').textContent(),
      uiText('Save changes', locale.id),
    );
    assert.equal(
      await controls.locator('#settings-stay').textContent(),
      uiText('Keep editing', locale.id),
    );
    for (const [selector, key] of [
      ['#api-skip-local-model', 'Skip local language model when using an API'],
      ['#call-output-share-replies', 'Send replies to call'],
      ['#music-listening-auto-bpm', 'Automatically match the track BPM'],
    ]) {
      const text = await controls
        .locator(selector)
        .evaluate((element) => element.closest('label').textContent.replace(/\s+/g, ' ').trim());
      assert.equal(text, uiText(key, locale.id), locale.id + ': ' + selector);
    }
    for (const [selector, key] of [
      ['#call-setup-connect', 'Set up automatically'],
      ['#call-setup-install', 'Install VB-CABLE and connect'],
      ['#call-setup-license', 'License terms'],
      ['label[for="time-hours"]', 'Hours'],
      ['label[for="time-seconds"]', 'Seconds'],
    ])
      assert.equal(
        (await controls.locator(selector).textContent()).replace(/\s+/g, ' ').trim(),
        uiText(key, locale.id),
        locale.id + ': ' + selector,
      );
    assert.equal(
      await controls.locator('#voice-model-language option[value="en"]').textContent(),
      displayLanguage('en', locale.id),
    );
    assert.deepEqual(
      await controls.locator('#workflow-steps .workflow-action-label').allTextContents(),
      workflowFixture.map((step) => uiText(WORKFLOW_ACTION_LABELS[step.action], locale.id)),
      locale.id + ': translated workflow action labels',
    );
    assert.deepEqual(
      await controls.locator('#workflow-steps p [data-untranslated]').allTextContents(),
      ['Open', 'Settings', 'CTRL + A', '-120', 'Menu'],
      locale.id + ': owner targets remain data',
    );
    assert.deepEqual(
      JSON.parse(await controls.locator('#workflow-json').inputValue()),
      workflowFixture,
      locale.id + ': workflow protocol remains unchanged',
    );
    const help =
      'Choose the language of Capri’s replies. Your conversation and memory stay shared when languages change. The interface language is separate.';
    assert.equal(
      (await controls.locator('#language-panel .settings-help').first().textContent())
        .replace(/\s+/g, ' ')
        .trim(),
      uiText(help, locale.id),
    );
    assert.equal(
      await page.locator('#message').getAttribute('placeholder'),
      uiText('Talk to Capri…', locale.id),
    );
    assert.equal(
      await page.locator('#attachment-open').getAttribute('aria-label'),
      uiText('Attach files', locale.id),
    );
    assert.equal(
      (await page.locator('#computer-control-stop').textContent()).trim(),
      uiText('Stop computer control (Esc)', locale.id),
    );
    assert.equal(await page.locator('html').getAttribute('dir'), locale.direction);
    for (const [selector, key] of [
      ['#knowledge-panel h2', 'Brain and private memory'],
      ['#workflows-panel h2', 'Task training'],
      ['#user-tools-panel h2', 'User tools'],
      ['#brain-search', 'Search Brain'],
      ['#private-lock', 'Lock now'],
      ['#workflow-record', 'Start recording'],
      ['#user-tools-refresh', 'Refresh tools'],
    ])
      assert.equal(
        (await controls.locator(selector).textContent()).trim(),
        uiText(key, locale.id),
        locale.id + ': ' + selector,
      );
    assert.equal(
      await page.locator('.portrait-foot > span').last().textContent(),
      uiText('STAY A LITTLE LONGER', locale.id),
    );
    assert.deepEqual(await page.locator('.message-text').allTextContents(), expectedMessages);
    assert.equal(await page.locator('#message').inputValue(), 'Open');
    assert.equal(await page.locator('#localization-private-data').textContent(), 'Menu');
    const snapshot = await page.evaluate(() => window.capri.bootstrap());
    for (const key of ['conversation', 'recognition', 'speech', 'autoDetect'])
      assert.equal(snapshot.languages[key], initial.languages[key]);
    assert.equal(snapshot.microphone.enabled, false);
    assert.equal(snapshot.voice.language, initial.voice.language);
    const fit = await controls
      .locator('#language-panel .preferences-content')
      .evaluate((el) => ({ scrollWidth: el.scrollWidth, width: el.clientWidth }));
    assert.ok(fit.scrollWidth <= fit.width + 2, locale.id + ' has horizontal overflow');
    if (['de', 'ar', 'he', 'ja', 'hi', 'en'].includes(locale.id)) {
      await controls
        .locator('#language-panel .preferences-content')
        .evaluate((el) => (el.scrollTop = 0));
      const file = path.join(folder, 'languages-' + locale.id + '.png');
      await controls.screenshot({ path: file, animations: 'disabled' });
      report.screenshots.push(file);
      for (const section of ['knowledge', 'workflows', 'user-tools']) {
        await settingsView(application, section);
        const panelId = section === 'knowledge' ? 'knowledge' : section;
        const content = controls.locator('#' + panelId + '-panel .preferences-content');
        await content.evaluate((element) => {
          element.scrollTop = 0;
        });
        const bounds = await content.evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        assert(bounds.scrollWidth <= bounds.width + 2, locale.id + ': ' + section + ' overflow');
        const shot = path.join(folder, section + '-' + locale.id + '.png');
        await controls.screenshot({ path: shot, animations: 'disabled' });
        report.screenshots.push(shot);
      }
      await settingsView(application, 'languages');
    }
    report.checkedLocales.push(locale.id);
  }
  assert.equal(
    await controls.locator('#settings-navigation [data-section]').count(),
    SETTINGS_SECTIONS.length,
  );
  assert.equal(await page.locator('#menu').count(), 0);
  assert.deepEqual(errors, []);
  await application.close();
  application = null;
  application = await electron.launch({
    executablePath: require('electron'),
    env,
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    timeout: 60000,
  });
  page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 30000,
  });
  controls = await settingsView(application, 'languages');
  const restored = await page.evaluate(() => window.capri.bootstrap());
  assert.equal(restored.languages.interface, INTERFACE_LOCALES.at(-1).id);
  assert.equal(restored.languages.speech, 'en');
  assert.equal(restored.microphone.enabled, false);
  assert.equal(
    await controls.locator('label[for="language-interface"]').textContent(),
    uiText('Interface language', restored.languages.interface),
  );
  report.persistedOnRestart = true;
  report.passed = true;
} catch (error) {
  report.error = error.message;
  report.pageErrors = errors;
  throw error;
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(
    path.join(root, 'logs/interface-locales-verification.json'),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
