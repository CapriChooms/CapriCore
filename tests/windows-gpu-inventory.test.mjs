// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root } from '../packages/runtime/src/host/paths.mjs';

const parent = path.join(root, '.runtime/windows-gpu-inventory-unit');
const temporary = path.join(parent, 'tmp');
mkdirSync(temporary, { recursive: true });
const native = path.join(root, 'packages/installer/windows/gpu-inventory.cs');
const wrapper = path.join(root, 'packages/installer/windows/gpu-inventory.ps1');
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
function run(args) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, TEMP: temporary, TMP: temporary },
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout.trim());
}
function adapter(overrides = {}) {
  return {
    Name: 'AMD Radeon RX 9060 XT',
    VendorId: 0x1002,
    DedicatedVideoBytes: 8 * GiB,
    DedicatedSystemBytes: 2 * GiB,
    SharedSystemBytes: 32 * GiB,
    Flags: 0,
    LuidHigh: 0,
    LuidLow: 0x1234,
    Uma: false,
    NodeCount: 1,
    ...overrides,
  };
}
const counter = (Instance, usedGiB) => ({ Instance, DedicatedUsageBytes: usedGiB * GiB });
const matching = (usedGiB) => counter('luid_0x00000000_0x00001234_phys_0', usedGiB);

test(
  'native DXGI normalization preserves 64-bit AMD capacity, UMA identity and independent adapters',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const inputs = [
      { id: 'amd8', facts: [adapter()], counters: [matching(2)] },
      {
        id: 'amd16',
        facts: [adapter({ DedicatedVideoBytes: 16 * GiB })],
        counters: [matching(3)],
      },
      {
        id: 'uma',
        facts: [
          adapter({
            Name: 'AMD Radeon integrated fixture',
            DedicatedVideoBytes: 128 * MiB,
            Uma: true,
          }),
        ],
        counters: [matching(0)],
      },
      {
        id: 'unknown',
        facts: [adapter({ Uma: null })],
        counters: [matching(1)],
      },
      {
        id: 'multiple',
        facts: [
          adapter({
            Name: 'Intel integrated fixture',
            VendorId: 0x8086,
            DedicatedVideoBytes: 64 * MiB,
            Uma: true,
            LuidLow: 1,
          }),
          adapter({ DedicatedVideoBytes: 16 * GiB, LuidLow: 2 }),
          adapter({
            Name: 'NVIDIA dedicated fixture',
            VendorId: 0x10de,
            DedicatedVideoBytes: 12 * GiB,
            LuidLow: 3,
          }),
          adapter({ Name: 'Intel discrete fixture', VendorId: 0x8086, LuidLow: 4 }),
        ],
        counters: [counter('luid_0x00000000_0x00000002_phys_0', 4)],
      },
      {
        id: 'filtered',
        facts: [
          adapter({ Flags: 2, LuidLow: 1 }),
          adapter({ Flags: 1, LuidLow: 2 }),
          adapter({ Name: ' \n\t ', LuidLow: 3 }),
          adapter({ Name: ' GPU\nfixture\u0000 ', VendorId: 0x1234, LuidLow: 4 }),
        ],
      },
      { id: 'missing', facts: [adapter()] },
      { id: 'busy', facts: [adapter()], counters: [matching(8)] },
      { id: 'unused', facts: [adapter()], counters: [matching(0)] },
      { id: 'invalidUsage', facts: [adapter()], counters: [matching(9)] },
      {
        id: 'wrongHighLuid',
        facts: [adapter({ LuidHigh: 1 })],
        counters: [matching(1)],
      },
      {
        id: 'multiplePhysical',
        facts: [adapter()],
        counters: [matching(1), counter('luid_0x00000000_0x00001234_phys_1', 1)],
      },
      {
        id: 'linkedAdapter',
        facts: [adapter({ NodeCount: 2 })],
        counters: [matching(1)],
      },
      {
        id: 'processCounter',
        facts: [adapter()],
        counters: [counter('pid_123_luid_0x00000000_0x00001234_phys_0', 1)],
      },
      { id: 'empty', facts: [], counters: [] },
    ];
    const inputFile = path.join(folder, 'inputs.json');
    writeFileSync(inputFile, JSON.stringify(inputs));
    const script = path.join(folder, 'normalize.ps1');
    writeFileSync(
      script,
      String.raw`param($Source,$Inputs)
$ErrorActionPreference='Stop'
Add-Type -Path $Source
$cases=Get-Content -LiteralPath $Inputs -Raw -Encoding UTF8|ConvertFrom-Json
$output=@(foreach($case in $cases){
    $facts=@(foreach($inputFact in $case.facts){
        $fact=New-Object Capri.Setup.GpuAdapterFacts
        foreach($property in $inputFact.PSObject.Properties){$fact.($property.Name)=$property.Value}
        $fact
    })
    $counters=@(foreach($inputCounter in $case.counters){
        $counter=New-Object Capri.Setup.GpuMemoryCounter
        $counter.Instance=$inputCounter.Instance
        $counter.DedicatedUsageBytes=$inputCounter.DedicatedUsageBytes
        $counter
    })
    @{id=$case.id;adapters=@([Capri.Setup.GpuInventory]::FromFacts($facts,$counters))}
})
$descriptor=[Capri.Setup.GpuInventory].GetNestedType('AdapterDesc',[Reflection.BindingFlags]::NonPublic)
@{cases=$output;pointerBytes=[IntPtr]::Size;descriptorBytes=[Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($descriptor));dedicatedOffset=[Runtime.InteropServices.Marshal]::OffsetOf($descriptor,'DedicatedVideoMemory').ToInt32()}|ConvertTo-Json -Depth 8 -Compress
`,
    );
    const result = run(['-File', script, native, inputFile]);
    assert.equal(result.pointerBytes, 8);
    assert.equal(result.descriptorBytes, 312);
    assert.equal(result.dedicatedOffset, 272);
    const cases = Object.fromEntries(result.cases.map((value) => [value.id, value.adapters]));
    assert.equal(cases.amd8[0].vramMiB, 8192);
    assert.equal(cases.amd8[0].freeVramMiB, 6144);
    assert.equal(cases.amd16[0].vramMiB, 16384);
    assert.equal(cases.amd16[0].freeVramMiB, 13312);
    assert.equal(cases.amd16[0].memoryKind, 'dedicated');
    assert.equal(cases.amd16[0].vendor, 'amd');
    assert.deepEqual(cases.uma[0], {
      name: 'AMD Radeon integrated fixture',
      vendor: 'amd',
      vramMiB: 128,
      memoryKind: 'shared',
      luid: '0x00000000_0x00001234',
      freeVramMiB: null,
    });
    assert.equal(cases.unknown[0].memoryKind, 'unknown');
    assert.equal(cases.unknown[0].freeVramMiB, null);
    assert.deepEqual(
      cases.multiple.map((gpu) => gpu.vramMiB),
      [64, 16384, 12288, 8192],
    );
    assert.deepEqual(
      cases.multiple.map((gpu) => gpu.vendor),
      ['intel', 'amd', 'nvidia', 'intel'],
    );
    assert.deepEqual(
      cases.multiple.map((gpu) => gpu.memoryKind),
      ['shared', 'dedicated', 'dedicated', 'dedicated'],
    );
    assert.deepEqual(
      cases.multiple.map((gpu) => gpu.freeVramMiB),
      [null, 12288, null, null],
    );
    assert.equal(cases.filtered.length, 1);
    assert.equal(cases.filtered[0].name, 'GPU fixture');
    assert.equal(cases.filtered[0].vendor, 'other');
    assert.equal(cases.busy[0].freeVramMiB, 0);
    assert.equal(cases.unused[0].freeVramMiB, 8192);
    for (const id of [
      'missing',
      'invalidUsage',
      'wrongHighLuid',
      'multiplePhysical',
      'linkedAdapter',
      'processCounter',
    ])
      assert.equal(cases[id][0].freeVramMiB, null, id);
    assert.deepEqual(cases.empty, []);
    assert.deepEqual(Object.keys(cases.amd8[0]).sort(), [
      'freeVramMiB',
      'luid',
      'memoryKind',
      'name',
      'vendor',
      'vramMiB',
    ]);
  },
);

