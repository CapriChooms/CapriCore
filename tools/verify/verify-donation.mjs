// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';

const donationUrl = 'https://app.lava.top/overyx?donate=open';
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

  await application.evaluate(({ shell }) => {
    globalThis.donationVerification = { external: [], fail: false };
    shell.openExternal = async (url) => {
      if (globalThis.donationVerification.fail) throw new Error('Browser unavailable');
      globalThis.donationVerification.external.push(url);
    };
  });
  const opened = () => application.evaluate(() => globalThis.donationVerification.external);

  const companionCanOpen = await companion.evaluate(async () => {
    if (typeof window.capri.openDonation !== 'function') return false;
    try {
      return (await window.capri.openDonation()) !== false;
    } catch {
      return false;
    }
  });
  assert.equal(companionCanOpen, false);
  assert.deepEqual(await opened(), []);

  const heart = settings.locator('#support-heart');
  const meme = settings.locator('#support-meme img');
  assert.equal(await meme.count(), 0);
  await heart.hover();
  assert.deepEqual(
    await heart.evaluate((button) => {
      const style = getComputedStyle(button);
      return [style.fontSize, style.color, style.backgroundColor];
    }),
    ['48px', 'rgb(255, 119, 174)', 'rgba(0, 0, 0, 0)'],
  );
  await heart.click();
  await settings.waitForFunction(() => {
    const image = document.querySelector('#support-meme img');
    return image?.complete && image.naturalWidth > 0;
  });
  assert.equal(await meme.getAttribute('alt'), 'Paypal me $3000');
  const memeWidth = await meme.evaluate((image) => image.offsetWidth);
  assert.ok(memeWidth > 0 && memeWidth <= 210);
  assert.deepEqual(await opened(), []);
  await meme.waitFor({ state: 'detached', timeout: 2000 });

  await settings.emulateMedia({ reducedMotion: 'reduce' });
  await heart.press('Enter');
  await meme.waitFor();
  await settingsView(application, 'general');
  await settingsView(application, 'support');
  assert.equal(await meme.count(), 0);
  console.log(
    'PASS The support heart displays the bundled meme temporarily without opening a link',
  );

  const views = application.windows().length;
  await open.click();
  await settings.waitForFunction(() => !document.getElementById('support-donation-open').disabled);
  assert.deepEqual(await opened(), [donationUrl]);
  assert.equal(application.windows().length, views);
  console.log('PASS The primary Lava.top button opens the fixed URL in the system browser');

  await application.evaluate(() => {
    globalThis.donationVerification.fail = true;
  });
  await open.click();
  const notice = settings.locator('#settings-notice');
  await notice.waitFor();
  assert.match(await notice.innerText(), /could not open the donation window/i);
  assert.equal(await open.isEnabled(), true);
  await application.evaluate(() => {
    globalThis.donationVerification.fail = false;
  });
  await fallback.evaluate((button) => button.onclick());
  assert.deepEqual(await opened(), [donationUrl, donationUrl]);
  assert.equal(application.windows().length, views);
  console.log('PASS Browser launch failure recovers the button and the alternate link still works');
} finally {
  try {
    await application?.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
