// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probeResourceUsage,
  summarizeModelResidency,
} from '../apps/desktop/diagnostics/resources.mjs';

test('model residency distinguishes CPU, partial, full and unknown offload without exporting server extras', async () => {
  const result = await probeResourceUsage({
    model: 'selected-model',
    readModels: async () => ({
      models: [
        {
          name: 'selected-model',
          size: 12000,
          size_vram: 10000,
          context_length: 32768,
          prompt: 'synthetic-private-document',
          digest: 'private-file',
        },
        { name: 'other-private-name', size: 100, size_vram: 0 },
        { size: 100, size_vram: 100 },
        { size: 0, size_vram: 0 },
        { size: 10, size_vram: 20 },
      ],
      token: 'synthetic-private-token',
    }),
    readProcess: async () => ({
      ramBytes: 2000,
      vramBytes: 1000,
      pid: 777,
      file: 'synthetic-private-path',
    }),
  });
  assert.deepEqual(
    result.localModels.models.map((row) => row.offload),
    ['partial', 'cpu', 'gpu', 'unknown', 'unknown'],
  );
  assert.equal(result.localModels.models[0].selected, true);
  assert.equal(result.localModels.models[1].selected, false);
  assert.equal(result.localModels.models[0].contextTokens, 32768);
  assert.equal(result.capriProcesses.workingSetBytes, 2000);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-private|other-private|selected-model|digest|777/,
  );
});

test('missing services and invalid counters remain unknown instead of claiming a GPU or RAM leak', async () => {
  const value = await probeResourceUsage({
    readModels: async () => {
      throw Error('secret service failure');
    },
    readProcess: async () => {
      throw Error('private process details');
    },
  });
  assert.equal(value.localModels.available, false);
  assert.equal(value.capriProcesses.workingSetBytes, null);
  assert.doesNotMatch(JSON.stringify(value), /secret service|private process/);
  const invalid = summarizeModelResidency(
    { models: [{ size: -1, size_vram: Infinity, context_length: NaN }] },
    'none',
  );
  assert.equal(invalid.models[0].offload, 'unknown');
  assert.equal(invalid.models[0].totalBytes, null);
  assert.equal(invalid.models[0].gpuBytes, null);
  assert.equal(invalid.models[0].contextTokens, null);
});
