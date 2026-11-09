// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { runtime, createGatewayConfiguration } from '../packages/runtime/src/context.mjs';
import { loadCoreSettings } from '../packages/runtime/src/config/settings.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import {
  saveModelProfile,
  saveContextWindow,
} from '../packages/runtime/src/hardware/model-profile.mjs';
import { ModelService } from '../apps/desktop/model-service.mjs';
import { pullModel } from '../packages/runtime/src/providers/pull-model.mjs';
const hardware = {
  ramBytes: 48 * 2 ** 30,
  cpuThreads: 32,
  gpus: [{ memoryKind: 'dedicated', vramMiB: 12282 }],
};

test('alternative families are staged with actual capabilities and do not overwrite the current model', async () => {
  for (const [id, model, capabilities] of [
    ['ministral-3-3b', 'ministral-3:3b', ['tools', 'vision']],
    ['gemma4-e2b', 'gemma4:e2b', ['tools', 'vision', 'thinking']],
  ]) {
    let prepared;
    const service = new ModelService({
      ...dependencies,
      inventory: async () => ({ models: [{ name: model, size: 3000000000 }] }),
      pull: async () => assert.fail('Cached models must not download again'),
      native: async (_rt, value) => {
        prepared = value;
      },
      describe: async (name) => {
        assert.equal(name, model);
        return { capabilities };
      },
    });
    assert.equal((await service.prepare(id)).phase, 'ready');
    assert.equal(prepared.model, model);
    assert.equal(prepared.upstreamModel, model);
    assert.deepEqual(prepared.modelCapabilities, capabilities);
    assert.equal(service.snapshot().current, config.model);
    service.describe = async () => ({ capabilities: ['completion'] });
    assert.equal((await service.prepare(id)).phase, 'error');
    assert.equal(service.prepared, null);
  }
});
const config = JSON.parse(readFileSync(path.join(root, 'config/core.json'), 'utf8'));
const dependencies = {
  rt: { ollamaUrl: 'http://127.0.0.1:11435' },
  config,
  hardware: async () => hardware,
  ensure: async () => {},
  inventory: async () => ({ models: [] }),
  native: async () => {},
};

