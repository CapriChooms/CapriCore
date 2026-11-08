// SPDX-License-Identifier: GPL-3.0-only
// Isolated owned UI: fake metadata/receipts, no provider calls or real model switches.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/inference-picker-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
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
const report = { passed: false, folder, errors: [], switches: [], sizes: [] };
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.phase === 'ready');
  await application.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.pickerFixture = {
      activeId: 'fixture-one',
      setupRequired: false,
      secureStorage: true,
      localModel: 'Qwen local',
      profiles: [
        {
          id: 'fixture-one',
          name: 'Preview API <img src=x>',
          model: 'fixture/model-A',
          baseUrl: 'https://one.example/v1',
          canConnect: true,
        },
        {
          id: 'fixture-two',
          name: 'Second API',
          model: 'fixture/model-B',
          baseUrl: 'https://two.example/v1',
          canConnect: true,
        },
        {
          id: 'fixture-unavailable',
          name: 'No saved key',
          model: 'fixture/model-C',
          baseUrl: 'https://three.example/v1',
          canConnect: false,
        },
      ],
    };
    globalThis.pickerCalls = [];
    globalThis.pickerLoads = 0;
    globalThis.pickerDelay = false;
    globalThis.pickerReady = true;
    for (const channel of [
      'capri:inference-api-status',
      'capri:inference-api-use',
      'capri:models-status',
      'capri:inference-api-test',
    ])
      ipcMain.removeHandler(channel);
    ipcMain.handle('capri:inference-api-status', async () => {
      globalThis.pickerLoads++;
      if (globalThis.pickerDelay) await new Promise((resolve) => setTimeout(resolve, 160));
      return globalThis.pickerFixture;
    });
    ipcMain.handle('capri:inference-api-use', async (_event, id) => {
      globalThis.pickerCalls.push(id);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return false; // Simulate cancelled restart confirmation.
    });
    ipcMain.handle('capri:models-status', () => ({
      profiles: [{ configured: true, installed: globalThis.pickerReady, supported: true }],
    }));
    ipcMain.handle('capri:inference-api-test', () => {
      throw Error('Opening the picker must never test a provider.');
    });
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().endsWith('/index.html'),
    );
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
  });
  const badge = page.locator('#inference-label');
  const menu = page.locator('#inference-picker');
  const choices = menu.locator('[role="menuitemradio"]');
  const open = async () => {
    await badge.click();
    await choices.first().waitFor();
  };
  await open();
  assert.equal(await choices.count(), 4);
  assert.equal(await menu.locator('img,script').count(), 0);
  assert.equal(
    await menu.locator('[aria-checked="true"]').textContent(),
    'Preview API <img src=x>fixture/model-AActive',
  );
  assert.equal(await choices.nth(3).isDisabled(), true);
  assert.equal(await badge.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.settings), 'api');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.source), 'local');
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await badge.evaluate((node) => node === document.activeElement), true);

  const turnId = 'picker-busy-reply';
  const assistant = {
    id: turnId,
    turnId,
    role: 'assistant',
    text: '',
    status: 'streaming',
    createdAt: new Date().toISOString(),
  };
  const emit = (event) =>
    application.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()
        .find((item) => item.webContents.getURL().endsWith('/index.html'))
        .webContents.send('capri:event', value);
    }, event);
  await open();
  const busyNotice = menu.locator('.inference-picker-notice');
  assert.equal(await busyNotice.isVisible(), false);
  await emit({ type: 'turn.started', turnId, silent: true, assistant });
  await busyNotice.waitFor({ state: 'visible' });
  assert.equal(await busyNotice.innerText(), 'Wait for the current reply to finish.');
  assert.equal(await busyNotice.getAttribute('role'), 'status');
  assert.equal(await menu.getAttribute('data-reply-busy'), 'true');
  assert.equal(await choices.locator(':scope:enabled').count(), 0);
  assert(await choices.evaluateAll((items) => items.every((item) => item.disabled)));
  const busyLayout = await menu.evaluate((node) => {
    const warning = node.querySelector('.inference-picker-notice');
    const active = node.querySelector('[aria-checked="true"]');
    const first = node.querySelector('.inference-picker-choice');
    const warningRect = warning.getBoundingClientRect();
    const menuRect = node.getBoundingClientRect();
    return {
      activeOpacity: Number(getComputedStyle(active).opacity),
      activeStateColor: getComputedStyle(active.querySelector('.inference-picker-state')).color,
      warningBeforeChoices: warningRect.bottom <= first.getBoundingClientRect().top,
      contained:
        warningRect.left >= menuRect.left &&
        warningRect.right <= menuRect.right &&
        warningRect.top >= menuRect.top &&
        warningRect.bottom <= menuRect.bottom,
    };
  });
  assert.equal(busyLayout.activeOpacity, 1);
  assert.equal(busyLayout.warningBeforeChoices, true);
  assert.equal(busyLayout.contained, true);
  await choices.nth(2).evaluate((node) => node.onclick());
  assert.deepEqual(await application.evaluate(() => globalThis.pickerCalls), []);
  await page.screenshot({ path: path.join(folder, 'picker-busy-reply.png') });
  report.busy = busyLayout;
  await emit({
    type: 'turn.completed',
    turnId,
    assistant: { ...assistant, text: 'Synthetic reply completed.', status: 'completed' },
  });
  await busyNotice.waitFor({ state: 'hidden' });
  assert.equal(await menu.getAttribute('data-reply-busy'), 'false');
  assert.equal(await choices.nth(0).isDisabled(), false);
  assert.equal(await choices.nth(1).isDisabled(), false);
  assert.equal(await choices.nth(2).isDisabled(), false);
  assert.equal(await choices.nth(3).isDisabled(), true);
  await page.keyboard.press('Escape');

  for (const [width, height] of [
    [480, 660],
    [320, 480],
    [320, 360],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((item) => item.webContents.getURL().endsWith('/index.html'))
          .setContentSize(...size),
      [width, height],
    );
    await open();
    const bounds = await menu.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
    });
    assert(
      bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.vw && bounds.bottom <= bounds.vh,
    );
    assert(
      await menu.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const anchor = document.getElementById('inference-label').getBoundingClientRect();
        return r.bottom <= anchor.top || r.top >= anchor.bottom;
      }),
      'The menu must leave its toggle visible even in compact mode',
    );
    report.sizes.push({ width, height, bounds });
    await page.screenshot({ path: path.join(folder, `picker-${width}x${height}.png`) });
    await page.keyboard.press('Escape');
  }
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((item) => item.webContents.getURL().endsWith('/index.html'))
      .setContentSize(480, 660),
  );
  const title = await badge.getAttribute('title');
  await open();
  await choices.nth(2).click();
  await page.waitForTimeout(150);
  assert.deepEqual(await application.evaluate(() => globalThis.pickerCalls), ['fixture-two']);
  assert.equal(
    await badge.getAttribute('title'),
    title,
    'Cancelled switches do not change the current-source badge',
  );
  await open();
  await choices.nth(1).click();
  assert.deepEqual(await application.evaluate(() => globalThis.pickerCalls), ['fixture-two']);
  await open();
  await choices.first().click();
  await page.waitForTimeout(150);
  assert.deepEqual(await application.evaluate(() => globalThis.pickerCalls), ['fixture-two', null]);

  await application.evaluate(() => {
    globalThis.pickerDelay = true;
  });
  await badge.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await menu.isVisible(), false, 'A late metadata response cannot reopen the menu');
  await application.evaluate(() => {
    globalThis.pickerDelay = false;
  });
  await open();
  await page.locator('#message').click();
  assert.equal(await menu.isVisible(), false);
  assert.equal(await application.evaluate(() => globalThis.pickerLoads > 0), true);
  assert.deepEqual(report.errors, []);
  report.switches = await application.evaluate(() => globalThis.pickerCalls);
  report.passed = true;
} finally {
  if (application) await application.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
