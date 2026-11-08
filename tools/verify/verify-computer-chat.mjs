// SPDX-License-Identifier: GPL-3.0-only
// Production Electron UI, chat routing and permission persistence; no models or
// input into owner applications. Tests use a disposable desktop state directory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'computer-chat-'));
const report = { checks: [], errors: [], modelRequests: 0 };
const server = createServer((req, res) => {
  if (req.method === 'POST') report.modelRequests++;
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
let app;
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready', null, {
    timeout: 60000,
  });
  const send = async (text) => {
    const id = randomUUID();
    await page.evaluate(
      ({ id, text }) => {
        window.__computerChatResult = null;
        void window.capri.send({ id, text }).then(
          (result) => {
            window.__computerChatResult = result;
          },
          (error) => {
            window.__computerChatResult = { error: error.message };
          },
        );
      },
      { id, text },
    );
    return id;
  };
  const finished = async () => {
    await page.waitForFunction(() => window.__computerChatResult !== null);
    assert.equal((await page.evaluate(() => window.__computerChatResult)).error, undefined);
  };
  const dialog = page.locator('#confirmation-dialog[open]');
  await send('Включи режим полного управления компьютером.');
  await dialog.waitFor();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  const confirm = dialog.locator('[data-choice="confirm"]');
  assert.equal(await confirm.isDisabled(), true);
  await confirm.click(); // Playwright waits for the host-enforced countdown to finish.
  await finished();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    true,
  );
  report.checks.push(
    'Chat opens timed production confirmation and persists access without a model request',
  );
  await send('Enable full computer access.');
  await finished();
  assert.equal(await dialog.count(), 0);
  await send('Disable full computer access.');
  await finished();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push('Repeated enable has no duplicate dialog; chat revocation removes access');
  await send('Use full computer control to open Spotify and calculate 2+2.');
  await dialog.waitFor();
  await dialog.locator('[data-choice="cancel"]').click();
  await finished();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push(
    'Mixed Spotify/math task requests full control; declining runs neither narrow skill nor executor',
  );
  const id = await send('Use full computer control to open Chrome.');
  await dialog.waitFor();
  await page.evaluate((id) => window.capri.cancel(id), id);
  await finished();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push(
    'Cancelling the chat closes its permission dialog and prevents late execution',
  );
  assert.equal(report.modelRequests, 0);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