test('context can increase and decrease, survives model switching, preserves history and rolls back failed writes', () => {
  const parent = path.join(root, '.runtime/model-profile-tests');
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(path.join(parent, 'context-'));
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
  writeFileSync(path.join(rt.workspace, 'MEMORY.md'), 'keep my memory');
  for (const contextTokens of [65536, 131072, 262144, 32768]) {
    saveContextWindow({ root: base, rt, contextTokens });
    const saved = loadCoreSettings(path.join(base, 'config'));
    const gateway = JSON.parse(readFileSync(rt.configPath));
    assert.equal(saved.contextTokens, contextTokens);
    assert.equal(saved.generation.temperature, 0.91);
    assert.equal(gateway.models.providers.ollama.models[0].params.num_ctx, contextTokens);
    assert.equal(gateway.agents.defaults.compaction.memoryFlush.enabled, true);
    assert.deepEqual(gateway.tools.allow, ['memory_search']);
  }
  saveContextWindow({ root: base, rt, contextTokens: 65536 });
  saveModelProfile({ root: base, rt, id: 'balanced', hardware });
  assert.equal(loadCoreSettings(path.join(base, 'config')).contextTokens, 65536);
  const before = readFileSync(rt.configPath, 'utf8');
  let calls = 0;
  assert.throws(
    () =>
      saveContextWindow({
        root: base,
        rt,
        contextTokens: 32768,
        write: (file, value) => {
          if (++calls === 2) throw new Error('write failed');
          writeJsonAtomic(file, value);
        },
      }),
    /write failed/,
  );
  assert.equal(readFileSync(rt.configPath, 'utf8'), before);
  assert.equal(loadCoreSettings(path.join(base, 'config')).contextTokens, 65536);
  for (const contextTokens of [0, 16384, 65536.5, '65536', NaN, Infinity, 524288])
    assert.throws(() => saveContextWindow({ root: base, rt, contextTokens }), /Unsupported/);
  assert.equal(readFileSync(path.join(rt.workspace, 'MEMORY.md'), 'utf8'), 'keep my memory');
});
test('model file sizes prefer Ollama inventory, recognize native aliases and estimate missing models', async () => {
  const service = new ModelService({
    ...dependencies,
    inventory: async () => ({
      models: [
        { name: 'qwen3.5:9b', size: 6550825550 },
        { name: 'capri-qwen3.5:9b', size: 6550925550 },
        { name: 'capri-qwen3.5:4b', size: 3400000100 },
        { name: 'qwen3.5:2b', size: -1 },
      ],
    }),
  });
  const { profiles } = await service.catalog();
  const quality = profiles.find((p) => p.id === 'quality');
  assert.equal(quality.sizeBytes, 6550825550);
  assert.equal(quality.sizeEstimated, false);
  assert.equal(quality.installed, true);
  const desktop = profiles.find((p) => p.id === 'desktop');
  assert.equal(desktop.installed, true);
  assert.equal(desktop.upstreamInstalled, false);
  assert.equal(desktop.sizeBytes, 3400000100);
  assert.equal(desktop.sizeEstimated, false);
  for (const id of ['minimal', 'balanced']) {
    const profile = profiles.find((p) => p.id === id);
    assert.equal(profile.sizeEstimated, true);
    assert.ok(profile.sizeBytes > 1e9);
  }
  assert.equal(profiles.find((p) => p.id === 'minimal').installed, false);
});
test('API routing retains the configured local model without falsely marking it active or preparing it', async () => {
  for (const [enabled, setupRequired] of [
    [true, false],
    [false, false],
    [false, true],
  ]) {
    const apiSelected = enabled || setupRequired;
    const remote = Object.freeze({ enabled, setupRequired, model: 'fixture-api-model' });
    const rt = Object.freeze({ ...dependencies.rt, remote });
    const service = new ModelService({
      ...dependencies,
      rt,
      config: { ...config, model: 'capri-qwen3.5:4b' },
      inventory: async () => ({ models: [{ name: 'capri-qwen3.5:4b', size: 3400000100 }] }),
      ensure: async () =>
        assert.fail('Inspecting the configured model must not start local services'),
      pull: async () => assert.fail('Inspecting the configured model must not download weights'),
      native: async () => assert.fail('Inspecting the configured model must not prepare an alias'),
    });
    assert.equal(service.snapshot().remoteActive, apiSelected);
    const snapshot = await service.refresh();
    assert.equal(snapshot.remoteActive, apiSelected);
    const configured = snapshot.profiles.find((profile) => profile.id === 'desktop');
    assert.equal(configured.configured, true);
    assert.equal(configured.active, !apiSelected);
    assert.equal(configured.installed, true);
    assert.equal(snapshot.profiles.filter((profile) => profile.configured).length, 1);
    assert.equal(snapshot.profiles.filter((profile) => profile.active).length, apiSelected ? 0 : 1);
    assert.equal(snapshot.current, 'capri-qwen3.5:4b');
    assert.equal(rt.remote, remote);
    assert.equal(rt.remote.enabled, enabled);
    assert.equal(service.prepared, null);
  }
});

