import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  MEMORY_ESTIMATES,
  dedicatedGpu,
  estimateMemoryBudget,
  profileRamRequirement,
} from '../packages/runtime/src/hardware/memory-budget.mjs';
import { selectModelChoice } from '../packages/runtime/src/hardware/model-catalog.mjs';
const hardware = {
  ramBytes: 16 * 2 ** 30,
  availableRamBytes: 10 * 2 ** 30,
  gpus: [{ memoryKind: 'dedicated', vramMiB: 12288, freeVramMiB: 10240 }],
};
const selection = {
  profile: 'balanced',
  downloadModels: true,
  recognition: false,
  router: false,
  voiceMode: 'off',
  conversationLanguage: 'en',
};

test('dedicated GPU selection preserves stable ties, unknown memory and sparse inventories', () => {
  const first = Object.freeze({ memoryKind: 'dedicated', vramMiB: 8192 });
  const second = Object.freeze({ memoryKind: 'dedicated', vramMiB: 8192 });
  const cards = Object.freeze([
    ,
    { memoryKind: 'shared', vramMiB: 32768 },
    { memoryKind: 'dedicated', vramMiB: NaN },
    { memoryKind: 'dedicated', vramMiB: Infinity },
    { memoryKind: 'dedicated', vramMiB: 0 },
    first,
    second,
    { memoryKind: 'dedicated', vramMiB: 4096 },
  ]);
  assert.equal(dedicatedGpu({ gpus: cards }), first);
  for (const value of [{}, { gpus: null }, { gpus: [] }]) assert.equal(dedicatedGpu(value), null);
  assert.equal(cards[5], first);
  assert.equal(cards[6], second);
});

test('single-pass GPU selection matches the prior largest-card rule across varied inventories', () => {
  let seed = 2048;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let count = 0; count < 200; count++) {
    const gpus = Object.freeze(
      Array.from({ length: random() % 21 }, () =>
        Object.freeze({
          memoryKind: ['dedicated', 'shared', 'unknown'][random() % 3],
          vramMiB: [null, undefined, NaN, Infinity, -1, 0, 4096, 8192, 8192, 16384][random() % 10],
        }),
      ),
    );
    const previous =
      gpus
        .filter(
          (gpu) =>
            gpu.memoryKind === 'dedicated' && Number.isFinite(gpu.vramMiB) && gpu.vramMiB > 0,
        )
        .sort((a, b) => b.vramMiB - a.vramMiB)[0] ?? null;
    assert.equal(dedicatedGpu({ gpus }), previous);
  }
});