test(
  'GPU JSON wrapper returns a bounded hardware-only envelope',
  { skip: process.platform !== 'win32' },
  () => {
    const result = run(['-File', wrapper, '-Json']);
    assert.equal(typeof result.success, 'boolean');
    assert.ok(Array.isArray(result.adapters));
    for (const gpu of result.adapters) {
      assert.ok(['amd', 'nvidia', 'intel', 'other'].includes(gpu.vendor));
      assert.ok(['dedicated', 'shared', 'unknown'].includes(gpu.memoryKind));
      assert.match(gpu.luid, /^0x[0-9A-F]{8}_0x[0-9A-F]{8}$/);
      assert.equal(typeof gpu.vramMiB, 'number');
      assert.ok(Number.isFinite(gpu.vramMiB) && gpu.vramMiB >= 0);
      assert.ok(
        gpu.freeVramMiB === null ||
          (gpu.memoryKind === 'dedicated' &&
            Number.isFinite(gpu.freeVramMiB) &&
            gpu.freeVramMiB >= 0 &&
            gpu.freeVramMiB <= gpu.vramMiB),
      );
      assert.equal(/[\x00-\x1f\x7f]/.test(gpu.name), false);
    }
  },
);

test(
  'GPU JSON wrapper distinguishes native failure from an empty inventory without disclosing errors',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'missing-native-'));
    const script = path.join(folder, 'gpu-inventory.ps1');
    copyFileSync(wrapper, script);
    assert.deepEqual(run(['-File', script, '-Json']), { success: false, adapters: [] });
  },
);

