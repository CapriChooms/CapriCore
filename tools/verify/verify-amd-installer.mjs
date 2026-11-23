// SPDX-License-Identifier: GPL-3.0-only
// Actual WinForms wizard and production budgeting/selection logic in a private
// source copy. Only hardware readers and the verification driver are synthetic.
// No installation, network, driver, registry or owner-data operation is started.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { sourceFiles } from '../../packages/installer/src/payload.mjs';

if (process.platform !== 'win32') throw Error('AMD installer verification requires Windows.');
const parent = path.join(root, '.runtime/amd-installer-verification');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'fixture-'));
const source = path.join(folder, 'source');
for (const name of [
  'packages/installer/windows',
  'config',
  'assets/default',
  'apps/shared',
  'packages/runtime/src/hardware',
  '.runtime',
])
  mkdirSync(path.join(source, name), { recursive: true });
const metadata = [
  'installer.json',
  'memory-estimates.json',
  'installer-languages.json',
  'interface-locales.json',
  'installer-text.json',
  'installer-progress-text.json',
  'release.json',
  'tts-catalog.json',
  'asr-model-upstream.json',
  'asr-vad-upstream.json',
  'request-router-upstream.json',
  'multilingual-candidates.json',
  'multilingual-runtime.json',
  'qwen-tts-upstream.json',
  'qwen-ru-voice.json',
  'qwen-download-sizes.json',
  'voice-model-download.json',
  'voice-training.json',
  'llama-models.json',
];
const required = new Set([
  ...metadata.map((name) => 'config/' + name),
  'package.json',
  'package-lock.json',
  'assets/default/app.ico',
  'apps/shared/languages.json',
  'packages/runtime/src/hardware/model-language-benchmark.json',
  'packages/runtime/src/hardware/llm-gpu-support.json',
]);
const approved = sourceFiles(root);
const copied = approved.filter(
  (name) => required.has(name) || name.startsWith('packages/installer/windows/'),
);
for (const name of required)
  assert(copied.includes(name), 'Required fixture input is not approved source: ' + name);
