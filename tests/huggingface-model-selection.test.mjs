// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { runtime } from '../packages/runtime/src/context.mjs';
import { loadCoreSettings } from '../packages/runtime/src/config/settings.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import {
  saveModelProfile,
  saveContextWindow,
} from '../packages/runtime/src/hardware/model-profile.mjs';
import { contextChoicesFor } from '../packages/runtime/src/config/context-policy.mjs';
import { validateImportedProfile } from '../packages/runtime/src/hardware/imported-model.mjs';
import {
  IMPORTED_CHAT_ERROR,
  verifyImportedChat,
} from '../packages/runtime/src/providers/model-residency.mjs';
import { ModelService } from '../apps/desktop/model-service.mjs';

const config = JSON.parse(readFileSync(path.join(root, 'config/core.json'), 'utf8'));
const profile = {
  id: 'hf-' + 'a'.repeat(24),
  source: 'huggingface',
  family: 'fixture/model',
  model: 'capri-hf-' + 'a'.repeat(24) + ':latest',
  alias: 'capri-hf-' + 'a'.repeat(24) + ':latest',
  contextTokens: 8192,
  contextLimit: 16384,
  cpuThreads: 4,
  capabilities: [],
  ramGiB: 8,
  recommendedVramGiB: 4,
  sizeBytes: 2e9,
  experimental: true,
  memoryEstimated: true,
};
const hardware = { ramBytes: 16 * 2 ** 30, cpuThreads: 8, gpus: [] };
function description(capabilities = ['completion'], context = 16384) {
  return {
    capabilities,
    template: '{{ .Messages }}',
    model_info: {
      'general.architecture': 'llama',
      'llama.context_length': context,
    },
  };
}
function modelService(overrides = {}) {
  return new ModelService({
    rt: { ollamaUrl: 'http://127.0.0.1:11435' },
    config,
    hardware: async () => hardware,
    customProfiles: () => [profile],
    inventory: async () => ({ models: [{ name: profile.model, size: profile.sizeBytes }] }),
    ensure: async () => {},
    native: async () => {},
    probeImported: async () => {},
    describe: async () => description(),
    pull: () => assert.fail('Imported models must not be pulled by Ollama registry name'),
    ...overrides,
  });
}
function settingsFixture() {
  const parent = path.join(root, '.runtime/hf-profile-tests');
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(path.join(parent, 'case-'));
  const rt = runtime({
    stateDir: path.join(base, 'data/openclaw'),
    workspace: path.join(base, 'data/workspace'),
  });
  writeJsonAtomic(path.join(base, 'config/core.json'), config);
  writeJsonAtomic(path.join(base, 'config/core.local.json'), { generation: { temperature: 0.91 } });
  writeJsonAtomic(rt.configPath, {
    agents: { defaults: { compaction: { memoryFlush: { enabled: true } } } },
    tools: { allow: ['memory_search'] },
  });
  mkdirSync(rt.workspace, { recursive: true });
  writeFileSync(path.join(rt.workspace, 'MEMORY.md'), 'synthetic memory fixture');
  return { base, rt };
}

test('installed HF text-only models join the normal catalog and prepare without registry pull', async () => {
  let received;
  const service = modelService({
    native: async (_rt, value) => {
      received = value;
    },
  });
  const catalog = await service.refresh();
  const entry = catalog.profiles.find((item) => item.id === profile.id);
  assert.equal(entry.installed, true);
  assert.equal(entry.sizeBytes, profile.sizeBytes);
  assert.deepEqual(entry.capabilities, []);
  assert.equal((await service.prepare(profile.id)).phase, 'ready');
  assert.equal(received.contextTokens, 16384);
  assert.equal(received.thinkingDefault, 'off');
  assert.equal(service.snapshot().current, config.model);
  let committed;
  await service.apply(async (value) => {
    committed = value;
  });
  assert.equal(committed.id, profile.id);
});

