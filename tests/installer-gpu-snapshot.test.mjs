// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test(
  'native installer selects one confirmed GPU, preserves NVIDIA telemetry and clears stale capacity',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const parent = path.resolve('.runtime/installer-gpu-snapshot');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'fixture-'));
    const card = (name, vendor, vramMiB, freeVramMiB = null, memoryKind = 'dedicated') => ({
      name,
      vendor,
      vramMiB,
      freeVramMiB,
      memoryKind,
      luid: null,
    });
    const amd = card('AMD Radeon RX 9060 XT', 'amd', 16384, 8192);
    const intel = card('Intel integrated fixture', 'intel', 32768, null, 'shared');
    const nvidia = card('NVIDIA fixture', 'nvidia', 12288, 10240);
    const cases = [
      { cards: [intel, amd], expected: [16, 8, amd.name], smi: 'NVIDIA fixture, 24576, 24000' },
      { cards: [{ ...amd, vramMiB: 8192, freeVramMiB: null }], expected: [8, null, amd.name] },
      {
        cards: [
          { ...amd, vramMiB: 8192 },
          { ...amd, freeVramMiB: 32768 },
        ],
        expected: [16, null, amd.name],
      },
      { cards: [intel], expected: [0, null, null] },
      { cards: [], failure: true, smi: 'NVIDIA fixture, 12288, 0', expected: [12, 0, nvidia.name] },
      {
        cards: [nvidia],
        smi: 'Other NVIDIA fixture, 24576, 20000',
        expected: [12, 10, nvidia.name],
      },
      { cards: [nvidia], smi: 'NVIDIA fixture, 12288, 6144', expected: [12, 6, nvidia.name] },
      { cards: [amd], refresh: [], expected: [0, null, null] },
    ];
    writeFileSync(path.join(folder, 'cases.json'), JSON.stringify(cases));
    copyFileSync(
      'packages/installer/windows/memory-budget.ps1',
      path.join(folder, 'memory-budget.ps1'),
    );
    writeFileSync(
      path.join(folder, 'gpu-inventory.ps1'),
      `
function Get-CapriGpuInventory {
    if($script:fixtureFailure){throw 'Synthetic inventory failure'}
    return @($script:fixtureAdapters)
}
`,
    );
    writeFileSync(
      path.join(folder, 'check.ps1'),
      `
param($Root)
. (Join-Path $Root 'packages/installer/windows/common.ps1')
. (Join-Path $PSScriptRoot 'memory-budget.ps1')
$script:smiPath=Join-Path $PSScriptRoot 'smi-fixture.exe'
Add-Type -OutputAssembly $script:smiPath -OutputType ConsoleApplication -TypeDefinition @'
using System;
public static class Fixture { public static void Main() { Console.Write(Environment.GetEnvironmentVariable("CAPRI_TEST_SMI")); } }
'@
function Get-Command($Name) {
    if($Name -ne 'nvidia-smi.exe'){throw 'Unexpected external tool lookup'}
    if($env:CAPRI_TEST_SMI){return [PSCustomObject]@{Source=$script:smiPath}}
    return $null
}
$results=@(foreach($case in (Read-CapriJson (Join-Path $PSScriptRoot 'cases.json'))) {
    $script:fixtureAdapters=@($case.cards)
    $script:fixtureFailure=($case.PSObject.Properties.Name -contains 'failure') -and $case.failure
    $env:CAPRI_TEST_SMI=if($case.PSObject.Properties.Name -contains 'smi'){$case.smi}else{''}
    $hardware=@{gpu='';vramGiB=99;availableVramGiB=98;ramGiB=16;availableRamGiB=$null}
    Update-CapriMemorySnapshot $hardware
    if($case.PSObject.Properties.Name -contains 'refresh') {
        $script:fixtureAdapters=@($case.refresh)
        Update-CapriMemorySnapshot $hardware
    }
    ,@($hardware.vramGiB,$hardware.availableVramGiB,$(if($hardware.selectedGpu){$hardware.selectedGpu.name}else{$null}))
})
ConvertTo-Json -InputObject $results -Depth 8 -Compress
`,
    );
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(folder, 'check.ps1'),
        '-Root',
        process.cwd(),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout.trim()),
      cases.map(({ expected }) => expected),
    );
  },
);
