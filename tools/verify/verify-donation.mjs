// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const donationUrl = 'https://app.lava.top/overyx?donate=open';
const donationTitle = 'Lava.top — Capri';
const partition = 'capri-donation';
const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
using fixture = mkdtempDisposableSync(path.join(parent, 'donation-'));
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: fixture.path,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;

let application;
const nativeWindows = () =>
  application.evaluate(
    ({ BrowserWindow, session }, partition) =>
      BrowserWindow.getAllWindows()
        .filter(
          (window) =>
            !window.isDestroyed() &&
            window.webContents &&
            !window.webContents.isDestroyed() &&
            window.webContents.session === session.fromPartition(partition),
        )
        .map((window) => {
          const preferences = window.webContents.getLastWebPreferences();
          return {
            id: window.id,
            title: window.getTitle(),
            url: window.webContents.getURL(),
            visible: window.isVisible(),
            persistent: window.webContents.session.isPersistent(),
            contextIsolation: preferences.contextIsolation,
            sandbox: preferences.sandbox,
            nodeIntegration: preferences.nodeIntegration,
            preload: preferences.preload || '',
          };
        }),
    partition,
  );
async function waitForNativeWindows(count) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const windows = await nativeWindows();
    if (windows.length === count && windows.every((window) => window.visible && window.url))
      return windows;
    await delay(50);
  }
  assert.fail(`Expected ${count} visible donation windows`);
}

try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const companion = await application.firstWindow();
  await companion.waitForFunction(() => document.body.dataset.phase === 'ready');
  await companion.evaluate(async () => {
    const { languages } = await window.capri.bootstrap();
    await window.capri.setLanguages({ ...languages, interface: 'en' });
  });
  const settings = await settingsView(application, 'support');
  const open = settings.locator('#support-donation-open');
  const fallback = settings.locator('[data-community="lava-donate"]');
  await open.waitFor();
  await fallback.waitFor();

  await application.evaluate(
    ({ session, shell, dialog }, { partition, donationUrl }) => {
      const state = { external: [], requests: [], browserOffers: 0, fail: false };
      globalThis.donationVerification = state;
      shell.openExternal = async (url) => state.external.push(url);
      dialog.showMessageBox = async () => {
        state.browserOffers++;
        return { response: 1 };
      };
      session.fromPartition(partition, { cache: false }).protocol.handle('https', (request) => {
        state.requests.push({
          url: request.url,
          method: request.method,
          authenticated: request.headers.has('x-api-key') || request.headers.has('authorization'),
        });
        if (request.url !== donationUrl || state.fail) return Response.error();
        return new Response(
          '<title>Lava fixture</title><h1>Hosted donation fixture</h1>' +
            '<a href="https://example.invalid/checkout" id="outside">Outside provider</a>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      });
    },
    { partition, donationUrl },
  );

  const companionCanOpen = await companion.evaluate(async () => {
    if (typeof window.capri.openDonation !== 'function') return false;
    try {
      return (await window.capri.openDonation()) !== false;
    } catch {
      return false;
    }
  });
  assert.equal(companionCanOpen, false);
  assert.deepEqual(await nativeWindows(), []);

  await open.click();
  const [native] = await waitForNativeWindows(1);
  assert.deepEqual(native, {
    id: native.id,
    title: donationTitle,
    url: donationUrl,
    visible: true,
    persistent: false,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    preload: '',
  });
  const payment = application.windows().find((view) => view.url() === donationUrl);
  assert.ok(payment, 'The hosted page must be available in its own renderer');
  await payment.getByRole('heading', { name: 'Hosted donation fixture' }).waitFor();
  assert.deepEqual(
    await payment.evaluate(() => [typeof window.capri, typeof require, typeof process]),
    ['undefined', 'undefined', 'undefined'],
  );
  assert.deepEqual(await application.evaluate(() => globalThis.donationVerification.requests), [
    { url: donationUrl, method: 'GET', authenticated: false },
  ]);
  console.log('PASS Settings-only admission opens the fixed hosted URL in an isolated session');

  await settings.evaluate(() => window.capri.openDonation());
  assert.equal((await waitForNativeWindows(1))[0].id, native.id);
  await payment.locator('#outside').click({ noWaitAfter: true });
  assert.equal(await payment.evaluate(() => window.location.href), donationUrl);
  await payment.evaluate(() => {
    window.open('https://example.invalid/popup');
  });
  assert.equal((await waitForNativeWindows(1))[0].id, native.id);
  assert.equal(await application.evaluate(() => globalThis.donationVerification.browserOffers), 1);
  assert.deepEqual(await application.evaluate(() => globalThis.donationVerification.external), []);
  assert.deepEqual(await application.evaluate(() => globalThis.donationVerification.requests), [
    { url: donationUrl, method: 'GET', authenticated: false },
  ]);
  console.log(
    'PASS Repeated activation reuses the window and remote content cannot escape to another site',
  );

  await payment.close();
  await waitForNativeWindows(0);
  await application.evaluate(() => {
    globalThis.donationVerification.fail = true;
  });
  await open.click();
  const notice = settings.locator('#settings-notice');
  await notice.waitFor();
  assert.match(await notice.innerText(), /could not open the donation window/i);
  await waitForNativeWindows(0);
  assert.equal(await open.isEnabled(), true);
  await fallback.click();
  assert.deepEqual(await application.evaluate(() => globalThis.donationVerification.external), [
    donationUrl,
  ]);
  console.log('PASS Connection failure recovers the button and the fixed browser fallback works');

  if (process.argv.includes('--live')) {
    await application.evaluate(({ session }, partition) => {
      session.fromPartition(partition).protocol.unhandle('https');
    }, partition);
    await open.click();
    await waitForNativeWindows(1);
    const view = application
      .windows()
      .find((page) => page.url().startsWith('https://app.lava.top/'));
    assert.ok(view);
    await view.waitForURL(
      (url) => url.origin === 'https://app.lava.top' && url.pathname.startsWith('/products/'),
    );
    await view
      .getByText(/enter tip amount|other amount|другая сумма|сумма доната/i)
      .first()
      .waitFor();
    await view.locator('input:visible').first().waitFor();
    console.log('PASS Public Lava.top donation form is visible without submitting payment');
  }
} finally {
  try {
    await application?.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
