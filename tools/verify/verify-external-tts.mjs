// SPDX-License-Identifier: GPL-3.0-only
// Real Electron settings + speech transport; synthetic audio, no paid key or user history.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';
import { uiText } from '../../apps/desktop/renderer/interface-translations.mjs';
import { voiceApiErrorMessage } from '../../apps/desktop/renderer/external-tts-panel.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'external-tts-'));
const report = { passed: false, checks: [], errors: [], screenshots: [] };
const requests = [];
let failNext = false;
const server = createServer(async (request, response) => {
  if (request.url !== '/v1/audio/speech') {
    response.setHeader('content-type', 'application/json');
    response.end('{"data":[]}');
    return;
  }
  let text = '';
  for await (const chunk of request) text += chunk;
  requests.push(JSON.parse(text));
  if (failNext) {
    failNext = false;
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"Fixture rejected key"}}');
    return;
  }
  const pcm = Buffer.alloc((24000 * 2) / 10);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / 24000) * 400), i * 2);
  response.setHeader('content-type', 'application/octet-stream');
  response.end(pcm);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '1',
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
delete env.ELECTRON_RUN_AS_NODE;
let application;
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
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 30000,
  });
  const settings = await settingsView(application, 'voice-api');
  const control = (id) => settings.locator('#tts-api-' + id);
  const screenshot = async (name) => {
    await settings.waitForFunction(
      () => getComputedStyle(document.getElementById('settings-loading')).visibility === 'hidden',
    );
    await settings.screenshot({ path: path.join(folder, name + '.png') });
    report.screenshots.push(name + '.png');
  };
  const ready = async () => {
    await settings.waitForFunction(
      () => document.getElementById('external-tts-panel').getAttribute('aria-busy') !== 'true',
    );
  };
  const works = async () => {
    await control('status').filter({ hasText: 'Connection works' }).waitFor();
    await ready();
  };
  assert.equal(await control('enabled').isChecked(), false);
  assert.equal(await control('enabled').isEnabled(), false);
  assert.equal(await control('save').isEnabled(), false);
  assert.equal(await control('remove').isVisible(), false);
  assert.match(await control('key-badge').innerText(), /not saved/i);
  assert.equal(requests.length, 0);
  await screenshot('01-en-first-setup');
  report.checks.push(
    'Fresh setup explicitly selects local voice; missing key blocks tests and cloud activation.',
  );

  await control('provider').selectOption('compatible');
  assert.equal(await control('url').isVisible(), true);
  await control('url').fill(baseUrl);
  await control('model').fill('fixture-voice');
  await control('voice').fill('coral');
  assert.equal(await control('save').isEnabled(), true);
  report.checks.push(
    'Custom provider opens required fields; loopback servers accept an optional key.',
  );
  await control('key').fill('fixture-voice-key-for-secure-storage');
  await control('save').click();
  await works();
  assert.equal(await control('key').inputValue(), '');
  assert.match(await control('key').getAttribute('placeholder'), /Encrypted/);
  assert(
    !readFileSync(path.join(folder, 'data/secrets/tts-api.json'), 'utf8').includes(
      'fixture-voice-key',
    ),
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['input', 'model', 'response_format', 'voice']);
  assert.equal(requests[0].input, 'Hello! This is a voice connection test.');
  assert.equal(await control('enabled').isChecked(), false);
  assert.equal(await control('enabled').isEnabled(), true);
  report.checks.push(
    'One Save and test encrypts/clears the key and plays only a fixed sample; cloud remains opt-in.',
  );

  await control('voice').fill('alloy');
  assert.equal(await control('save').isEnabled(), true);
  assert.equal(await control('enabled').isEnabled(), false);
  await control('save').click();
  await works();
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).voice, 'alloy');
  report.checks.push(
    'Editing parameters blocks testing the old saved connection and reuses only the same-origin encrypted key.',
  );

  await control('enabled').check();
  await control('source').filter({ hasText: 'Cloud voice' }).waitFor();
  await ready();
  assert.equal(requests.length, 2);
  await settings.evaluate(() => window.capri.setVoiceEnabled(true));
  await settings.waitForFunction(async () => (await window.capri.bootstrap()).voice.ready);
  assert.equal((await settings.evaluate(() => window.capri.bootstrap())).voice.source, 'api');
  await screenshot('02-en-connected');
  report.checks.push(
    'Cloud toggle applies immediately, without another test; speaker activation uses the API path.',
  );
  await settings.evaluate(() => window.capri.setVoiceEnabled(false));
  await control('voice').fill('coral');
  await control('key').fill('fixture-unsaved-key-kept-when-turning-cloud-off');
  await control('enabled').uncheck();
  await control('source').filter({ hasText: 'Local' }).waitFor();
  await ready();
  assert.equal((await settings.evaluate(() => window.capri.bootstrap())).voice.source, 'local');
  assert.equal(requests.length, 2);
  assert.equal(await control('voice').inputValue(), 'coral');
  assert.equal(
    await control('key').inputValue(),
    'fixture-unsaved-key-kept-when-turning-cloud-off',
  );
  await control('voice').fill('alloy');
  await control('key').fill('');
  report.checks.push(
    'Turning cloud off immediately restores the local path without a network request or losing an unsaved draft.',
  );

  failNext = true;
  await control('save').click();
  await control('status').filter({ hasText: 'HTTP 401' }).waitFor();
  await ready();
  assert.equal(await control('status').getAttribute('data-tone'), 'error');
  assert(!String(await control('status').innerText()).includes('Error invoking remote method'));
  assert.equal(await control('enabled').isEnabled(), false);
  await screenshot('03-en-readable-error');
  await control('save').click();
  await works();
  assert.equal(requests.length, 4);
  report.checks.push(
    'Provider rejection appears inline without Electron wrappers; retry works with the saved key.',
  );

  for (const locale of ['ru', 'de', 'fr', 'ar', 'ja', 'en']) {
    await page.evaluate(
      async (locale) =>
        window.capri.setLanguages({
          ...(await window.capri.bootstrap()).languages,
          interface: locale,
        }),
      locale,
    );
    await settings.waitForFunction((locale) => document.documentElement.lang === locale, locale);
    assert.equal(await control('save').innerText(), uiText('Save and test', locale));
    assert.equal(await control('source').innerText(), uiText('Local', locale));
    const geometry = await settings.locator('#external-tts-panel').evaluate((panel) => ({
      scroll: panel.scrollWidth,
      width: panel.clientWidth,
      invalid: [...panel.querySelectorAll('input, select, button')]
        .filter((control) => {
          if (!control.checkVisibility()) return false;
          const rect = control.getBoundingClientRect();
          return rect.width < 10 || rect.height < 10;
        })
        .map((control) => control.id),
    }));
    assert(geometry.scroll <= geometry.width + 1, JSON.stringify({ locale, geometry }));
    assert.deepEqual(geometry.invalid, []);
    if (locale !== 'en') {
      await control('provider').scrollIntoViewIfNeeded();
      await screenshot('04-' + locale + '-setup');
      await control('enabled').scrollIntoViewIfNeeded();
      await screenshot('05-' + locale + '-actions');
    }
  }
  report.checks.push(
    'English, Russian, German, French, Arabic and Japanese show translated controls with no horizontal overflow.',
  );

  await control('provider').selectOption('elevenlabs');
  assert.equal(await control('voice').inputValue(), '');
  assert.equal(await control('key').inputValue(), '');
  assert.equal(await control('save').isEnabled(), false);
  assert.match(await control('key-badge').innerText(), /not saved/i);
  assert.equal(requests.length, 4);
  assert.match(await control('key').getAttribute('placeholder'), /Paste/);
  await control('provider').selectOption('compatible');
  await control('url').fill('not-a-url');
  await control('model').fill('fixture-voice');
  await control('voice').fill('coral');
  assert.equal(await control('save').isEnabled(), false);
  assert.match(await control('status').innerText(), /API address/);
  await control('url').fill(baseUrl);
  await control('key').fill('fixture-draft-key-retained-on-save-failure');
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('capri:voice-api-save');
    ipcMain.handle('capri:voice-api-save', () => {
      throw new Error('Fixture encrypted save failed.');
    });
  });
  await control('save').click();
  await control('status').filter({ hasText: 'Fixture encrypted save failed.' }).waitFor();
  await ready();
  assert.equal(await control('key').inputValue(), 'fixture-draft-key-retained-on-save-failure');
  assert.equal(requests.length, 4);
  report.checks.push(
    'Changing provider never reuses another origin’s key; invalid URL is explained; failed save retains draft and makes no test request.',
  );
  assert.equal(
    voiceApiErrorMessage(
      new Error(
        "Error invoking remote method 'capri:voice-api-test': Error: Voice API rejected the key (HTTP 401).",
      ),
    ),
    'Voice API rejected the key (HTTP 401).',
  );
  await control('remove').click();
  await control('status').filter({ hasText: 'removed' }).waitFor();
  assert.equal(await control('remove').isVisible(), false);
  assert.equal(await control('save').isEnabled(), false);
  await page.evaluate(async () =>
    window.capri.setLanguages({
      ...(await window.capri.bootstrap()).languages,
      interface: 'ru',
    }),
  );
  await settings.waitForFunction(() => document.documentElement.lang === 'ru');
  await settingsView(application, 'general');
  await settingsView(application, 'voice-api');
  await control('status')
    .filter({ hasText: uiText('Enter an API key to continue.', 'ru') })
    .waitFor();
  await settings.locator('#external-tts-panel > h2').scrollIntoViewIfNeeded();
  await screenshot('06-ru-first-setup');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ ...report, folder }));
