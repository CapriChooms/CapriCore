// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, mkdirSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { applicationId } from '../packages/runtime/src/host/desktop-identity.mjs';
import { root } from '../packages/runtime/src/host/paths.mjs';

test('Windows application identity is stable per installation, independent of letter case', () => {
  assert.equal(applicationId(root), applicationId(root.toUpperCase()));
  assert.notEqual(applicationId(root), applicationId(root + '-other'));
  assert.match(applicationId(root), /^Overyx\.Capri\.[a-f0-9]{16}$/);
});

test(
  'private desktop executable has Capri metadata and never modifies the original Electron',
  { skip: process.platform !== 'win32' },
  async () => {
    // Never rebuild the owner's running desktop or its identity receipt.
    const parent = path.join(root, '.runtime/desktop-identity-unit');
    mkdirSync(parent, { recursive: true });
    const fixture = mkdtempSync(path.join(parent, 'fixture-'));
    for (const name of [
      'package.json',
      'assets/default/app.ico',
      'packages/installer/windows/desktop-branding.cs',
      'tools/setup/prepare-desktop-identity.ps1',
      'packages/runtime/src/host/desktop-identity.mjs',
      'packages/runtime/src/host/paths.mjs',
      'packages/runtime/src/atomic-json.mjs',
    ]) {
      const target = path.join(fixture, name);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(root, name), target);
    }
    const installed = createRequire(import.meta.url)('electron');
    const original = path.join(fixture, 'node_modules/electron/dist/electron.exe');
    mkdirSync(path.dirname(original), { recursive: true });
    copyFileSync(installed, original);
    const wer = path.join(path.dirname(installed), 'electron_wer.dll');
    if (existsSync(wer)) copyFileSync(wer, path.join(path.dirname(original), 'electron_wer.dll'));
    const { ensureDesktopIdentity } = await import(
      pathToFileURL(path.join(fixture, 'packages/runtime/src/host/desktop-identity.mjs')).href
    );
    const hash = () => createHash('sha256').update(readFileSync(original)).digest('hex');
    const before = hash();
    const executable = await ensureDesktopIdentity(original);
    assert.equal(path.basename(executable), 'Capri.exe');
    assert.equal(path.dirname(executable), path.dirname(original));
    const modified = statSync(executable).mtimeMs;
    assert.equal(await ensureDesktopIdentity(original), executable);
    assert.equal(statSync(executable).mtimeMs, modified, 'A normal launch reuses the receipt');
    assert.equal(hash(), before);
    const encoded = Buffer.from(executable, 'utf16le').toString('base64');
    const command = `$file=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); (Get-Item -LiteralPath $file).VersionInfo | Select-Object FileDescription,ProductName | ConvertTo-Json -Compress`;
    const info = JSON.parse(
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        encoding: 'utf8',
      }),
    );
    assert.equal(info.FileDescription, 'Capri');
    assert.equal(info.ProductName, 'Capri');
  },
);
