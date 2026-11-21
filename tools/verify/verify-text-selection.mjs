// SPDX-License-Identifier: GPL-3.0-only
/** Real renderer mouse-selection regression, isolated from owner data and models. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { _electron as electron } from 'playwright-core';
import { root, runtime, initialize, environment } from '../../packages/runtime/src/index.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/text-selection-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'ui-'));
const reply = 'Copy this synthetic Capri answer.';
const server = createServer((request, response) => {
  request.resume();
  if (request.url === '/v1/chat/completions') {
    response.setHeader('content-type', 'text/event-stream');
    response.end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: reply } }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  } else {
    response.setHeader('content-type', 'application/json');
    response.end('{"data":[]}');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const rt = runtime({
  stateDir: path.join(folder, 'openclaw'),
  workspace: path.join(folder, 'workspace'),
  gatewayPort: port,
});
initialize(rt);
const env = {
  ...environment(rt),
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
const report = {
  passed: false,
  folder,
  physicalInput: false,
  modelsStarted: false,
  ownerDataChanged: false,
};
let application;
const errors = [];
const selection = (page) => page.evaluate(() => document.getSelection()?.toString() ?? '');
const clear = (page) => page.evaluate(() => document.getSelection()?.removeAllRanges());
async function dragText(page, locator, { moving = false, ink = false } = {}) {
  await clear(page);
  if (moving) {
    await locator.waitFor({ state: 'visible' });
    // Credits intentionally drift. Check them during animation rather than
    // waiting for an animated element to become motionless.
    await locator.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
  } else await locator.scrollIntoViewIfNeeded();
  const lines = ink
    ? await locator.evaluate((element) => {
        const text = document.createRange();
        text.selectNodeContents(element);
        return Array.from(text.getClientRects(), (line) => line.toJSON());
      })
    : [await locator.boundingBox()];
  const first = lines[0];
  const last = lines.at(-1);
  assert.ok(first?.width > 0 && last.height > 0, 'Visible text target');
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 12 });
  await page.mouse.up();
  return selection(page);
}
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL() === 'capri://desktop/index.html')
      .showInactive();
  });
  await page.locator('#presence-toggle').click({ force: true });
  const graph = page.locator('.process-graph[data-metric="CPU"] .process-graph-label > span');
  await graph.waitFor({ state: 'visible' });
  // Restore the former selectable default only inside this disposable renderer,
  // then reproduce the report with real Chromium mouse input rather than a DOM Range.
  const previous = await page.evaluate(() => {
    const values = [document.documentElement.style.userSelect, document.body.style.userSelect];
    document.documentElement.style.userSelect = document.body.style.userSelect = 'auto';
    return values;
  });
  await graph.dblclick();
  const oldSelection = await selection(page);
  assert.ok(oldSelection.includes('CPU'), 'Former UI defaults reproduce the grey CPU selection');
  report.reproducedFormerSelection = true;
  await page.evaluate(([html, body]) => {
    document.documentElement.style.userSelect = html;
    document.body.style.userSelect = body;
  }, previous);
  await clear(page);
  for (const metric of ['CPU', 'GPU', 'RAM', 'VRAM']) {
    const label = page.locator(
      `.process-graph[data-metric="${metric}"] .process-graph-label > span`,
    );
    assert.equal(await dragText(page, label), '', metric + ' drag does not select UI text');
    await label.dblclick();
    assert.equal(await selection(page), '', metric + ' double click does not select UI text');
  }
  report.resourceLabels = true;
  await page.evaluate(() => window.capri.monitorDisplay('toggle'));
  for (const metric of ['RAM', 'VRAM'])
    assert.equal(
      await dragText(
        page,
        page.locator(`.memory-gauge[data-memory="${metric}"] .memory-label > span`).first(),
      ),
      '',
      metric + ' ring label',
    );
  report.monitorSwitching = true;
  const input = page.locator('#message');
  await input.fill('Editable synthetic request');
  await input.press('Control+A');
  assert.deepEqual(
    await input.evaluate((element) => [element.selectionStart, element.selectionEnd]),
    [0, 'Editable synthetic request'.length],
  );
  report.inputEditing = true;
  await input.fill('');
  await page.evaluate(() => window.capri.send({ id: crypto.randomUUID(), text: 'Languages' }));
  await page.waitForFunction(
    (text) => document.getElementById('subtitle-text').textContent === text,
    reply,
  );
  assert.ok(
    await dragText(page, page.locator('#subtitle-text')),
    'Visible Capri reply supports text selection',
  );
  report.visibleReplySelection = true;
  await clear(page);
  await page.locator('#history-toggle').click();
  assert.ok(
    await dragText(page, page.locator('.message[data-role="assistant"] .message-text').last()),
    'Conversation answer supports text selection',
  );
  assert.ok(
    (
      await dragText(page, page.locator('.message[data-role="user"] .message-text').last())
    ).includes('Language'),
    'Conversation requests support text selection too',
  );
  report.historyAnswerSelection = true;
  const settings = await settingsView(application, 'general');
  assert.match(
    await dragText(settings, settings.locator('#general-panel h2'), { ink: true }),
    /General/,
    'Settings titles support selection',
  );
  const description = await dragText(settings, settings.locator('#general-hide-help'), {
    ink: true,
  });
  assert.match(description, /Hide the companion window/, 'Settings descriptions support selection');
  await settings.evaluate(() => {
    document.addEventListener(
      'copy',
      (event) => {
        // Observe the renderer's shortcut without writing to the system clipboard.
        event.preventDefault();
        window.verifiedSettingsCopy = {
          text: document.getSelection().toString(),
          trusted: event.isTrusted,
        };
      },
      { once: true },
    );
  });
  await settings.keyboard.press('Control+c');
  await settings.waitForFunction(() => window.verifiedSettingsCopy, undefined, { timeout: 5000 });
  assert.deepEqual(await settings.evaluate(() => window.verifiedSettingsCopy), {
    text: description,
    trusted: true,
  });
  report.settingsCopy = true;
  const search = settings.locator('#settings-search');
  await search.fill('Editable filter');
  await search.press('Control+A');
  assert.deepEqual(
    await search.evaluate((element) => [element.selectionStart, element.selectionEnd]),
    [0, 'Editable filter'.length],
  );
  await search.fill('');
  await settingsView(application, 'avatar-skill');
  const checkbox = settings.locator('#teleport-reduced-flash');
  const optionLabel = settings.locator('#teleport-reduced-flash + span');
  const checked = await checkbox.isChecked();
  assert.match(
    await dragText(settings, optionLabel, { ink: true }),
    /teleport flashes/,
    'Settings labels support selection',
  );
  assert.equal(
    await checkbox.isChecked(),
    checked,
    'Selecting a label does not toggle its control',
  );
  await optionLabel.click();
  assert.equal(await checkbox.isChecked(), !checked, 'Clicking the label still toggles');
  await optionLabel.click();
  assert.equal(await checkbox.isChecked(), checked);
  await settingsView(application, 'credits');
  const nickname = settings.locator('.credits-name-gradient').first();
  await nickname.waitFor({ state: 'visible' });
  assert.match(
    await dragText(settings, nickname, { moving: true, ink: true }),
    /Overyx/,
    'Credits names support selection',
  );
  report.settingsAndCredits = true;
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(folder, 'main.png') });
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await application?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
