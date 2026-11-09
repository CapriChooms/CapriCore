// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';

test(
  'Windows policy blocks are launch warnings, including wrapped localized errors, without marking installation failed',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.join(root, '.runtime/installer-app-control-tests');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
    const file = path.join(folder, 'verify.ps1');
    writeFileSync(
      file,
      '\uFEFF' +
        [
          "$ErrorActionPreference='Stop'",
          '[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)',
          '. ' + literal(path.join(root, 'packages/installer/windows/localization.ps1')),
          '$catalog=[IO.File]::ReadAllText(' +
            literal(path.join(root, 'config/installer-text.json')) +
            ')|ConvertFrom-Json',
          "$recorded='Exception calling Start: An Application Control policy has blocked this file'",
          '$typed=@(foreach($code in @(1260,4551,5,2,577)){',
          "  $inner=[ComponentModel.Win32Exception]::new($code,'Localized Windows message')",
          "  Test-CapriAppControlBlock '' ([Exception]::new('PowerShell invocation wrapper',$inner))",
          '})',
          '$localized=@(foreach($id in $catalog.PSObject.Properties.Name){',
          "  $message=Get-CapriSetupError $catalog $id $recorded 'CAPRI_APP_CONTROL_BLOCKED'",
          "  @{installed=$message.StartsWith($catalog.$id.complete);failed=$message.Contains($catalog.$id.componentFailed);code=$message.Contains('CAPRI_APP_CONTROL_BLOCKED');details=$message.Contains($recorded)}",
          '})',
          "[ordered]@{recorded=(Test-CapriAppControlBlock $recorded);typed=$typed;localized=$localized;network=(Test-CapriSetupNetworkError $recorded);ordinary=(Test-CapriAppControlBlock 'Access denied to destination folder')}|ConvertTo-Json -Depth 5 -Compress",
        ].join('\n'),
    );
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout.trim());
    assert.equal(value.recorded, true);
    assert.deepEqual(value.typed, [true, true, false, false, false]);
    assert.equal(value.network, false);
    assert.equal(value.ordinary, false);
    assert.equal(value.localized.length, 50);
    assert(value.localized.every((row) => row.installed && !row.failed && row.code && row.details));
  },
);