test('switching from API uses an isolated local runtime and rolls back a failed restart', () => {
  const parent = path.join(root, '.runtime/model-profile-tests');
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(path.join(parent, 'api-to-local-'));
  const remote = Object.freeze({
    enabled: true,
    model: 'fixture-api-model',
    contextTokens: 32768,
    tools: true,
    vision: false,
  });
  const rt = Object.freeze({
    ...runtime({
      stateDir: path.join(base, 'data/openclaw'),
      workspace: path.join(base, 'data/workspace'),
    }),
    remote,
    inferenceUrl: 'http://127.0.0.1:18893',
  });
  const beforeLocal = { customFlag: 'keep', generation: { temperature: 0.93 } };
  const beforeGateway = createGatewayConfiguration(rt, config);
  writeJsonAtomic(path.join(base, 'config/core.json'), config);
  writeJsonAtomic(path.join(base, 'config/core.local.json'), beforeLocal);
  writeJsonAtomic(rt.configPath, beforeGateway);
  const localRuntime = { ...rt, remote: { enabled: false }, inferenceUrl: rt.ollamaUrl };
  const change = saveModelProfile({ root: base, rt: localRuntime, id: 'desktop', hardware });
  const saved = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  assert.equal(saved.agents.defaults.model.primary, 'ollama/capri-qwen3.5:4b');
  assert.equal(saved.models.providers.ollama.baseUrl, rt.ollamaUrl);
  assert.notEqual(saved.models.providers.ollama.baseUrl, rt.inferenceUrl);
  assert.equal(loadCoreSettings(path.join(base, 'config')).model, 'capri-qwen3.5:4b');
  assert.equal(rt.remote, remote);
  assert.equal(rt.remote.enabled, true);
  assert.equal(rt.inferenceUrl, 'http://127.0.0.1:18893');
  assert.throws(() => {
    try {
      throw new Error('Synthetic restart failure');
    } catch (error) {
      change.restore();
      throw error;
    }
  }, /Synthetic restart failure/);
  assert.deepEqual(JSON.parse(readFileSync(rt.configPath, 'utf8')), beforeGateway);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(base, 'config/core.local.json'), 'utf8')),
    beforeLocal,
  );
  assert.equal(rt.remote.enabled, true);
});

