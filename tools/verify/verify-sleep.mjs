// SPDX-License-Identifier: GPL-3.0-only
/** Model-free Electron regression: one local fixture, no microphone, user history or screen capture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
const parent = path.join(root, '.runtime/sleep-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
let requests = 0,
  application;
const errors = [];
const server = createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.end('{"data":[]}');
    return;
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404);
    res.end();
    return;
  }
  requests++;
  req.resume();
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(
    'data: ' +
      JSON.stringify({ choices: [{ delta: { content: '[avatar:neutral] Awake and here.' } }] }) +
      '\n\ndata: [DONE]\n\n',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: server.address().port,
  logPrefix: 'sleep-verification',
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_MOCK_PACKS: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  assert.equal(await page.locator('#menu').count(), 0);
  assert.equal(await page.locator('#quick-actions #menu').count(), 0);
  assert.equal(await page.locator('#screen-indicator').isVisible(), true);
  assert.equal(await page.locator('#screen-indicator').getAttribute('aria-pressed'), 'false');
  assert.equal(
    await page.locator('#screen-indicator').evaluate((button) => {
      const original = button.textContent;
      try {
        return ['OBS', 'REC', 'CLIP'].every((label) => {
          button.textContent = label;
          return button.scrollWidth <= button.clientWidth;
        });
      } finally {
        button.textContent = original;
      }
    }),
    true,
    'OBS/REC/CLIP captions must fit their button',
  );
  const [settings] = await Promise.all([
    application.waitForEvent('window'),
    page.locator('#screen-indicator').click({ force: true }),
  ]);
  await settings.waitForURL('**/settings.html');
  await settings.locator('[data-section="screen"][aria-current="page"]').waitFor();
  await settings.locator('#settings-window-close').click();
  await page.locator('#message').fill('Capri, you can sleep.');
  await page.locator('#message').press('Enter');
  await page.waitForFunction(() => document.body.dataset.phase === 'asleep');
  await page.waitForFunction(
    () => document.getElementById('sprite').dataset.frame === 'idle-blink_closed',
  );
  assert.equal(requests, 0, 'sleep must never call the language model');
  assert.equal(await page.locator('#sleep-indicator').isVisible(), true);
  assert.equal((await page.evaluate(() => window.capri.bootstrap())).power.phase, 'asleep');
  await page.screenshot({ path: path.join(folder, 'sleep.png') });
  await page.locator('#message').fill('Are you awake?');
  await page.locator('#message').press('Enter');
  await page.waitForFunction(
    () =>
      document.body.dataset.phase === 'ready' &&
      document.querySelectorAll('.message[data-role="assistant"][data-status="complete"]')
        .length === 2,
  );
  assert.equal(requests, 1);
  assert.equal(await page.locator('#sleep-indicator').isVisible(), false);
  await assert.rejects(
    page.evaluate(() => window.capri.prepareWakeVoice()),
    /Enable Capri’s voice first/,
  );
  const sendEvent = (event) =>
    application.evaluate(
      ({ BrowserWindow }, value) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
          .webContents.send('capri:event', value),
      event,
    );
  await sendEvent({ type: 'voice.warning', message: 'Enable Capri’s voice first.' });
  await page.locator('#notice[data-severity="warning"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#notice-message').textContent(), 'Enable Capri’s voice first.');
  assert.equal(await page.locator('#notice-report').isHidden(), true);
  await page.locator('#notice-dismiss').click({ force: true });
  await page.locator('#notice').waitFor({ state: 'hidden' });
  await sendEvent({
    type: 'voice.error',
    message:
      'The selected voice could not start. Text replies remain available. Check setup-multilingual.cmd.',
  });
  await page.locator('#notice-report').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#notice').getAttribute('data-severity'), 'error');
  await page.locator('#notice-report').click({ force: true });
  await settings.locator('[data-section="bug"][aria-current="page"]').waitFor();
  assert.equal(await settings.locator('#bug-title').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'single menu',
        'persistent OBS toggle',
        'sleep without inference',
        'closed eyes and Zzz',
        'automatic wake and reply',
        'voice disabled warning without bug reporting',
        'error report shortcut',
      ],
      screenshots: folder,
    }),
  );
} catch (error) {
  writeFileSync(path.join(folder, 'failure.txt'), error.stack);
  await application
    ?.windows()[0]
    ?.screenshot({ path: path.join(folder, 'failure.png') })
    .catch(() => {});
  throw error;
} finally {
  if (application) {
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
    await application.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
