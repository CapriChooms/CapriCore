// SPDX-License-Identifier: GPL-3.0-only
// Real Electron UI with explicit synthetic IPC fixtures; never opens OAuth or uses an account.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'desktop-ai-'));
const report = { passed: false, errors: [], checks: [] };
const catalog = {
  models: [
    { slug: 'fixture-model', display_name: 'Fixture model', visibility: 'list' },
    { slug: 'fixture-other', display_name: 'Other model', visibility: 'list' },
    ...Array.from({ length: 128 }, (_, i) => ({
      slug: 'catalog-model-' + i,
      display_name: 'Catalog model ' + i,
      visibility: 'list',
      metadata: { description: 'synthetic catalog metadata '.repeat(300) },
    })),
  ],
};
const server = createServer((request, response) => {
  if (request.url === '/qa-chatgpt-responses') {
    request.resume();
    return response.end(
      Buffer.from(
        [
          { type: 'response.output_text.delta', delta: 'Ready.' },
          {
            type: 'response.completed',
            response: {
              status: 'completed',
              output: [{ type: 'message', content: [{ type: 'output_text', text: 'Ready.' }] }],
            },
          },
        ]
          .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
          .join(''),
      ),
    );
  }
  response.setHeader('content-type', 'application/json');
  if (request.url === '/qa-chatgpt-models') return response.end(JSON.stringify(catalog));
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
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (page) =>
    page.on('pageerror', (error) => report.errors.push(error.message)),
  );
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(
    async ({ ipcMain, session }, { authModule, completionModule, catalogUrl, responseUrl }) => {
      const load = process.getBuiltinModule('module').createRequire(authModule);
      const { ChatGPTPlanAuth } = load(authModule);
      const { chatGPTCompletion } = load(completionModule);
      const accountId = '11111111-1111-4111-8111-111111111111';
      const secondId = '33333333-3333-4333-8333-333333333333';
      const profileId = '22222222-2222-4222-8222-222222222222';
      let connected = false;
      let selectedId = accountId;
      globalThis.qaModels = { hold: true, fail: false, empty: false, pending: [] };
      globalThis.qaUseConnections = [];
      const account = () => ({
        selectedId: connected ? selectedId : null,
        profiles: connected
          ? [accountId, secondId].map((id, i) => ({
              id,
              label: 'Connection ' + (i + 1),
              connected: true,
              sharing: true,
            }))
          : [],
        loadError: false,
      });
      globalThis.qaAiActions = [];
      for (const name of ['capri:chatgpt-plan', 'capri:desktop-ai-scan'])
        ipcMain.removeHandler(name);
      ipcMain.removeHandler('capri:inference-api-use');
      ipcMain.handle('capri:inference-api-use', async (_event, id) => {
        globalThis.qaUseConnections.push(id);
      });
      ipcMain.handle('capri:desktop-ai-scan', async () => ({
        apps: [
          { id: 'chatgpt', name: 'ChatGPT', installed: true, connection: 'chatgpt' },
          { id: 'claude-code', name: 'Claude Code', installed: true, kind: 'cli' },
        ],
        servers: [
          {
            id: 'lmstudio',
            name: 'LM Studio',
            state: 'ready',
            baseUrl: 'http://127.0.0.1:1234/v1',
            models: ['fixture-local-model'],
          },
        ],
      }));
      ipcMain.handle('capri:chatgpt-plan', async (_event, value) => {
        globalThis.qaAiActions.push(value.action);
        if (value.action === 'status') return account();
        if (value.action === 'sign-in') {
          connected = true;
          return account();
        }
        if (value.action === 'select-account') {
          selectedId = value.accountId;
          return account();
        }
        if (value.action === 'models') {
          const state = globalThis.qaModels;
          if (state.hold) await new Promise((resolve) => state.pending.push(resolve));
          if (state.fail)
            throw new Error('ChatGPT could not connect. Check your network and try again.');
          if (state.empty) return [];
          if (value.accountId !== accountId)
            return [{ id: 'second-model', name: 'Second account model' }];
          // Exercise production catalog transport/parsing with Chromium's actual
          // fetch stream. The bearer and loopback response are synthetic only.
          return ChatGPTPlanAuth.prototype.models.call(
            {
              accessToken: async () => 'public-fixture-catalog-bearer',
              fetchImpl: (_url, options) =>
                session
                  .fromPartition('qa-chatgpt-catalog', { cache: false })
                  .fetch(catalogUrl, options),
            },
            accountId,
          );
        }
        if (value.action === 'test') {
          const started = Date.now();
          const auth = {
            controllers: new Map(),
            fetchImpl: async (url, options) => {
              if (url !== 'https://api.openai.com/v1/responses')
                throw new Error('Unexpected Responses destination');
              const response = await session
                .fromPartition('qa-chatgpt-response', { cache: false })
                .fetch(responseUrl, options);
              globalThis.qaHeaderlessResponse = response.headers.get('content-type') === null;
              return response;
            },
          };
          const response = await chatGPTCompletion(
            auth,
            {
              model: value.model,
              messages: [{ role: 'user', content: 'Reply with exactly: Ready.' }],
              stream: false,
              max_tokens: 1024,
            },
            AbortSignal.timeout(5000),
            'public-fixture-response-bearer',
          );
          const result = await response.json();
          if (result.choices?.[0]?.message?.content !== 'Ready.')
            throw new Error('Unexpected connection-test sample');
          return { elapsedMs: Date.now() - started };
        }
        if (value.action === 'add-connection')
          return {
            activeId: null,
            secureStorage: true,
            localModel: 'fixture-local',
            profiles: [
              {
                id: profileId,
                name: 'ChatGPT plan',
                enabled: true,
                baseUrl: 'https://api.openai.com/v1',
                model: 'fixture-model',
                authMode: 'chatgpt',
                accountId,
                hasKey: false,
                canConnect: true,
                contextTokens: 32768,
                tools: true,
                vision: false,
              },
            ],
          };
        throw new Error('Unexpected fixture action');
      });
    },
    {
      authModule: path.join(root, 'apps/desktop/chatgpt-plan-auth.mjs'),
      completionModule: path.join(root, 'apps/desktop/chatgpt-plan-completions.mjs'),
      catalogUrl: `http://127.0.0.1:${server.address().port}/qa-chatgpt-models`,
      responseUrl: `http://127.0.0.1:${server.address().port}/qa-chatgpt-responses`,
    },
  );
  const settings = await settingsView(application, 'api');
  assert.equal(await settings.locator('#desktop-ai-details').evaluate((node) => node.open), false);
  assert.equal(await settings.locator('#api-add').isVisible(), true);
  assert.equal(await settings.locator('#chatgpt-plan-connect').isVisible(), true);
  report.checks.push('Existing API controls remain visible; optional discovery starts collapsed.');
  await settings.locator('#desktop-ai-details > summary').click();
  await settings.locator('#desktop-ai-status').filter({ hasText: 'Detection finished' }).waitFor();
  assert.match(await settings.locator('#desktop-ai-installed').textContent(), /ChatGPT/);
  assert.match(await settings.locator('#desktop-ai-servers').textContent(), /LM Studio/);
  report.checks.push(
    'Detected apps and local model choices render without paths or account tokens.',
  );
  await settings.locator('#chatgpt-plan-connect').click();
  await settings.locator('#chatgpt-plan-model[aria-busy="true"]').waitFor();
  assert.equal(await settings.locator('#chatgpt-plan-cancel').isVisible(), false);
  assert.equal(await settings.locator('#chatgpt-plan-account').isEnabled(), true);
  assert.equal(await settings.locator('#chatgpt-plan-save').isDisabled(), true);
  assert.deepEqual(await application.evaluate(() => globalThis.qaUseConnections), []);
  await application.evaluate(() => {
    globalThis.qaModels.hold = false;
    globalThis.qaModels.pending.splice(0).forEach((resolve) => resolve());
  });
  await settings.waitForFunction(() => !document.getElementById('chatgpt-plan-model').disabled);
  assert.equal(await settings.locator('#chatgpt-plan-model').inputValue(), 'fixture-model');
  assert.equal(await settings.locator('#chatgpt-plan-model option').count(), 130);
  report.checks.push(
    'A rich catalog above 512 KiB passes the actual Chromium stream/parser and all 130 visible model choices reach the picker.',
  );
  await settings.locator('#chatgpt-plan-test').click();
  await settings.locator('#chatgpt-plan-status').filter({ hasText: 'Connection works' }).waitFor();
  assert.equal(await application.evaluate(() => globalThis.qaHeaderlessResponse), true);
  report.checks.push(
    'Test connection succeeds through the production Responses adapter and an actual Chromium SSE stream without Content-Type.',
  );
  await settings.locator('#chatgpt-plan-save').click();
  await settings.locator('#chatgpt-plan-status').filter({ hasText: 'Connection saved' }).waitFor();
  assert.match(await settings.locator('#api-connections').textContent(), /ChatGPT plan/);
  assert.deepEqual(await application.evaluate(() => globalThis.qaUseConnections), [
    '22222222-2222-4222-8222-222222222222',
  ]);
  report.checks.push(
    'Official sign-in, account models, test and saved-connection controls are wired through narrow IPC.',
  );
  await settings
    .locator('#api-connections button')
    .filter({ hasText: /^Edit$/ })
    .click();
  for (const id of ['provider', 'url', 'key'])
    assert.equal(await settings.locator('#api-' + id).isDisabled(), true);
  for (const id of ['model', 'context', 'tools', 'vision'])
    assert.equal(await settings.locator('#api-' + id).isEnabled(), true);
  assert.equal(await settings.locator('#api-key').inputValue(), '');
  assert.equal(
    await settings.locator('#api-key').getAttribute('placeholder'),
    'Using ChatGPT plan',
  );
  await settings.locator('#api-vision').check();
  assert.equal(await settings.locator('#api-save').isEnabled(), true);
  report.checks.push(
    'Saved plan models and vision remain editable without accepting or exposing an API key.',
  );
  await settings.locator('#api-cancel').click();
  await application.evaluate(() => {
    globalThis.qaModels.fail = true;
  });
  await settings.locator('#chatgpt-plan-models').click();
  await settings.locator('#chatgpt-plan-status').filter({ hasText: 'could not connect' }).waitFor();
  assert.equal(await settings.locator('#chatgpt-plan-models').isEnabled(), true);
  await application.evaluate(() => {
    globalThis.qaModels.fail = false;
    globalThis.qaModels.empty = true;
  });
  await settings.locator('#chatgpt-plan-models').click();
  await settings
    .locator('#chatgpt-plan-status')
    .filter({ hasText: 'No models are available' })
    .waitFor();
  assert.equal(await settings.locator('#chatgpt-plan-save').isDisabled(), true);
  await application.evaluate(() => {
    globalThis.qaModels.empty = false;
  });
  await settings.locator('#chatgpt-plan-models').click();
  await settings.waitForFunction(() => !document.getElementById('chatgpt-plan-model').disabled);
  await settings.locator('#chatgpt-plan-model').selectOption('fixture-other');
  await settings.locator('#chatgpt-plan-models').click();
  await settings.waitForFunction(() => !document.getElementById('chatgpt-plan-model').disabled);
  assert.equal(await settings.locator('#chatgpt-plan-model').inputValue(), 'fixture-other');
  report.checks.push(
    'Model loading, empty results and failed discovery have visible states and a working retry; selection survives refresh.',
  );
  await application.evaluate(() => {
    globalThis.qaModels.hold = true;
  });
  await settings.locator('#chatgpt-plan-models').click();
  await settings.locator('#chatgpt-plan-model[aria-busy="true"]').waitFor();
  await application.evaluate(() => {
    globalThis.qaModels.hold = false;
  });
  await settings
    .locator('#chatgpt-plan-account')
    .selectOption('33333333-3333-4333-8333-333333333333');
  await settings.waitForFunction(
    () => document.getElementById('chatgpt-plan-model').value === 'second-model',
  );
  await application.evaluate(() =>
    globalThis.qaModels.pending.splice(0).forEach((resolve) => resolve()),
  );
  await settings.waitForFunction(
    () => document.getElementById('chatgpt-plan-model').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await settings.locator('#chatgpt-plan-model').inputValue(), 'second-model');
  await settings
    .locator('#chatgpt-plan-account')
    .selectOption('11111111-1111-4111-8111-111111111111');
  await settings.waitForFunction(
    () => document.getElementById('chatgpt-plan-model').value === 'fixture-other',
  );
  report.checks.push(
    'Account switching refreshes account-specific models automatically and ignores a late response from the previous account.',
  );
  await settings.reload();
  await settingsView(application, 'api');
  await settings.waitForFunction(() => !document.getElementById('chatgpt-plan-model').disabled);
  assert.equal(await settings.locator('#chatgpt-plan-model').inputValue(), 'fixture-model');
  assert.equal(await settings.locator('#chatgpt-plan-cancel').isVisible(), false);
  assert.equal(await settings.locator('#desktop-ai-details').evaluate((node) => node.open), false);
  report.checks.push(
    'Reopening a fresh Settings renderer with a saved account automatically restores selectable models without discovery or sign-in.',
  );
  await settings.locator('#chatgpt-plan-card').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: path.join(folder, 'chatgpt-plan.png') });
  await settings.locator('#desktop-ai-details > summary').scrollIntoViewIfNeeded();
  await settings.screenshot({ path: path.join(folder, 'detected-ai.png') });
  assert.equal(
    await settings
      .locator('#inference-panel')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    true,
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    await application.evaluate(() =>
      globalThis.qaAiActions.filter((action) => action !== 'status'),
    ),
    [
      'sign-in',
      'models',
      'test',
      'add-connection',
      'models',
      'models',
      'models',
      'models',
      'models',
      'select-account',
      'models',
      'select-account',
      'models',
      'models',
    ],
  );
  report.passed = true;
} finally {
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ ...report, folder }));