for (const name of copied) {
  assert(!/\.local\.(?:json|ps1)$/iu.test(name), 'Private configuration cannot enter a fixture.');
  const destination = path.join(source, name);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(path.join(root, name), destination);
}
const windows = path.join(source, 'packages/installer/windows');
const readPs = (name) => readFileSync(path.join(windows, name), 'utf8').replace(/^\uFEFF/u, '');
const writePs = (name, text) => writeFileSync(path.join(windows, name), '\uFEFF' + text);
let budgetSource = readPs('memory-budget.ps1');
assert(
  budgetSource.includes('$info.AvailablePhysicalMemory/1GB'),
  'RAM availability reader changed; review the fixture injection.',
);
budgetSource = budgetSource.replace(
  '$info.AvailablePhysicalMemory/1GB',
  '$script:amdFixture.availableRamGiB',
);
writePs('memory-budget.ps1', budgetSource);
writePs(
  'gpu-inventory.ps1',
  `# Private fixture hardware reader; native DXGI/registry mapping is tested separately.
function Get-CapriGpuInventory {
    param([switch]$Json)
    $cards=@($script:amdFixture.gpus)
    if($Json){return (@{success=$true;adapters=$cards}|ConvertTo-Json -Depth 12 -Compress)}
    return $cards
}
`,
);
const fixtureHeader = `# Synthetic leaf readers in this private copy only.
$script:amdFixture=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../../.runtime/amd-case.json') -Raw -Encoding UTF8|ConvertFrom-Json
function Get-CimInstance {
    [CmdletBinding()]param([Parameter(Position=0)][string]$ClassName)
    switch($ClassName){
        'Win32_ComputerSystem'{return [pscustomobject]@{TotalPhysicalMemory=([long]($script:amdFixture.ramGiB*1GB))}}
        'Win32_VideoController'{return @($script:amdFixture.gpus|ForEach-Object{[pscustomobject]@{Name=$_.name}})}
        'Win32_OperatingSystem'{return [pscustomobject]@{FreePhysicalMemory=([long]($script:amdFixture.availableRamGiB*1MB))}}
        default{throw ('Unexpected fixture hardware query: '+$ClassName)}
    }
}
`;
const capture = `
if(-not $VerificationDirectory){throw 'The AMD fixture cannot install.'}
$check=[IO.Path]::GetFullPath($VerificationDirectory)
if(-not $check.StartsWith((Join-Path $sourceRoot '.runtime')+'\\',[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture output escaped its private cache.'}
[IO.Directory]::CreateDirectory($check)|Out-Null
$form.Show();[Windows.Forms.Application]::DoEvents()
function Save-AmdFixtureWindow([string]$File){
    $form.Refresh();[Windows.Forms.Application]::DoEvents()
    $image=New-Object Drawing.Bitmap($form.Width,$form.Height)
    try{$form.DrawToBitmap($image,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));$image.Save($File)}finally{$image.Dispose()}
}
$results=New-Object Collections.Generic.List[object]
$options.target=Join-Path $check 'never-install-target'
$options.recognition=$false;$options.router=$true;$options.voiceMode='off';$options.voicePack=''
$options.inferenceMode='local';$options.modelSource='catalog';$options.downloadModels=$true
foreach($language in @('en','ru')){
    $script:installerLanguage=$language;$options.interfaceLanguage=$language
    $options.profile=$script:amdFixture.profile
    $script:page=3;Render-CapriPage;[Windows.Forms.Application]::DoEvents()
    if((Selected-Capri 'profile') -ne $script:amdFixture.profile){throw 'The selected model was changed by recommendations.'}
    Update-CapriMemoryBudgetView
    $expectedGpu=@($script:amdFixture.gpus|Where-Object{$_.vendor -eq 'amd' -and $_.memoryKind -eq 'dedicated'})[0]
    $expectedFree=if($null -ne $expectedGpu.freeVramMiB){[double]$expectedGpu.freeVramMiB/1024}else{$null}
    if($hardware.selectedGpu.name -ne $expectedGpu.name){throw 'The discrete AMD adapter was not selected.'}
    if($hardware.ramGiB -ne $script:amdFixture.ramGiB -or $hardware.vramGiB -ne $script:amdFixture.expectedVramGiB){throw 'Hardware totals are incorrect or GPU memory was summed.'}
    if($script:memoryBudget.mode -ne 'gpu'){throw 'A confirmed dedicated AMD GPU was treated as CPU-only.'}
    if($expectedFree -ne $hardware.availableVramGiB -or $expectedFree -ne $script:memoryBudget.vram.available){throw 'The reported free AMD VRAM does not match the selected adapter.'}
    if(-not $script:fields.modelHardware.Text.Contains($expectedGpu.name) -or -not $script:fields.modelHardware.Text.Contains(([string]$script:amdFixture.expectedVramGiB)+' GiB')){throw 'The actual hardware label omits AMD or its dedicated VRAM.'}
    $hasUnknown=$budgetRows.vram.detail.Text.Contains((Text-Capri 'unknown'))
    if($null -eq $expectedFree){
        if(-not $hasUnknown -or $null -ne $script:memoryBudget.vram.remaining){throw 'The UI does not mark unavailable VRAM telemetry as unknown.'}
    }else{
        if($hasUnknown -or $script:memoryBudget.vram.remaining.Count -ne 2 -or -not $budgetRows.vram.detail.Text.Contains($expectedFree.ToString('0.0')+' GiB')){throw 'The UI does not show estimated free and remaining VRAM.'}
        $savedFree=$expectedGpu.freeVramMiB
        $expectedGpu.freeVramMiB=$null
        $budgetRefresh.PerformClick()
        if($null -ne $script:memoryBudget.vram.available -or -not $budgetRows.vram.detail.Text.Contains((Text-Capri 'unknown'))){throw 'Refresh retained stale VRAM.'}
        $expectedGpu.freeVramMiB=$savedFree
        $budgetRefresh.PerformClick()
        if($expectedFree -ne $script:memoryBudget.vram.available -or $budgetRows.vram.detail.Text.Contains((Text-Capri 'unknown'))){throw 'Refresh did not restore available VRAM.'}
    }
    $selected=@($manifest.profiles|Where-Object{$_.id -eq $options.profile})[0]
    $required=Get-CapriRequiredRam $selected $hardware $memoryEstimates
    if(-not(Test-CapriProfileRam $hardware.ramGiB $required)){throw 'The selected GPU-compatible model was rejected using its CPU RAM requirement.'}
    $quality=@($manifest.profiles|Where-Object{$_.id -eq 'quality'})[0]
    $qualityRequired=Get-CapriRequiredRam $quality $hardware $memoryEstimates
    $qualitySelection=$options.Clone();$qualitySelection.profile='quality'
    $qualityBudget=Get-CapriMemoryBudget $qualitySelection $hardware $memoryEstimates
    $qualityFits=Test-CapriProfileRam $hardware.ramGiB $qualityRequired
    if($qualityFits -ne $script:amdFixture.qualityFits){throw 'The quality profile did not enforce the appropriate GPU/CPU host RAM policy.'}
    if($script:amdFixture.qualityFits -and $qualityRequired -ne $memoryEstimates.models.quality.gpuSystemRamGiB){throw 'Quality did not use gpuSystemRamGiB.'}
    if(-not $script:amdFixture.qualityFits -and $qualityRequired -ne $quality.ramGiB){throw 'Insufficient VRAM incorrectly bypassed the CPU RAM requirement.'}
    $qualityFootprint=$memoryEstimates.base.vram[1]+$memoryEstimates.models.quality.vram[1]
    $offloadLimit=if($null -ne $expectedFree){$expectedFree}else{$hardware.vramGiB}
    if($qualityBudget.offload -ne ($qualityFootprint -gt $offloadLimit)){throw 'Partial offload must follow the calibrated footprint and available memory.'}
    $choice=[string]$script:fields.profile.SelectedItem
    if(-not $choice.Contains(('RAM '+$required+'+ GiB'))){throw 'The model list shows the wrong host RAM requirement.'}
    $legacyHardware=@{ramGiB=$hardware.ramGiB;availableRamGiB=$hardware.availableRamGiB;gpu=$hardware.gpu;vramGiB=0;availableVramGiB=$null}
    $legacyBudget=Get-CapriMemoryBudget $options $legacyHardware $memoryEstimates
    $legacyRequired=Get-CapriRequiredRam $quality $legacyHardware $memoryEstimates
    if($legacyBudget.mode -ne 'cpu' -or $legacyRequired -ne $quality.ramGiB -or (Test-CapriProfileRam $legacyHardware.ramGiB $legacyRequired)){throw 'Name-only baseline no longer reproduces the original CPU-only classification.'}
    $record=@{language=$language;hardware=$hardware.Clone();selectedProfile=$options.profile;modelChoice=$choice;hardwareText=$script:fields.modelHardware.Text;budgetTitle=$budgetTitle.Text;budget=$script:memoryBudget;vramDetail=$budgetRows.vram.detail.Text;requiredRamGiB=$required;qualityRequiredRamGiB=$qualityRequired;qualityFits=$qualityFits;qualityBudget=$qualityBudget;legacyNameOnly=@{mode=$legacyBudget.mode;qualityRequiredRamGiB=$legacyRequired;qualityFits=$false};nextBefore=$script:page}
    Save-AmdFixtureWindow (Join-Path $check ($language+'-hardware.png'))
    $next.PerformClick();[Windows.Forms.Application]::DoEvents()
    if($script:page -ne 4){throw 'Native Next did not advance to components.'}
    $record.nextAfter=$script:page
    if($script:memoryBudget.mode -ne 'gpu' -or $expectedFree -ne $script:memoryBudget.vram.available){throw 'Component selection lost the AMD memory budget.'}
    Save-AmdFixtureWindow (Join-Path $check ($language+'-components.png'))
    $results.Add($record)
}
Write-CapriJson (Join-Path $check 'amd-results.json') ($results.ToArray())
$form.Close();$timer.Dispose()
Write-Output 'AMD fixture rendered real wizard pages; installation was not started.'
`;
let wizardSource = readPs('wizard-ui.ps1');
const marker = /\r?\nif\(\$VerificationDirectory\)\{\r?\n    \$check=/u.exec(wizardSource);
assert(marker, 'Native wizard verification entry changed; review the fixture driver.');
wizardSource =
  fixtureHeader +
  wizardSource
    .slice(0, marker.index)
    .replace('threads=[Environment]::ProcessorCount', 'threads=8') +
  capture;
writePs('wizard-ui.ps1', wizardSource);

const amd = (vramMiB) => ({
  name: 'AMD Radeon RX 9060 XT',
  vendor: 'amd',
  memoryKind: 'dedicated',
  vramMiB,
  freeVramMiB: null,
  luid: 'fixture-amd',
});
const cases = [
  {
    id: 'rx6600xt-8gb-available',
    ramGiB: 15.9,
    availableRamGiB: 9.8,
    profile: 'desktop',
    expectedVramGiB: 8,
    expectedFreeVramGiB: 6.5,
    qualityFits: false,
    gpus: [{ ...amd(8192), name: 'AMD Radeon RX 6600 XT', freeVramMiB: 6656 }],
  },
  {
    id: 'rx9060xt-8gb',
    ramGiB: 16,
    availableRamGiB: 14,
    profile: 'desktop',
    expectedVramGiB: 8,
    qualityFits: false,
    gpus: [amd(8192)],
  },
  {
    id: 'rx9060xt-16gb',
    ramGiB: 16,
    availableRamGiB: 14,
    profile: 'quality',
    expectedVramGiB: 16,
    qualityFits: true,
    gpus: [amd(16384)],
  },
  {
    id: 'intel-shared-plus-amd',
    ramGiB: 16,
    availableRamGiB: 14,
    profile: 'desktop',
    expectedVramGiB: 8,
    qualityFits: false,
    gpus: [
      {
        name: 'Intel(R) UHD Graphics 770',
        vendor: 'intel',
        memoryKind: 'shared',
        vramMiB: 16384,
        freeVramMiB: null,
        luid: 'fixture-intel',
      },
      amd(8192),
    ],
  },
  {
    id: 'nominal-16gb-usable-15gb',
    ramGiB: 15,
    availableRamGiB: 13.5,
    profile: 'quality',
    expectedVramGiB: 16,
    qualityFits: true,
    gpus: [amd(16384)],
  },
];
const temp = path.join(folder, 'tmp');
mkdirSync(temp);
const results = [];
for (const item of cases) {
  const output = path.join(source, '.runtime', item.id);
  writeFileSync(path.join(source, '.runtime/amd-case.json'), JSON.stringify(item));
  const run = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(windows, 'wizard.ps1'),
      '-VerificationDirectory',
      output,
      '-VerificationLanguages',
      'en,ru',
      '-VerificationDpi',
      '96',
    ],
    {
      env: { ...process.env, TEMP: temp, TMP: temp },
      windowsHide: true,
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  assert.equal(run.status, 0, run.error?.message ?? run.stderr ?? run.stdout);
  const native = JSON.parse(readFileSync(path.join(output, 'amd-results.json'), 'utf8'));
  assert.equal(native.length, 2);
  for (const value of native) {
    assert.equal(value.hardware.selectedGpu.vendor, 'amd');
    assert.equal(value.hardware.vramGiB, item.expectedVramGiB);
    assert.equal(value.budget.mode, 'gpu');
    assert.equal(value.budget.vram.total, item.expectedVramGiB);
    assert.equal(value.budget.vram.available, item.expectedFreeVramGiB ?? null);
    if (item.expectedFreeVramGiB == null) assert.equal(value.budget.vram.remaining, null);
    else assert.equal(value.budget.vram.remaining.length, 2);
    assert.equal(value.nextBefore, 3);
    assert.equal(value.nextAfter, 4);
    assert.equal(value.qualityFits, item.qualityFits);
  }
  const images = readdirSync(output).filter((name) => name.endsWith('.png'));
  assert.equal(images.length, 4);
  results.push({
    id: item.id,
    checks: native,
    images: images.map((name) => path.join(output, name)),
  });
}
const report = {
  passed: true,
  nativeCases: cases.length,
  languages: ['en', 'ru'],
  nativeHardwarePages: cases.length * 2,
  nativeComponentPages: cases.length * 2,
  installationStarted: false,
  networkUsed: false,
  ownerDataAccessed: false,
  syntheticHardwareReadersOnly: true,
  sourceAllowlist: true,
  copiedSourceFiles: copied.length,
  capture:
    'Owned WinForms DrawToBitmap; native ComboBox selected text is validated separately in JSON',
  results,
};
writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: true,
    nativeCases: cases.length,
    nativePages: cases.length * 4,
    languages: ['en', 'ru'],
    installationStarted: false,
    networkUsed: false,
    ownerDataAccessed: false,
    folder,
  }),
);