test('GPU-resident text does not require the CPU-offload RAM target; multiple GPUs are not summed', () => {
  assert.equal(selectModelChoice('quality', hardware).id, 'quality');
  assert.throws(() => selectModelChoice('quality', { ...hardware, gpus: [] }), /32 GiB RAM/);
  assert.throws(
    () =>
      selectModelChoice('quality', {
        ...hardware,
        gpus: [
          { memoryKind: 'dedicated', vramMiB: 6144 },
          { memoryKind: 'dedicated', vramMiB: 6144 },
        ],
      }),
    /32 GiB RAM/,
  );
  assert.equal(
    profileRamRequirement({ id: 'quality', ramGiB: 32, recommendedVramGiB: 12 }, hardware),
    16,
  );
});
test('each selection changes the appropriate memory pool; unknown capacity stays unknown and shortages are visible', () => {
  const base = estimateMemoryBudget(selection, hardware);
  const asr = estimateMemoryBudget({ ...selection, recognition: true }, hardware);
  assert(asr.ram.estimate[1] > base.ram.estimate[1]);
  assert.deepEqual(asr.vram.estimate, base.vram.estimate);
  const voice = estimateMemoryBudget({ ...selection, voiceMode: 'bundled' }, hardware);
  assert(voice.vram.estimate[1] > base.vram.estimate[1]);
  const deferred = estimateMemoryBudget({ ...selection, downloadModels: false }, hardware);
  assert(deferred.vram.estimate[1] < base.vram.estimate[1]);
  const all = estimateMemoryBudget(
    {
      ...selection,
      voiceMode: 'bundled',
      recognition: true,
      router: true,
      conversationLanguage: 'ru',
    },
    hardware,
  );
  assert.equal(all.offload, true);
  assert.equal(all.ram.exceedsAvailable, true);
  assert(all.ram.remaining[0] < 0);
  const unknown = estimateMemoryBudget(selection, {
    ramBytes: 8 * 2 ** 30,
    gpus: [{ memoryKind: 'shared', vramMiB: 8192 }],
  });
  assert.equal(unknown.mode, 'cpu');
  assert.equal(unknown.vram.remaining, null);
  assert.equal(unknown.ram.available, null);
  assert(unknown.ram.estimate[1] > base.ram.estimate[1]);
  const occupied = estimateMemoryBudget(selection, {
    ...hardware,
    gpus: [{ ...hardware.gpus[0], freeVramMiB: 0 }],
  });
  assert.equal(occupied.vram.available, 0);
  assert.equal(occupied.offload, true);
  const unknownFree = estimateMemoryBudget(
    { ...selection, profile: 'quality' },
    {
      ...hardware,
      gpus: [{ memoryKind: 'dedicated', vramMiB: 6144 }],
    },
  );
  assert.equal(unknownFree.vram.available, null);
  assert.equal(unknownFree.vram.exceedsAvailable, true);
});
test(
  'native pre-Node wizard and runtime produce identical budgets for GPU, CPU, unknown and over-budget selections',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = path.resolve('.runtime/memory-budget-tests');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const cases = [
      { s: selection, h: hardware },
      {
        s: {
          ...selection,
          profile: 'quality',
          voiceMode: 'bundled',
          recognition: true,
          router: true,
          conversationLanguage: 'ru',
        },
        h: hardware,
      },
      { s: { ...selection, downloadModels: false }, h: { ramBytes: 8 * 2 ** 30, gpus: [] } },
      {
        s: { ...selection, profile: 'gemma4-e2b' },
        h: { ...hardware, gpus: [{ ...hardware.gpus[0], freeVramMiB: 0 }] },
      },
      {
        s: { ...selection, profile: 'quality' },
        h: { ...hardware, gpus: [{ memoryKind: 'dedicated', vramMiB: 6144 }] },
      },
    ];
    const native = cases.map(({ s, h }) => ({
      selection: s,
      hardware: {
        ramGiB: h.ramBytes / 2 ** 30,
        availableRamGiB: h.availableRamBytes === undefined ? null : h.availableRamBytes / 2 ** 30,
        vramGiB: h.gpus[0]?.vramMiB / 1024 || 0,
        availableVramGiB:
          h.gpus[0]?.freeVramMiB === undefined ? null : h.gpus[0].freeVramMiB / 1024,
      },
    }));
    writeFileSync(path.join(folder, 'cases.json'), JSON.stringify(native));
    writeFileSync(
      path.join(folder, 'check.ps1'),
      `param($Cases,$Root)
. (Join-Path $Root 'packages/installer/windows/common.ps1')
. (Join-Path $Root 'packages/installer/windows/memory-budget.ps1')
$e=Read-CapriJson (Join-Path $Root 'config/memory-estimates.json')
@((Read-CapriJson $Cases)|ForEach-Object {Get-CapriMemoryBudget $_.selection $_.hardware $e})|ConvertTo-Json -Depth 12 -Compress`,
    );
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(folder, 'check.ps1'),
        '-Cases',
        path.join(folder, 'cases.json'),
        '-Root',
        process.cwd(),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout),
      cases.map(({ s, h }) => estimateMemoryBudget(s, h)),
    );
    assert.equal(MEMORY_ESTIMATES.contextTokens, 32768);
  },
);
