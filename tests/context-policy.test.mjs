import test from 'node:test';
import assert from 'node:assert/strict';
import { localContextPolicy, applyLocalContextPolicy } from '../scripts/context-policy.mjs';
import { r as applySettings } from '../node_modules/openclaw/dist/agent-settings-CZ8x5-4D.mjs';
import { ensureManagedContext } from '../packages/runtime/src/config/context-policy.mjs';
import { validateCoreSettings } from '../packages/runtime/src/config/settings.mjs';
import { PROFILES } from '../packages/runtime/src/hardware/profiles.mjs';
import { readFileSync } from 'node:fs';

test('local compaction leaves room for persona/tools and preserves memory provider settings', () => {
  const config = {
    agents: {
      defaults: {
        compaction: {
          keepRecentTokens: 20000,
          memoryFlush: { enabled: true, softThresholdTokens: 2000 },
        },
      },
    },
  };
  const policy = applyLocalContextPolicy(config, 16384);
  assert.equal(policy.keepRecentTokens, 2048);
  assert.equal(policy.memoryFlush.enabled, true);
  assert.equal(policy.memoryFlush.softThresholdTokens, 2000);
  const overrides = [];
  applySettings({
    cfg: config,
    contextTokenBudget: 16384,
    settingsManager: {
      getCompactionReserveTokens: () => 16384,
      getCompactionKeepRecentTokens: () => 20000,
      getCompactionEnabled: () => true,
      applyOverrides: (value) => overrides.push(value),
    },
  });
  assert.deepEqual(overrides, [{ compaction: { reserveTokens: 4096, keepRecentTokens: 2048 } }]);
  assert.ok(
    overrides[0].compaction.keepRecentTokens < 16384 - overrides[0].compaction.reserveTokens,
  );
});

test('context policy scales recent history conservatively and rejects invalid hardware budgets', () => {
  for (const tokens of [8192, 16384, 32768, 65536])
    assert.ok(localContextPolicy(tokens).keepRecentTokens <= tokens / 8);
  for (const tokens of [0, 4096, Infinity, 16384.5])
    assert.throws(() => localContextPolicy(tokens));
});

for (const size of ['0.8b', '2b', '4b', '9b'])
  test(`the local Capri ${size} profile reserves its real output budget`, () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: `ollama/capri-qwen3.5:${size}` },
          compaction: { keepRecentTokens: 2048 },
        },
        entries: { capri: {} },
      },
      models: {
        providers: { ollama: { models: [{ id: `capri-qwen3.5:${size}`, maxTokens: 2048 }] } },
      },
    };
    const overrides = [];
    applySettings({
      cfg,
      contextTokenBudget: 16384,
      settingsManager: {
        getCompactionReserveTokens: () => 20000,
        getCompactionKeepRecentTokens: () => 20000,
        getCompactionEnabled: () => true,
        applyOverrides: (value) => overrides.push(value),
      },
    });
    assert.deepEqual(overrides, [{ compaction: { reserveTokens: 2048, keepRecentTokens: 2048 } }]);
  });

test('all hardware profiles fit the full companion prompt and old managed settings migrate', () => {
  assert.ok(PROFILES.every((profile) => profile.contextTokens >= 32768));
  const base = JSON.parse(readFileSync(new URL('../config/core.json', import.meta.url)));
  assert.equal(
    validateCoreSettings({ ...base, model: 'capri-qwen3.5:2b', contextTokens: 8192 }).contextTokens,
    32768,
  );
  assert.equal(
    validateCoreSettings({ ...base, model: 'custom-model', contextTokens: 8192 }).contextTokens,
    8192,
  );
});

test('context migration preserves custom inference options, permissions, memory and larger windows', () => {
  const config = {
    agents: { defaults: { compaction: { memoryFlush: { enabled: true } } } },
    models: {
      providers: {
        ollama: {
          models: [
            {
              id: 'capri-qwen3.5:2b',
              contextWindow: 262144,
              contextTokens: 8192,
              params: { num_ctx: 8192, temperature: 0.77 },
            },
          ],
        },
      },
    },
    plugins: { entries: { custom: { enabled: true } } },
    tools: { allow: ['memory_search'] },
  };
  const permissions = JSON.stringify([config.plugins, config.tools]);
  assert.equal(ensureManagedContext(config, 'capri-qwen3.5:2b', 16384), true);
  const model = config.models.providers.ollama.models[0];
  assert.equal(model.params.num_ctx, 32768);
  assert.equal(model.contextWindow, 32768);
  assert.equal(model.params.temperature, 0.77);
  assert.equal(config.agents.defaults.compaction.memoryFlush.enabled, true);
  assert.equal(JSON.stringify([config.plugins, config.tools]), permissions);
  assert.equal(ensureManagedContext(config, 'capri-qwen3.5:2b', 16384), false);
  model.contextWindow = model.contextTokens = model.params.num_ctx = 32768;
  ensureManagedContext(config, 'capri-qwen3.5:2b', 16384);
  assert.equal(model.params.num_ctx, 32768);
  assert.equal(ensureManagedContext(config, 'another-model', 16384), false);
});

test('foreground Capri preflight skips optional memory extraction without changing session state', async () => {
  const { t: flush } = await import(
    '../node_modules/openclaw/dist/agent-runner-memory-Dz7Z-Pdn.mjs'
  );
  const entry = { sessionId: 'fixture-session', compactionCount: 3 };
  const result = await flush({
    capriForegroundPreflight: true,
    followupRun: { run: { agentId: 'capri' } },
    sessionEntry: entry,
  });
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.sessionEntry, entry);
  assert.deepEqual(entry, { sessionId: 'fixture-session', compactionCount: 3 });
});

test('existing 32K installations receive early compaction without resetting memory or inference', () => {
  const model = {
    id: 'capri-qwen3.5:9b',
    contextTokens: 32768,
    contextWindow: 32768,
    params: { num_ctx: 32768 },
  };
  const config = {
    agents: { defaults: { compaction: { memoryFlush: { enabled: true } } } },
    models: { providers: { ollama: { models: [model] } } },
  };
  assert.equal(ensureManagedContext(config, model.id, 32768), true);
  assert.equal(config.agents.defaults.compaction.maxActiveTranscriptBytes, 24576);
  assert.equal(config.agents.defaults.compaction.memoryFlush.enabled, true);
  assert.equal(ensureManagedContext(config, model.id, 32768), false);
  assert.equal(localContextPolicy(65536).maxActiveTranscriptBytes, 49152);
});

test('only Capri managed utility recaps are disabled; custom utility providers and memory remain', () => {
  const config = {
    agents: {
      defaults: {
        utilityModel: 'ollama/capri-qwen3.5:9b',
        compaction: { memoryFlush: { enabled: true } },
      },
      entries: { capri: { utilityModel: 'ollama/capri-qwen3.5:2b' } },
    },
  };
  applyLocalContextPolicy(config, 32768);
  assert.equal(config.agents.defaults.utilityModel, '');
  assert.equal(config.agents.entries.capri.utilityModel, '');
  assert.equal(config.agents.defaults.compaction.memoryFlush.enabled, true);
  config.agents.defaults.utilityModel = 'custom/utility';
  applyLocalContextPolicy(config, 32768);
  assert.equal(config.agents.defaults.utilityModel, 'custom/utility');
});