test('deleted imported aliases require repair and changed capabilities cannot prepare', async () => {
  const missing = modelService({ inventory: async () => ({ models: [] }) });
  assert.match((await missing.prepare(profile.id)).error, /Repair/);
  const toolProfile = { ...profile, capabilities: ['tools'] };
  const replaced = modelService({
    customProfiles: () => [toolProfile],
    describe: async () => description(['completion']),
  });
  assert.equal((await replaced.prepare(profile.id)).phase, 'error');
  assert.equal(replaced.prepared, null);
});

test('text-only imported profiles still require real completion, template and sufficient context', async () => {
  for (const actual of [
    description(['embedding']),
    { ...description(), template: '' },
    description(['completion'], 4096),
  ]) {
    const service = modelService({ describe: async () => actual });
    assert.equal((await service.prepare(profile.id)).phase, 'error');
    assert.equal(service.prepared, null);
  }
});

test('an imported model must generate visible text with the chosen runner settings before activation', async () => {
  const candidate = { ...profile, contextLimit: 24576, capabilities: ['thinking'] };
  let received;
  let result = null;
  const service = modelService({
    config: { ...config, acceleration: 'cpu' },
    customProfiles: () => [candidate],
    describe: async () => description(['completion', 'thinking'], candidate.contextLimit),
    probeImported: (model, { signal }) =>
      verifyImportedChat(model, {
        signal,
        requestImpl: async (url, { body }) => {
          assert.equal(url, 'http://127.0.0.1:11435/api/chat');
          received = JSON.parse(body);
          if (!result) throw new Error('HTTP 500 from Ollama');
          return result;
        },
      }),
  });
  const failed = await service.prepare(profile.id);
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error, IMPORTED_CHAT_ERROR);
  assert.equal(failed.current, config.model);
  await assert.rejects(
    service.apply(() => assert.fail('A failed probe cannot commit')),
    /Prepare/,
  );
  assert.equal(received.model, candidate.alias);
  assert.equal(received.options.num_ctx, 16384);
  assert.equal(received.options.num_gpu, 0);
  assert.equal(received.keep_alive, 0);
  assert.equal(received.think, false);
  result = { done: true, message: { content: ' ', thinking: 'Hidden output' } };
  assert.equal((await service.prepare(profile.id)).phase, 'error');
  result = { done: true, message: { content: 'OK.' } };
  assert.equal((await service.prepare(profile.id)).phase, 'ready');
});

test('HF model profile persists through restart with limited context, preserved memory and rollback', () => {
  const { base, rt } = settingsFixture();
  const before = readFileSync(rt.configPath, 'utf8');
  const change = saveModelProfile({
    root: base,
    rt,
    id: profile.id,
    hardware,
    importedProfiles: [profile],
  });
  const loaded = loadCoreSettings(path.join(base, 'config'));
  assert.equal(loaded.model, profile.alias);
  assert.equal(loaded.contextTokens, 16384);
  assert.equal(loaded.modelContextLimit, 16384);
  assert.deepEqual(loaded.modelCapabilities, []);
  assert.equal(loaded.generation.temperature, 0.91);
  assert.deepEqual(contextChoicesFor(loaded), [8192, 16384]);
  saveContextWindow({ root: base, rt, contextTokens: 8192 });
  assert.equal(loadCoreSettings(path.join(base, 'config')).contextTokens, 8192);
  assert.throws(
    () => saveContextWindow({ root: base, rt, contextTokens: 32768 }),
    /Unsupported|does not support/,
  );
  assert.equal(
    readFileSync(path.join(rt.workspace, 'MEMORY.md'), 'utf8'),
    'synthetic memory fixture',
  );
  change.restore();
  assert.equal(readFileSync(rt.configPath, 'utf8'), before);
  assert.equal(loadCoreSettings(path.join(base, 'config')).model, config.model);
});

test('unregistered or malformed imported profiles cannot be committed', () => {
  const { base, rt } = settingsFixture();
  assert.throws(() => saveModelProfile({ root: base, rt, id: profile.id, hardware }), /Unknown/);
  for (const invalid of [
    { ...profile, model: 'other:latest' },
    { ...profile, contextLimit: 4096 },
    { ...profile, capabilities: ['arbitrary-code'] },
    { ...profile, source: 'other' },
  ])
    assert.throws(() => validateImportedProfile(invalid), /Invalid imported/);
});