test('model catalog marks memory limits and caches the hardware probe', async () => {
  let probes = 0;
  const service = new ModelService({
    ...dependencies,
    hardware: async () => {
      probes++;
      return { ...hardware, ramBytes: 8 * 2 ** 30, gpus: [] };
    },
  });
  const first = await service.refresh();
  await service.refresh();
  assert.equal(first.recommended, 'minimal');
  assert.equal(probes, 1);
  assert.deepEqual(
    first.profiles.filter((item) => item.supported).map((item) => item.id),
    ['minimal'],
  );
  assert.equal((await service.prepare('quality')).phase, 'error');
  assert.equal(service.snapshot().current, config.model);
  await assert.rejects(service.prepare('arbitrary:remote'), /Unknown/);
});
test('preparing a cached Qwen passes the chosen inference profile and never downloads weights', async () => {
  let chosen;
  const service = new ModelService({
    ...dependencies,
    config: {
      ...config,
      acceleration: 'cpu',
      generation: { temperature: 0.9, repeat_last_n: 400 },
    },
    inventory: async () => ({ models: [{ name: 'qwen3.5:4b' }] }),
    pull: async () => assert.fail('Already cached'),
    native: async (_rt, value) => {
      chosen = value;
    },
  });
  assert.equal((await service.prepare('desktop')).phase, 'ready');
  assert.equal(chosen.model, 'capri-qwen3.5:4b');
  assert.equal(chosen.cpuThreads, 4);
  assert.equal(chosen.acceleration, 'cpu');
  assert.equal(chosen.generation.temperature, 0.9);
  assert.equal(service.snapshot().current, config.model);
  let commits = 0;
  await service.apply(async (profile) => {
    commits++;
    assert.equal(profile.id, 'desktop');
    await assert.rejects(
      service.apply(async () => {}),
      /finish/,
    );
  });
  assert.equal(commits, 1);
});
test('a cancelled model download preserves the running model and cannot be applied', async () => {
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const service = new ModelService({
    ...dependencies,
    pull: async (_rt, _model, { signal, onProgress }) => {
      onProgress({ status: 'pulling', completed: 10, total: 100 });
      began();
      await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  const preparing = service.prepare('minimal');
  await started;
  assert.equal(service.snapshot().phase, 'downloading');
  service.cancel();
  assert.equal((await preparing).phase, 'idle');
  assert.equal(service.snapshot().current, config.model);
  await assert.rejects(
    service.apply(async () => {}),
    /Prepare/,
  );
});
test('the streaming model pull cancels its own HTTP request promptly', async () => {
  const controller = new AbortController();
  let reads = 0;
  const pulling = pullModel({ ollamaUrl: 'http://127.0.0.1:11435' }, 'qwen3.5:2b', {
    signal: controller.signal,
    emit: () => {},
    fetchImpl: async (_url, options) =>
      new Response(
        new ReadableStream({
          start(stream) {
            reads++;
            stream.enqueue(
              new TextEncoder().encode('{"status":"pulling layer","total":100,"completed":10}\n'),
            );
            options.signal.addEventListener('abort', () => stream.error(options.signal.reason), {
              once: true,
            });
          },
        }),
      ),
    onProgress: () => controller.abort(new Error('user cancel')),
  });
  await assert.rejects(pulling, /user cancel/);
  assert.equal(reads, 1);
});
test('profile persistence updates only inference fields and rolls back a failed write', () => {
  const parent = path.join(root, '.runtime/model-profile-tests');
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(path.join(parent, 'fixture-'));
  const rt = runtime({
    stateDir: path.join(base, 'data/openclaw'),
    workspace: path.join(base, 'data/workspace'),
  });
  writeJsonAtomic(path.join(base, 'config/core.json'), config);
  const local = {
    generation: { temperature: 0.97 },
    customFlag: 'preserve',
    resourceProfile: 'balanced',
  };
  const gateway = {
    agents: {
      defaults: {
        workspace: rt.workspace,
        model: { primary: 'old', fallbacks: ['custom/provider'] },
      },
    },
    plugins: { entries: { custom: { enabled: true } } },
    tools: { allow: ['session_status'] },
  };
  writeJsonAtomic(path.join(base, 'config/core.local.json'), local);
  writeJsonAtomic(rt.configPath, gateway);
  mkdirSync(rt.workspace, { recursive: true });
  writeFileSync(path.join(rt.workspace, 'MEMORY.md'), 'private memory');
  const change = saveModelProfile({ root: base, rt, id: 'desktop', hardware });
  const current = loadCoreSettings(path.join(base, 'config'));
  assert.equal(current.model, 'capri-qwen3.5:4b');
  assert.equal(current.generation.temperature, 0.97);
  assert.equal(current.customFlag, 'preserve');
  const saved = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  assert.equal(saved.agents.defaults.model.primary, 'ollama/capri-qwen3.5:4b');
  assert.deepEqual(saved.agents.defaults.model.fallbacks, ['custom/provider']);
  assert.deepEqual(saved.plugins, gateway.plugins);
  assert.deepEqual(saved.tools, gateway.tools);
  assert.equal(readFileSync(path.join(rt.workspace, 'MEMORY.md'), 'utf8'), 'private memory');
  change.restore();
  assert.deepEqual(JSON.parse(readFileSync(rt.configPath, 'utf8')), gateway);
  let fail = true;
  assert.throws(
    () =>
      saveModelProfile({
        root: base,
        rt,
        id: 'quality',
        hardware,
        write: (file, value) => {
          if (file.endsWith('core.local.json') && fail) {
            fail = false;
            throw new Error('disk fixture');
          }
          writeJsonAtomic(file, value);
        },
      }),
    /disk fixture/,
  );
  assert.deepEqual(JSON.parse(readFileSync(rt.configPath, 'utf8')), gateway);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(base, 'config/core.local.json'), 'utf8')),
    local,
  );
  assert.equal(existsSync(path.join(rt.workspace, 'MEMORY.md')), true);
});
