// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeGpuInventory,
  parseNvidia,
  parseWindowsGpuInventory,
  probeHardware,
} from '../packages/runtime/src/hardware/probe.mjs';
import { recommendProfile } from '../packages/runtime/src/hardware/profiles.mjs';
import { selectModelChoice } from '../packages/runtime/src/hardware/model-catalog.mjs';
import { estimateMemoryBudget } from '../packages/runtime/src/hardware/memory-budget.mjs';

const amd = (vramMiB, extra = {}) => ({
  name: 'AMD Radeon RX 9060 XT',
  vendor: 'amd',
  vramMiB,
  memoryKind: 'dedicated',
  luid: '0x00000001_0x00000002',
  freeVramMiB: null,
  ...extra,
});
const inventory = (adapters) => JSON.stringify({ success: true, adapters });
const host = (gpus, ramGiB = 16) => ({
  ramBytes: ramGiB * 2 ** 30,
  availableRamBytes: 10 * 2 ** 30,
  cpuThreads: 12,
  gpus,
});
const selection = {
  profile: 'quality',
  downloadModels: true,
  recognition: false,
  router: false,
  voiceMode: 'off',
  conversationLanguage: 'en',
};

async function probe({ dxgi = inventory([]), wmi = '[]', nvidia, platform = 'win32' } = {}) {
  const calls = [];
  const env = { SystemRoot: 'C:\\Windows' };
  const report = await probeHardware({
    env,
    platform,
    arch: 'x64',
    locateExecutable: (name) =>
      name === 'powershell' ? 'powershell.exe' : nvidia === undefined ? null : 'nvidia-smi.exe',
    runCommand: async (file, args, options) => {
      calls.push({ file, args, options });
      const answer = file === 'nvidia-smi.exe' ? nvidia : args.includes('-File') ? dxgi : wmi;
      if (answer instanceof Error) throw answer;
      return { stdout: answer };
    },
  });
  return { report, calls, env };
}

test('RX 9060 XT 8 and 16 GiB capacities are not truncated to WMI AdapterRAM', () => {
  const small = parseWindowsGpuInventory(inventory([amd(8192)]));
  const large = parseWindowsGpuInventory(inventory([amd(16384)]));
  assert.equal(small[0].vramMiB, 8192);
  assert.equal(large[0].vramMiB, 16384);
  assert.equal(large[0].vendor, 'amd');
  assert.equal(large[0].memoryKind, 'dedicated');
  assert.equal(large[0].cudaCandidate, false);
  assert.equal(recommendProfile(host(small)).profile.id, 'desktop');
  assert.equal(recommendProfile(host(large)).profile.id, 'quality');
  assert.equal(selectModelChoice('quality', host(large)).id, 'quality');
  assert.throws(() => selectModelChoice('quality', host(small)), /32 GiB RAM/);
  assert.throws(() => selectModelChoice('quality', host(large, 8)), /16 GiB RAM/);
  const budget = estimateMemoryBudget(selection, host(large));
  assert.equal(budget.mode, 'gpu');
  assert.equal(budget.vram.total, 16);
  assert.equal(budget.vram.available, null);
  assert.equal(budget.vram.remaining, null);
});

test('hybrid graphics never promote shared system memory or sum multiple cards', () => {
  const gpus = parseWindowsGpuInventory(
    inventory([
      {
        name: 'AMD Radeon Graphics',
        vendor: 'amd',
        vramMiB: 32768,
        memoryKind: 'shared',
        freeVramMiB: 30000,
        luid: '0x00000001_0x00000001',
      },
      amd(8192),
      amd(8192, { luid: '0x00000001_0x00000003' }),
    ]),
  );
  assert.equal(gpus.length, 3);
  assert.equal(gpus[0].memoryKind, 'shared');
  assert.equal(gpus[0].freeVramMiB, null);
  assert.equal(recommendProfile(host(gpus)).profile.id, 'desktop');
  assert.throws(() => selectModelChoice('quality', host(gpus)), /32 GiB RAM/);
  assert.equal(estimateMemoryBudget(selection, host(gpus)).vram.total, 8);
});

test('unknown capacity remains unknown and free VRAM is never invented', () => {
  const gpus = parseWindowsGpuInventory(
    inventory([
      amd(null),
      amd('16384', { luid: '0x00000001_0x00000003' }),
      amd(16384, { memoryKind: 'unknown', luid: '0x00000001_0x00000004' }),
    ]),
  );
  assert.deepEqual(
    gpus.map((gpu) => gpu.memoryKind),
    ['unknown', 'unknown', 'unknown'],
  );
  assert.deepEqual(
    gpus.map((gpu) => gpu.freeVramMiB),
    [null, null, null],
  );
  const budget = estimateMemoryBudget(selection, host(gpus));
  assert.equal(budget.mode, 'cpu');
  assert.equal(budget.vram.total, null);
  assert.equal(budget.vram.available, null);
});

