// SPDX-License-Identifier: GPL-3.0-only
// Production Electron UI and action broker with a simulated model. No owner input.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'computer-chat-'));
mkdirSync(path.join(folder, 'desktop'));
writeFileSync(
  path.join(folder, 'desktop', 'skills.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: {
      'capri.applications': { enabled: true, showButton: false },
      'capri.computer': { enabled: true, showButton: false },
    },
  }),
);
const report = { checks: [], errors: [], modelRequests: 0 };
let ownerMessage;
let modelAction;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
    return;
  }
  report.modelRequests++;
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const prompt = JSON.parse(body);
    assert(prompt.messages.at(-1).content.startsWith(ownerMessage));
    assert.equal(req.headers['x-capri-tools-once'], 'desktop');
    let text = 'Ready.';
    if (modelAction) {
      const broker = JSON.parse(
        readFileSync(path.join(folder, 'data/secrets/desktop-actions.json'), 'utf8'),
      );
      const request = await fetch(`${broker.url}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${broker.token}` },
        body: JSON.stringify({ id: randomBytes(32).toString('hex'), ...modelAction }),
      });
      assert(request.ok, `Action broker returned HTTP ${request.status}`);
      const receipt = await request.json();
      text = receipt.summary ?? receipt.instruction;
      if (modelAction.args.action === 'run_task') assert.equal(receipt.status, 'delegated');
    }
    if (!res.destroyed)
      res
        .writeHead(200, { 'content-type': 'text/event-stream' })
        .end(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
        );
  } catch (error) {
    report.errors.push(error.message);
    if (!res.destroyed) res.writeHead(500).end();
  }
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
  const send = async (text, decision) => {
    ownerMessage = text;
    modelAction =
      typeof decision === 'boolean'
        ? {
            tool: 'settings_control',
            args: { action: 'request', setting: 'fullComputerAccess', value: decision },
          }
        : decision === 'run_task'
          ? { tool: 'desktop_control', args: { action: decision, goal: text } }
          : (decision ?? null);
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
  await send('Use full computer control to open the fixture app.');
  await finished();
  assert.equal(await dialog.count(), 0);
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push(
    'An explicit owner command with a text-only model reply does not start control',
  );
  await send('Включи режим полного управления компьютером.', true);
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
    'A model tool call opens the timed production confirmation and persists access after approval',
  );
  await send('Enable full computer access.', true);
  await finished();
  assert.equal(await dialog.count(), 0);
  await send('Disable full computer access.', false);
  await finished();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push('Repeated enable has no duplicate dialog; chat revocation removes access');
  await send('Use full computer control to open Spotify and calculate 2+2.', 'run_task');
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
  await send(
    'Can you use my computer to open Steam? Then find Cyberpunk 2077, open it and uh press play button.',
    'run_task',
  );
  await dialog.waitFor();
  await dialog.locator('[data-choice="cancel"]').click();
  await finished();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push('The complete spoken Steam request reaches the host permission dialog');
  await send(
    'Hello Capri, can you use my computer to open Google Chrome, then Google Cyberpunk Renders 2 and find yourself on the pictures?',
    {
      tool: 'desktop_control',
      args: {
        action: 'run_task',
        goal: 'Open Google Chrome and search for "Cyberpunk 2027 Renders 2".',
      },
    },
  );
  await dialog.waitFor();
  await dialog.locator('[data-choice="cancel"]').click();
  await finished();
  assert.equal(
    await page.evaluate(() => window.capri.computerAccessStatus().then((s) => s.enabled)),
    false,
  );
  report.checks.push('A rewritten browser tool goal reaches the original task permission dialog');
  const id = await send('Capre use full computer access and open YouTube.', 'run_task');
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
  assert.equal(report.modelRequests, 8);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
