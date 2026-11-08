// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { shadeBounds } from '../apps/desktop/renderer/dimming-settings.mjs';
import { publishLaunchReceipt } from '../packages/runtime/src/host/launch-receipt.mjs';
import { observationOptions } from '../apps/desktop/screen-observation.mjs';
import {
  validateLanguages,
  LANGUAGE_DEFAULTS,
  resolveLanguages,
} from '../apps/desktop/renderer/language-settings.mjs';
const parent = path.resolve('.runtime/v037-unit');
mkdirSync(parent, { recursive: true });
test('compact shade follows visible controls, removes unused portrait area and clamps to the window', () => {
  const viewport = { width: 480, height: 660 },
    rect = { x: 40, y: 410, width: 420, height: 240 };
  assert.deepEqual(shadeBounds([rect], viewport, true), { x: 28, y: 398, width: 444, height: 262 });
  assert.deepEqual(shadeBounds([], viewport, true), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(shadeBounds([rect], viewport, false), { x: 0, y: 0, ...viewport });
});
test('custom screen leases are bounded and fast multilingual recognition is a separate opt-in mode', () => {
  assert.deepEqual(observationOptions({ intervalMs: 47000, durationMs: 930000 }), {
    intervalMs: 47000,
    durationMs: 930000,
  });
  for (const value of [{ intervalMs: 14999 }, { durationMs: 7200001 }, { intervalMs: NaN }])
    assert.throws(() => observationOptions(value));
  const language = validateLanguages({ ...LANGUAGE_DEFAULTS, recognition: 'auto-europe' });
  assert.equal(resolveLanguages(language).recognition, 'auto-europe');
  assert.equal(language.autoDetect, false);
});
test('launch acknowledgements require a nonce and cannot follow a linked private folder', () => {
  const root = mkdtempSync(path.join(parent, 'launch-'));
  assert.equal(publishLaunchReceipt(root, '../../invalid'), false);
  assert.equal(publishLaunchReceipt(root, 'a'.repeat(32)), true);
  const receipt = JSON.parse(
    readFileSync(path.join(root, 'data/run/launch-' + 'a'.repeat(32) + '.json')),
  );
  assert.equal(receipt.phase, 'window-ready');
  const linked = mkdtempSync(path.join(parent, 'linked-'));
  symlinkSync(
    path.join(root, 'data'),
    path.join(linked, 'data'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => publishLaunchReceipt(linked, 'b'.repeat(32)), /Linked/);
});
test(
  'Windows installer discovery accepts only valid identities and tolerates stale, malformed and duplicate candidates',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'discovery-')),
      valid = path.join(folder, 'Прежняя Capri');
    mkdirSync(valid);
    writeFileSync(
      path.join(valid, '.capri-install.json'),
      JSON.stringify({
        schemaVersion: 1,
        productId: 'capri.desktop',
        root: valid,
        version: '0.3.6',
        installId: '00000000-0000-4000-8000-000000000001',
      }),
    );
    const bad = path.join(folder, 'bad');
    mkdirSync(bad);
    writeFileSync(path.join(bad, '.capri-install.json'), 'broken');
    const script = path.join(folder, 'verify.ps1');
    const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
    writeFileSync(
      script,
      '\ufeff' +
        "$ErrorActionPreference='Stop'\n. " +
        quote(path.resolve('packages/installer/windows/common.ps1')) +
        '\n. ' +
        quote(path.resolve('packages/installer/windows/install-discovery.ps1')) +
        '\n$items=@(Get-CapriInstallations -NoRegistry -Candidates @(' +
        [valid, valid, bad, path.join(folder, 'missing')].map(quote).join(',') +
        '))\nif($items.Count -ne 1 -or $items[0].version -ne "0.3.6"){throw "Discovery mismatch"}\n',
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
  },
);