test('only an explicit valid global free-memory measurement is retained, including zero', () => {
  for (const [input, expected] of [
    [null, null],
    [undefined, null],
    [-1, null],
    [20000, null],
    ['8000', null],
    [0, 0],
    [8000, 8000],
  ]) {
    const gpu = parseWindowsGpuInventory(inventory([amd(16384, { freeVramMiB: input })]))[0];
    assert.equal(gpu.freeVramMiB, expected);
  }
  for (const luid of [null, undefined, 'invalid-luid']) {
    const gpu = parseWindowsGpuInventory(inventory([amd(16384, { luid, freeVramMiB: 8000 })]))[0];
    assert.equal(gpu.freeVramMiB, null);
  }
});

test('software, remote, malformed adapters and duplicate LUIDs do not create fake cards', () => {
  const gpus = parseWindowsGpuInventory(
    inventory([
      null,
      'malformed',
      amd(16384, { name: '' }),
      amd(16384, { name: 'Invalid\nname' }),
      amd(16384, { software: true }),
      amd(16384, { remote: true }),
      amd(16384, { name: 'Microsoft Basic Render Driver' }),
      amd(16384, { name: 'Microsoft Remote Display Adapter' }),
      amd(16384, { luid: '0x000000ab_0x000000cd' }),
      amd(16384, { luid: '0x000000AB_0x000000CD' }),
    ]),
  );
  assert.equal(gpus.length, 1);
  assert.equal(gpus[0].luid, '0x000000AB_0x000000CD');
});

test('NVIDIA driver sizing and metadata win without duplicating its Windows adapter', () => {
  const windows = parseWindowsGpuInventory(
    inventory([
      {
        name: 'NVIDIA® GeForce™ RTX Test',
        vendor: 'nvidia',
        memoryKind: 'dedicated',
        vramMiB: 12288,
        freeVramMiB: 8000,
        luid: '0x00000001_0x00000002',
      },
    ]),
  );
  const nvidia = parseNvidia('NVIDIA GeForce RTX Test, 12282, 590.00');
  const merged = mergeGpuInventory(windows, nvidia);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].vramMiB, 12282);
  assert.equal(merged[0].driver, '590.00');
  assert.equal(merged[0].cudaCandidate, true);
  assert.equal(merged[0].freeVramMiB, 8000);
  assert.equal(merged[0].luid, windows[0].luid);
  assert.deepEqual(parseNvidia('NVIDIA RTX Test, N/A, 590.00'), []);
  assert.deepEqual(parseNvidia('NVIDIA RTX Test, -1, 590.00'), []);
  assert.deepEqual(parseNvidia(null), []);
});

test('identical NVIDIA models remain separate physical cards and prefer exact LUID matches', () => {
  const windows = parseWindowsGpuInventory(
    inventory([
      { ...amd(8192), name: 'NVIDIA Test', vendor: 'nvidia' },
      { ...amd(8192), name: 'NVIDIA Test', vendor: 'nvidia', luid: '0x00000001_0x00000003' },
    ]),
  );
  const nvidia = parseNvidia('NVIDIA Test, 8190, 590.00\nNVIDIA Test, 8190, 590.00');
  nvidia[0].luid = windows[1].luid;
  nvidia[1].luid = windows[0].luid;
  const merged = mergeGpuInventory(windows, nvidia);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].luid, windows[1].luid);
  assert.equal(merged[1].luid, windows[0].luid);
  assert.throws(() => selectModelChoice('quality', host(merged)), /32 GiB RAM/);
});

test('same-name NVIDIA 8/16 GiB cards match by capacity when enumeration orders differ', () => {
  const windows = parseWindowsGpuInventory(
    inventory([
      { ...amd(8192, { freeVramMiB: 7168 }), name: 'NVIDIA Test', vendor: 'nvidia' },
      {
        ...amd(16384, { freeVramMiB: 15360, luid: '0x00000001_0x00000003' }),
        name: 'NVIDIA Test',
        vendor: 'nvidia',
      },
    ]),
  );
  const merged = mergeGpuInventory(
    windows,
    parseNvidia('NVIDIA Test, 16380, 590.00\nNVIDIA Test, 8190, 590.00'),
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((gpu) => [gpu.vramMiB, gpu.luid, gpu.freeVramMiB]),
    [
      [16380, windows[1].luid, 15360],
      [8190, windows[0].luid, 7168],
    ],
  );
});

test('ambiguous equal-capacity NVIDIA cards keep their original DXGI identities and counters', () => {
  const windows = parseWindowsGpuInventory(
    inventory([
      { ...amd(16384, { freeVramMiB: 8000 }), name: 'NVIDIA Test', vendor: 'nvidia' },
      {
        ...amd(16384, { freeVramMiB: 9000, luid: '0x00000001_0x00000003' }),
        name: 'NVIDIA Test',
        vendor: 'nvidia',
      },
    ]),
  );
  const merged = mergeGpuInventory(
    windows,
    parseNvidia('NVIDIA Test, 16380, 590.00\nNVIDIA Test, 16380, 590.00'),
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged, windows);
  assert.equal(estimateMemoryBudget(selection, host(merged)).vram.total, 16);
});

