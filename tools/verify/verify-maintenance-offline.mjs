// SPDX-License-Identifier: GPL-3.0-only
// Native app with a fresh API-only profile. No providers, model downloads or updates execute.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { settingsView } from './settings-view.mjs';
const appRoot = process.argv[2] ?? root;
const parent = path.join(appRoot, '.runtime/maintenance-offline-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'case-'));
mkdirSync(path.join(folder, 'desktop'), { recursive: true });
writeFileSync(
  path.join(folder, 'desktop/inference-api.json'),
  JSON.stringify({ setupRequired: true }),
);
const env = {
  ...process.env,
  CAPRI_DESKTOP_VERIFICATION_DIR: folder,
  CAPRI_DESKTOP_VERIFICATION_SKIP_START: '1',
  CAPRI_DESKTOP_VERIFICATION_ASR: '0',
  CAPRI_DESKTOP_VERIFICATION_VOICE: '0',
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
const report = { passed: false, folder, checks: [] };
try {
  application = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.join(appRoot, 'apps/desktop/main.mjs'), '--verification'],
    env,
    timeout: 30000,
  });
  const page = await application.firstWindow();
  let snapshot;
  for (let attempt = 0; attempt < 150; attempt++) {
    snapshot = await page.evaluate(() => window.capri.bootstrap());
    if (snapshot.backend.phase === 'offline') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(snapshot.backend.phase, 'offline');
  assert.equal(snapshot.activeTurnId, null);
  const settings = await settingsView(application, 'updates');
  const error = await settings.evaluate(() =>
    window.capri.installUpdate().then(
      () => null,
      (error) => error.message,
    ),
  );
  assert.match(error, /Installing updates is disabled in desktop verification/);
  assert.doesNotMatch(error, /Wait for the current reply/);
  report.checks.push(
    'Offline API setup reaches the installation gate without a fictitious active reply',
  );
  await settingsView(application, 'models');
  await settings.locator('#models-choice option').first().waitFor({ state: 'attached' });
  await settings.waitForFunction(() => !document.getElementById('models-choice').disabled);
  await settings.selectOption('#models-choice', 'minimal');
  assert.equal(await settings.locator('#models-prepare').isDisabled(), false);
  assert.equal(await settings.locator('#models-local').isDisabled(), false);
  await settings.screenshot({ path: path.join(folder, 'api-to-local.png') });
  report.checks.push('Fresh API-only setup exposes the first local model selection and download');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await application?.close();
  writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
