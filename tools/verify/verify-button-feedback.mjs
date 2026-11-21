// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { COMPANION_DEFAULTS } from '../../apps/desktop/companion-settings.mjs';
import { settingsView } from './settings-view.mjs';

const parent = path.join(root, '.runtime/desktop-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'button-feedback-'));
mkdirSync(path.join(folder, 'desktop'));
writeFileSync(
  path.join(folder, 'desktop/companion.json'),
  JSON.stringify({
    schemaVersion: 1,
    settings: {
      ...COMPANION_DEFAULTS,
      buttonFeedback: false,
      floatEnabled: false,
      glitchEnabled: true,
    },
  }),
);
const report = { folder, checks: [], errors: [] };
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end('{"data":[]}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  TEMP: folder,
  TMP: folder,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_PORT: String(server.address().port),
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
const active = (button) =>
  button.evaluate(
    (el) => el.getAnimations().filter((a) => a.id === 'capri-button-feedback').length,
  );
const record = (name) => {
  report.checks.push(name);
  console.log('PASS ' + name);
};
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(root, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 60000,
  });
  application.on('window', (p) => p.on('pageerror', (e) => report.errors.push(e.message)));
  const owner = await application.firstWindow();
  await owner.waitForFunction(() => document.body.dataset.phase === 'ready');
  const settings = await settingsView(application, 'appearance');
  const preview = settings.locator('#glitch-preview');
  assert.equal(await settings.locator('#companion-button-feedback, #feedback-preview').count(), 0);
  await preview.click();
  assert.equal(await active(preview), 1, 'Legacy opt-outs do not disable the feedback');
  assert.equal(
    Object.hasOwn(
      (await settings.evaluate(() => window.capri.bootstrap())).companion,
      'buttonFeedback',
    ),
    false,
  );
  record('The obsolete setting is gone and its saved off value is ignored');
  const colors = await preview.evaluate((el) => {
    const a = el.getAnimations().find((a) => a.id === 'capri-button-feedback');
    a.pause();
    a.currentTime = 60;
    const lit = getComputedStyle(el).backgroundColor;
    const shadow = getComputedStyle(el).boxShadow;
    a.currentTime = a.effect.getTiming().duration;
    const base = getComputedStyle(el).backgroundColor;
    a.currentTime = 60;
    return { lit, base, shadow };
  });
  assert.notEqual(
    colors.lit,
    colors.base,
    'Feedback must visibly change the fill, not just hover brightness',
  );
  assert.match(colors.shadow, /inset/);
  await settings.screenshot({ path: path.join(folder, 'feedback-preview.png') });
  await preview.evaluate((el) => el.getAnimations().forEach((a) => a.cancel()));
  await preview.click();
  await preview.click();
  assert.equal(await active(preview), 1, 'Rapid clicks replace, rather than stack, the impulse');
  await preview.focus();
  await settings.keyboard.press('Enter');
  assert.equal(await active(preview), 1);
  await settings.waitForFunction(
    () => !document.querySelector('#glitch-preview.button-acknowledged'),
  );
  record('Mouse and keyboard clicks produce a visible impulse that cleans up');
  const toolbar = owner.locator('#settings-open');
  await toolbar.click();
  assert.equal(await active(toolbar), 1, 'Feedback also applies on the main toolbar');
  await settingsView(application, 'appearance');
  await settings.emulateMedia({ reducedMotion: 'reduce' });
  await preview.click();
  const reduced = await preview.evaluate((el) => {
    const a = el.getAnimations().find((a) => a.id === 'capri-button-feedback');
    return { frames: a.effect.getKeyframes(), duration: a.effect.getTiming().duration };
  });
  assert.equal(reduced.frames[0].backgroundColor, reduced.frames.at(-1).backgroundColor);
  assert.ok(reduced.duration <= 250);
  await settings.waitForFunction(
    () => !document.querySelector('#glitch-preview.button-acknowledged'),
  );
  await preview.evaluate((el) => el.click());
  assert.equal(await active(preview), 0, 'Programmatic actions must not impersonate a user click');
  record('Reduced motion uses a static highlight; synthetic clicks stay silent');
  assert.deepEqual(report.errors, []);
} finally {
  await application?.close();
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
