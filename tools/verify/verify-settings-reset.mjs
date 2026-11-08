// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root as workspaceRoot } from '../../packages/runtime/src/index.mjs';
import { COMPANION_DEFAULTS } from '../../apps/desktop/companion-settings.mjs';
import { DIMMING_DEFAULTS } from '../../apps/desktop/renderer/dimming-settings.mjs';
import { settingsView } from './settings-view.mjs';

const root = path.resolve(process.argv[2] ?? workspaceRoot);
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'settings-reset-'));
const state = path.join(folder, 'desktop');
mkdirSync(state);
const stateFile = (name) => path.join(state, name);
const readState = (name) => JSON.parse(readFileSync(stateFile(name), 'utf8'));
const writeState = (name, data) => writeFileSync(stateFile(name), JSON.stringify(data));
const transcript = {
  schemaVersion: 1,
  messages: [
    {
      id: 'reset-test-message',
      turnId: 'reset-test-turn',
      role: 'user',
      text: 'Isolated reset fixture',
      createdAt: '2025-01-01T00:00:00.000Z',
      status: 'complete',
    },
    {
      id: 'reset-test-answer',
      turnId: 'reset-test-turn',
      role: 'assistant',
      text: 'This answer stays visible after resetting settings.',
      createdAt: '2025-01-01T00:00:01.000Z',
      status: 'complete',
    },
  ],
};
writeState('companion.json', {
  schemaVersion: 1,
  settings: { ...COMPANION_DEFAULTS, memoryStyle: 'bars', replyAutoHide: false },
});
writeState('dimming.json', { schemaVersion: 1, ...DIMMING_DEFAULTS, level: 65 });
writeState('transcript.json', transcript);
writeFileSync(stateFile('wake-audio'), 'Custom wake audio fixture');

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
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
  TEMP: folder,
  TMP: folder,
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
  const companion = await application.firstWindow();
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const snapshot = () => companion.evaluate(() => window.capri.bootstrap());
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((view) => view.webContents.getURL().endsWith('/index.html'))
      .showInactive(),
  );
  if ((await companion.locator('#presence-toggle').getAttribute('aria-pressed')) !== 'true')
    await companion.locator('#presence-toggle').click();
  await companion.waitForFunction(() => document.body.dataset.presence === 'portrait');
  assert.equal(
    await companion.locator('#subtitle-text').textContent(),
    transcript.messages[1].text,
  );
  const before = await snapshot();
  assert.equal(before.dimming.level, 65);
  assert.equal(before.companion.memoryStyle, 'bars');
  assert.deepEqual(before.messages, transcript.messages);
  await assert.rejects(
    companion.evaluate(() => window.capri.resetSettings()),
    /Settings frame required/i,
  );

  const settings = await settingsView(application, 'window');
  const dimming = settings.locator('#dimming-level');
  await dimming.fill('54');
  await settingsView(application, 'languages');
  const interfaceLanguage = settings.locator('#language-interface');
  await interfaceLanguage.selectOption('de');
  await settingsView(application, 'general');
  const reset = settings.locator('#general-reset-settings');
  const dialog = settings.locator('#confirmation-dialog[open]');
  const confirm = dialog.locator('button[data-choice="confirm"]');
  await settings.evaluate(() => {
    window.capri.onEvent((event) => {
      if (event.type === 'confirmation.request') window.resetConfirmation = event;
    });
  });
  await reset.click();
  await dialog.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  const rejectedEarly = await settings.evaluate(async () => {
    const { id, delayMs } = window.resetConfirmation;
    const accepted = await window.capri.confirmAction({ id, choice: 'confirm' });
    return { accepted, delayMs };
  });
  assert.deepEqual(rejectedEarly, { accepted: false, delayMs: 3000 });
  await dialog.locator('button[data-choice="cancel"]').click();
  await settings.waitForFunction(() => !document.getElementById('settings-forms').inert);
  await settingsView(application, 'window');
  assert.equal(await dimming.inputValue(), '54', 'Cancel must preserve the in-progress draft');
  assert.equal((await snapshot()).dimming.level, 65);
  assert.equal(readState('dimming.json').level, 65);
  assert.equal(readState('companion.json').settings.memoryStyle, 'bars');

  await settingsView(application, 'general');
  const start = performance.now();
  await reset.click();
  await dialog.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  await settings.waitForFunction(
    () =>
      document.querySelector('#confirmation-dialog[open] [data-choice="confirm"]')?.disabled ===
      false,
    null,
    { timeout: 8000 },
  );
  assert.ok(performance.now() - start >= 3000, 'Confirm must wait the full three seconds');
  await confirm.click();
  await settings.waitForFunction(() => !document.getElementById('settings-forms').inert);
  await companion.waitForTimeout(400);
  const presentation = await companion.evaluate(() => ({
    presence: document.body.dataset.presence,
    replyHidden: document.body.dataset.replyHidden,
    text: document.getElementById('subtitle-text').textContent,
    display: getComputedStyle(document.getElementById('subtitle-stage')).display,
  }));
  assert.equal(presentation.presence, 'portrait', JSON.stringify(presentation));
  assert.notEqual(presentation.display, 'none', JSON.stringify(presentation));
  assert.notEqual(presentation.replyHidden, 'true');
  assert.equal(presentation.text, transcript.messages[1].text);
  // Enabling the factory auto-hide preference must not dismiss this old reply.
  await companion.waitForTimeout(8500);
  assert.notEqual(await companion.locator('body').getAttribute('data-reply-hidden'), 'true');
  assert.equal(
    await companion.locator('#subtitle-text').textContent(),
    transcript.messages[1].text,
  );
  await settingsView(application, 'window');
  assert.equal(await dimming.inputValue(), String(DIMMING_DEFAULTS.level));
  await settingsView(application, 'languages');
  assert.equal(await interfaceLanguage.inputValue(), 'de', 'Unrelated drafts must survive reset');
  const after = await snapshot();
  assert.deepEqual(after.dimming, DIMMING_DEFAULTS);
  assert.equal(after.companion.memoryStyle, 'rings');
  assert.deepEqual(after.languages, before.languages);
  assert.deepEqual(readState('dimming.json'), { schemaVersion: 1, ...DIMMING_DEFAULTS });
  assert.deepEqual(readState('companion.json').settings, COMPANION_DEFAULTS);
  assert.deepEqual(after.messages, transcript.messages);
  assert.deepEqual(readState('transcript.json'), transcript);
  assert.equal(readFileSync(stateFile('wake-audio'), 'utf8'), 'Custom wake audio fixture');
  console.log(
    'PASS Settings reset guards the timer, preserves a cancelled draft and saves defaults without clearing personal data',
  );
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
}