test(
  'timed-out native and counter queries remain single-flight and completed queries refresh',
  { skip: process.platform !== 'win32' },
  () => {
    const folder = mkdtempSync(path.join(parent, 'single-flight-'));
    const script = path.join(folder, 'single-flight.ps1');
    writeFileSync(
      script,
      String.raw`param($Source)
$ErrorActionPreference='Stop'
Add-Type -Path $Source
$type=[Capri.Setup.GpuInventory]
$flags=[Reflection.BindingFlags]'Static,NonPublic'
$inventoryField=$type.GetField('activeInventory',$flags)
$counterField=$type.GetField('activeCounters',$flags)
$readCounters=$type.GetMethod('ReadCounters',$flags)
$completion=[Threading.Tasks.TaskCompletionSource[object]].GetGenericTypeDefinition()
$inventoryPending=[Activator]::CreateInstance($completion.MakeGenericType(@([Capri.Setup.GpuHardware[]])))
$counterPending=[Activator]::CreateInstance($completion.MakeGenericType(@([Capri.Setup.GpuMemoryCounter[]])))
$inventoryField.SetValue($null,$inventoryPending.Task)
$counterField.SetValue($null,$counterPending.Task)
$inventoryReused=$true;$counterReused=$true;$timeouts=0
1..3|ForEach-Object{
    try{[Capri.Setup.GpuInventory]::Read(250)|Out-Null}catch{
        if($_.Exception.InnerException -is [TimeoutException]){$timeouts++}else{throw}
    }
    if(-not[Object]::ReferenceEquals($inventoryField.GetValue($null),$inventoryPending.Task)){$inventoryReused=$false}
}
1..2|ForEach-Object{
    $result=$readCounters.Invoke($null,@())
    if($null -ne $result){throw 'A pending counter must stay unknown.'}
    if(-not[Object]::ReferenceEquals($counterField.GetValue($null),$counterPending.Task)){$counterReused=$false}
}
$inventoryPending.SetResult([Capri.Setup.GpuHardware[]]@())
try{[Capri.Setup.GpuInventory]::Read(250)|Out-Null}catch{}
$inventoryRefreshed=-not[Object]::ReferenceEquals($inventoryField.GetValue($null),$inventoryPending.Task)
$counterPending.SetResult([Capri.Setup.GpuMemoryCounter[]]@())
$null=$readCounters.Invoke($null,@())
$counterRefreshed=-not[Object]::ReferenceEquals($counterField.GetValue($null),$counterPending.Task)
@{timeouts=$timeouts;inventoryReused=$inventoryReused;counterReused=$counterReused;inventoryRefreshed=$inventoryRefreshed;counterRefreshed=$counterRefreshed}|ConvertTo-Json -Compress
`,
    );
    assert.deepEqual(run(['-File', script, native]), {
      timeouts: 3,
      inventoryReused: true,
      counterReused: true,
      inventoryRefreshed: true,
      counterRefreshed: true,
    });
  },
);