test('ambiguous unknown UMA classification retains SMI capacity without guessing adapter identity', () => {
  const windows = parseWindowsGpuInventory(
    inventory([
      { ...amd(16384, { memoryKind: 'unknown' }), name: 'NVIDIA Test', vendor: 'nvidia' },
      {
        ...amd(16384, { memoryKind: 'unknown', luid: '0x00000001_0x00000003' }),
        name: 'NVIDIA Test',
        vendor: 'nvidia',
      },
    ]),
  );
  const merged = mergeGpuInventory(
    windows,
    parseNvidia('NVIDIA Test, 16380, 590.00\nNVIDIA Test, 16380, 590.00'),
  );
  assert.equal(merged.length, 2);
  for (const gpu of merged) {
    assert.equal(gpu.vramMiB, 16380);
    assert.equal(gpu.memoryKind, 'dedicated');
    assert.equal(gpu.luid, null);
    assert.equal(gpu.freeVramMiB, null);
  }
  assert.equal(recommendProfile(host(merged)).profile.id, 'quality');
});

test('ambiguous inventories with unequal counts retain the larger physical count without summing', () => {
  const windows = parseWindowsGpuInventory(
    inventory([
      { ...amd(16384), name: 'NVIDIA Test', vendor: 'nvidia' },
      { ...amd(16384, { luid: '0x00000001_0x00000003' }), name: 'NVIDIA Test', vendor: 'nvidia' },
    ]),
  );
  const nvidia = parseNvidia('NVIDIA Test, 16380, 590.00\nNVIDIA Test, 16380, 590.00');
  assert.equal(mergeGpuInventory(windows, nvidia.slice(0, 1)).length, 2);
  const excess = mergeGpuInventory(windows.slice(0, 1), nvidia);
  assert.equal(excess.length, 2);
  assert.equal(excess.filter((gpu) => gpu.luid === null).length, 1);
  assert.equal(estimateMemoryBudget(selection, host(excess)).vram.total, 16);
});

test('Windows discovery uses a fixed helper file and bounded hidden noninteractive processes', async () => {
  const { report, calls, env } = await probe({ dxgi: inventory([amd(16384)]) });
  assert.equal(report.gpus[0].vramMiB, 16384);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.file, 'powershell.exe');
  assert.deepEqual(call.args.slice(0, 5), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
  ]);
  assert.match(
    call.args[5].replaceAll('\\', '/'),
    /\/packages\/installer\/windows\/gpu-inventory\.ps1$/,
  );
  assert.equal(call.args[6], '-Json');
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.timeout, 5000);
  assert.equal(call.options.maxBuffer, 65536);
  assert.equal(call.options.env, env);
  assert.equal(report.warnings.length, 0);
});

test('an authoritative successful empty DXGI inventory never invokes WMI', async () => {
  const { report, calls } = await probe();
  assert.deepEqual(report.gpus, []);
  assert.equal(calls.length, 1);
  assert.equal(report.warnings.length, 0);
});

test('DXGI failure falls back to names only, preserving NVIDIA and never trusting WMI AdapterRAM', async () => {
  for (const dxgi of [
    new Error('Synthetic DXGI unavailable'),
    '{"success":false,"adapters":[]}',
    '{"success":true,"adapters":null}',
    'not json',
  ]) {
    const { report, calls } = await probe({
      dxgi,
      nvidia: 'NVIDIA Test, 12282, 590.00',
      wmi: JSON.stringify(['NVIDIA Test', 'AMD Radeon RX 9060 XT', 'AMD Radeon RX 9060 XT']),
    });
    assert.equal(report.gpus.length, 2);
    assert.equal(report.gpus[0].vramMiB, 12282);
    assert.equal(report.gpus[1].vramMiB, null);
    assert.equal(report.gpus[1].memoryKind, 'unknown');
    assert.equal(report.gpus[1].freeVramMiB, null);
    assert.equal(report.warnings.length, 1);
    const fallback = calls.find((call) => call.args.includes('-Command'));
    assert.match(fallback.args.at(-1), /Select-Object -ExpandProperty Name/);
    assert.doesNotMatch(fallback.args.at(-1), /AdapterRAM/);
  }
});

test('missing Windows tools and a failed NVIDIA query remain conservative', async () => {
  const { report } = await probe({
    dxgi: new Error('Synthetic missing helper'),
    wmi: new Error('Synthetic unavailable WMI'),
    nvidia: new Error('Synthetic unavailable NVIDIA query'),
  });
  assert.deepEqual(report.gpus, []);
  assert.equal(report.warnings.length, 3);
});

test('non-Windows probing keeps NVIDIA support and does not invoke PowerShell', async () => {
  const { report, calls } = await probe({
    platform: 'linux',
    nvidia: 'NVIDIA Test, 12282, 590.00',
  });
  assert.equal(report.gpus[0].vramMiB, 12282);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'nvidia-smi.exe');
  assert.equal(report.warnings.length, 1);
});
