// SPDX-License-Identifier: GPL-3.0-only
// Runs the real Settings renderer/preload with isolated, deterministic IPC fixtures.
// No network model requests, downloads, credentials or training are performed.
import { saveSettings } from './settings-view.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/index.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'huggingface-'));
const require = createRequire(import.meta.url);
const report = { folder, checks: [], errors: [] };
const record = (name) => {
  report.checks.push(name);
  console.log('PASS ' + name);
};
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
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
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const errors = (page) => page.on('pageerror', (error) => report.errors.push(error.message));
  application.on('window', errors);
  const page = await application.firstWindow();
  errors(page);
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  await application.evaluate(
    ({ ipcMain, BrowserWindow }, catalog) => {
      const hub = {
        phase: 'idle',
        results: [],
        repository: null,
        plan: null,
        installed: [],
        credentials: { hasToken: false },
        error: null,
        progress: null,
      };
      const voices = {
        phase: 'idle',
        selections: {},
        models: catalog.models.map((model) => ({ ...model, installed: false })),
        defaults: { en: 'chatterbox-turbo', multilingual: 'chatterbox-multilingual-v3' },
      };
      const training = {
        phase: 'idle',
        available: false,
        reason: 'Training requires reviewed Capri recordings and a compatible GPU.',
      };
      const calls = [];
      const emit = (type, value) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('capri:event', { type, ...value });
      };
      const register = (name, work) => {
        const channel = 'capri:' + name;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, input) => work(input));
      };
      register('huggingface-status', () => hub);
      register('huggingface-search', (selection) => {
        calls.push({ action: 'search', selection });
        hub.phase = 'idle';
        hub.plan = null;
        hub.repository = null;
        hub.results = [
          {
            repository:
              selection.task === 'tts'
                ? 'fixture/unsupported-voice'
                : 'fixture/long-model-name-quantized-gguf',
            task: selection.task,
          },
        ];
        return hub;
      });
      register('huggingface-inspect', (repository) => {
        calls.push({ action: 'inspect', repository });
        hub.phase = 'idle';
        hub.plan = null;
        hub.repository = {
          repository,
          revision: 'a'.repeat(40),
          license: 'apache-2.0',
          files: repository.includes('voice')
            ? []
            : [
                { path: 'model-q4_k_m.gguf', kind: 'gguf', bytes: 2e9, sha256: 'b'.repeat(64) },
                { path: 'model-q8_0.gguf', kind: 'gguf', bytes: 4e9, sha256: 'c'.repeat(64) },
                {
                  path: 'vision-projector.gguf',
                  kind: 'projector',
                  bytes: 2e8,
                  sha256: 'd'.repeat(64),
                },
              ],
          compatibility: repository.includes('voice')
            ? { supported: false, reason: 'A reviewed runtime adapter is required.' }
            : undefined,
        };
        return hub;
      });
      register('huggingface-plan', (selection) => {
        calls.push({ action: 'plan', selection });
        hub.plan = {
          repository: selection.repository,
          revision: selection.revision,
          files: hub.repository.files.filter((file) =>
            [selection.filename, selection.projector].includes(file.path),
          ),
          downloadBytes: 2e9,
          requiredBytes: 4.1e9,
          estimatedCpuRamGiB: 4,
          estimatedVramGiB: 3,
        };
        return hub;
      });
      register('huggingface-install', () => {
        calls.push({ action: 'install' });
        hub.phase = 'downloading';
        hub.progress = { completed: 5e8, total: 2e9 };
        return hub;
      });
      register('huggingface-cancel', () => {
        calls.push({ action: 'cancel' });
        hub.phase = 'idle';
        hub.progress = null;
        return hub;
      });
      register('huggingface-token-save', (token) => {
        // Deliberately retain neither the synthetic token nor its contents in the report.
        calls.push({
          action: 'token-save',
          received: typeof token === 'string' && token.length > 0,
        });
        hub.credentials.hasToken = true;
        return hub;
      });
      register('huggingface-token-remove', () => {
        hub.credentials.hasToken = false;
        return hub;
      });
      register('voice-catalog', () => voices);
      register('voice-training-status', () => training);
      register('voice-training-import', () => {
        training.available = true;
        training.reason = 'Reviewed synthetic fixture recordings ready.';
        return training;
      });
      register('voice-training-start', (selection) => {
        calls.push({ action: 'training-start', selection });
        training.phase = 'training';
        training.stage = 'Training Capri voice…';
        return training;
      });
      register('voice-training-cancel', () => {
        training.phase = 'idle';
        return training;
      });
      globalThis.hfVerifier = { hub, voices, training, calls, emit };
    },
    JSON.parse(readFileSync(path.join(root, 'config/tts-catalog.json'), 'utf8')),
  );
  await page.evaluate(() => window.capri.openSettings('models'));
  let settings;
  for (let i = 0; i < 100 && !settings; i++) {
    settings = application.windows().find((view) => view.url().endsWith('/settings.html'));
    if (!settings) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(settings, 'Settings window should open');
  await settings.waitForSelector('#hf-query');
  const navigate = async (section) => {
    await settings.locator(`[data-section="${section}"]`).click();
    await settings.waitForFunction(
      (id) =>
        document.querySelector(`[data-section="${id}"]`).getAttribute('aria-current') === 'page',
      section,
    );
  };
  await navigate('models');
  assert.equal(await settings.locator('#models-panel #voice-model-language').count(), 1);
  assert.equal(await settings.locator('#language-panel #voice-model-language').count(), 0);
  assert.equal(await settings.locator('#hf-query').getAttribute('type'), 'text');
  assert.equal(await settings.locator('#hf-details').isHidden(), true);
  assert.equal(await settings.locator('#hf-install').isDisabled(), true);
  await settings.locator('#hf-query').fill('fixture');
  await settings.locator('#hf-search').click();
  await settings.locator('#hf-results button').waitFor();
  await settings.locator('#hf-results button').click();
  await settings.locator('#hf-details').waitFor();
  assert.equal(await settings.locator('#hf-file option').count(), 2);
  assert.equal(await settings.locator('#hf-projector option').count(), 2);
  assert.equal(await settings.locator('#hf-install').isDisabled(), true);
  await settings.locator('#hf-plan').click();
  await settings.waitForFunction(() => !document.getElementById('hf-install').disabled);
  assert.match(await settings.locator('#hf-size').textContent(), /2\.00 GB.*4\.10 GB/);
  await settings.locator('#hf-projector').selectOption('vision-projector.gguf');
  assert.equal(await settings.locator('#hf-install').isDisabled(), true);
  await settings.locator('#hf-plan').click();
  await settings.waitForFunction(() => !document.getElementById('hf-install').disabled);
  await settings.locator('#hf-file').selectOption('model-q8_0.gguf');
  assert.equal(await settings.locator('#hf-install').isDisabled(), true);
  await settings.locator('#hf-plan').click();
  await settings.locator('#hf-install').click();
  await settings.locator('#hf-cancel').waitFor();
  assert.equal(await settings.locator('#hf-progress').getAttribute('value'), '25');
  for (const id of ['hf-file', 'hf-projector', 'hf-search', 'hf-install'])
    assert.equal(await settings.locator('#' + id).isDisabled(), true);
  await settings.locator('#hf-cancel').click();
  await settings.locator('#hf-cancel').waitFor({ state: 'hidden' });
  record(
    'Real renderer and preload handle search, inspect, file/projector replanning, progress and cancellation',
  );

  await settings.locator('#hf-token').evaluate((input) => (input.closest('details').open = true));
  assert.equal(await settings.locator('#hf-token').getAttribute('type'), 'password');
  await settings.locator('#hf-token').fill('synthetic-ui-only-not-a-token');
  await settings.locator('#hf-save-token').click();
  assert.equal(await settings.locator('#hf-token').inputValue(), '');
  assert.equal(
    (await settings.locator('body').innerText()).includes('synthetic-ui-only-not-a-token'),
    false,
  );
  assert.equal(
    await application.evaluate(
      () => globalThis.hfVerifier.calls.find((call) => call.action === 'token-save')?.received,
    ),
    true,
  );
  await settings.locator('#hf-remove-token').click();
  await settings.locator('#hf-token').evaluate((input) => (input.closest('details').open = false));
  record(
    'Token input is password-masked and clears before IPC; token content never enters visible text',
  );

  const capture = async (language, width) => {
    await application.evaluate(({ BrowserWindow }, width) => {
      const window = BrowserWindow.getAllWindows().find((view) =>
        view.webContents.getURL().endsWith('/settings.html'),
      );
      window.setMinimumSize(400, 400);
      window.setResizable(true);
      window.setContentSize(width, 800);
    }, width);
    await settings.waitForFunction((width) => innerWidth === width, width);
    for (const [section, cardId, captureName] of [
      ['models', 'hf-query', 'models'],
      ['models', 'voice-model-language', 'voice-models'],
    ]) {
      await navigate(section);
      const card = settings.locator('#' + cardId).locator('..');
      await card.scrollIntoViewIfNeeded();
      const fit = await card.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        viewport: innerWidth,
      }));
      assert(
        fit.scrollWidth <= fit.width + 2,
        `${language}/${width}/${section} horizontal overflow: ${JSON.stringify(fit)}`,
      );
      assert(
        fit.left >= -1 && fit.right <= fit.viewport + 1,
        `${language}/${width}/${section} does not fit viewport`,
      );
      await card.screenshot({ path: path.join(folder, `${captureName}-${language}-${width}.png`) });
      await settings.screenshot({
        path: path.join(folder, `${captureName}-${language}-${width}-window.png`),
      });
    }
  };
  for (const language of ['en', 'ru']) {
    await navigate('languages');
    await settings.locator('#language-interface').selectOption(language);
    await settings.locator('#language-speech').selectOption('off');
    await saveSettings(settings);
    await settings.waitForFunction(
      (language) => document.documentElement.lang === language,
      language,
    );
    for (const width of [880, 560]) await capture(language, width);
  }
  record('Actual English and Russian language-model and voice panels fit at 880 and 560 pixels');

  await navigate('models');
  await settings.locator('#hf-task').selectOption('tts');
  await settings.locator('#hf-search').click();
  await settings.locator('#hf-results button').click();
  await settings.waitForFunction(() => document.getElementById('hf-file').options.length === 0);
  assert.equal(await settings.locator('#hf-plan').isDisabled(), true);
  assert.equal(await settings.locator('#hf-install').isDisabled(), true);
  assert.match(
    await settings.locator('#hf-compatibility').innerText(),
    /compatible runtime|совместим/i,
  );
  await settings
    .locator('#hf-query')
    .locator('..')
    .screenshot({ path: path.join(folder, 'unsupported-tts-ru-560.png') });
  record('Unknown TTS repository displays its runtime limitation and cannot be installed as GGUF');

  await navigate('models');
  await settings.locator('#voice-model-language').selectOption('en');
  await settings.locator('#voice-model-choice').selectOption('chatterbox-turbo');
  assert.equal(await settings.locator('#voice-model-train').isDisabled(), true);
  assert.equal(await settings.locator('#voice-model-status').innerText(), '');
  assert.equal(await settings.locator('#voice-model-select').isDisabled(), true);
  assert.equal(await settings.locator('#voice-model-preview').isHidden(), true);
  assert.equal(await settings.locator('#voice-model-apply').isHidden(), true);
  await settings.locator('#voice-model-import').click();
  await settings.waitForFunction(() => !document.getElementById('voice-model-train').disabled);
  await settings.locator('#voice-model-train').click();
  await settings.locator('#voice-model-cancel').waitFor();
  assert.equal(await settings.locator('#voice-model-choice').isDisabled(), true);
  assert.equal(await settings.locator('#voice-model-import').isDisabled(), true);
  assert.equal(await settings.locator('#voice-model-train').isDisabled(), true);
  await settings.locator('#voice-model-cancel').click();
  await settings.locator('#voice-model-cancel').waitFor({ state: 'hidden' });
  await settings.locator('#voice-model-language').selectOption('ru');
  assert.equal(await settings.locator('#voice-model-train').isDisabled(), true);
  assert.equal(
    await settings.locator('#voice-model-choice option[value="chatterbox-turbo"]').count(),
    0,
  );
  assert.equal(
    await settings.locator('#voice-model-choice option[value="qwen3-tts-0.6b-base"]').count(),
    1,
  );
  await settings.locator('#voice-model-choice').selectOption('qwen3-tts-0.6b-base');
  assert.equal(await settings.locator('#voice-model-train').isDisabled(), true);
  assert.match(await settings.locator('#voice-model-details').innerText(), /Qwen\/Qwen3-TTS/);
  record(
    'Voice languages filter compatible models; training and apply stay unavailable without compatible reviewed results',
  );

  // Reproduce issue 75 without opening audio devices or installing any runtime.
  await navigate('languages');
  await settings.locator('#language-interface').selectOption('fr');
  await settings.locator('#language-speech').selectOption('off');
  await saveSettings(settings);
  await settings.waitForFunction(() => document.documentElement.lang === 'fr');
  await navigate('models');
  await application.evaluate(({ ipcMain }) => {
    const { voices, calls, emit } = globalThis.hfVerifier;
    Object.assign(voices, {
      phase: 'error',
      installingModelId: 'qwen3-tts-0.6b-base',
      installingLanguage: 'fr',
      error: 'Qwen fixture failure',
      progress: 0,
    });
    ipcMain.removeHandler('capri:speech-install');
    ipcMain.handle('capri:speech-install', (_event, selection) => {
      calls.push({ action: 'speech-install', selection });
      return {
        phase: 'error',
        failedStage: 'checking',
        selection,
        progress: null,
        errorCode: 'CAPRI_VOICE_GPU_UNSUPPORTED',
        error:
          'Voice needs NVIDIA CUDA or a supported AMD ROCm GPU on Windows 11 (experimental). This PC can still use text replies and microphone recognition. Integrated graphics and Intel voice acceleration are not supported.',
      };
    });
    emit('voice-catalog.status', voices);
  });
  await settings.locator('#voice-model-language').selectOption('fr');
  await settings.locator('#voice-model-choice').selectOption('chatterbox-multilingual-v3');
  assert.equal(await settings.locator('#voice-model-install-status').innerText(), '');
  await settings.locator('#voice-model-install').click();
  await settings.waitForFunction(
    () => !document.getElementById('voice-model-cpu-alternative').hidden,
  );
  const failure = await settings.locator('#voice-model-install-status').innerText();
  assert.match(failure, /NVIDIA CUDA.*ROCm/);
  assert.doesNotMatch(failure, /Qwen fixture|0%|NaN|free disk space/);
  assert.match(
    await settings.locator('#voice-model-cpu-alternative').innerText(),
    /Modèle vocal.*Qwen3-TTS/,
  );
  await settings.locator('#voice-model-choice').selectOption('qwen3-tts-0.6b-base');
  assert.equal(
    await settings.locator('#voice-model-install-status').innerText(),
    'Qwen fixture failure',
  );
  await settings.locator('#voice-model-choice').selectOption('chatterbox-multilingual-v3');
  assert.equal(await settings.locator('#voice-model-install-status').innerText(), failure);
  await settings.locator('#voice-model-language').selectOption('de');
  assert.equal(await settings.locator('#voice-model-install-status').innerText(), '');
  await settings.locator('#voice-model-language').selectOption('fr');
  await settings.locator('#voice-model-choice').selectOption('chatterbox-multilingual-v3');
  await settings.locator('#voice-model-cpu-alternative').scrollIntoViewIfNeeded();
  await settings
    .locator('#voice-model-language')
    .locator('..')
    .screenshot({
      path: path.join(folder, 'french-voice-gpu-limitation.png'),
    });
  await settings.locator('#voice-model-cpu-alternative').click();
  assert.equal(await settings.locator('#voice-model-choice').inputValue(), 'qwen3-tts-0.6b-base');
  const installs = await application.evaluate(() =>
    globalThis.hfVerifier.calls.filter((call) => call.action === 'speech-install'),
  );
  assert.deepEqual(installs, [
    { action: 'speech-install', selection: { speech: 'fr', recognition: 'off' } },
  ]);
  assert.equal(await settings.locator('#voice-model-install').isEnabled(), true);
  record(
    'French voice installation preserves its real GPU limitation, ignores stale Qwen errors and offers explicit CPU model selection without automatic downloads',
  );

  assert.deepEqual(report.errors, []);
  record('No renderer exceptions in either locale');
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  console.log('Report: ' + path.join(folder, 'report.json'));
}
