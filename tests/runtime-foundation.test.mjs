import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root, paths, findExecutable } from '../packages/runtime/src/host/paths.mjs';
import {
  loadCoreSettings,
  validateCoreSettings,
} from '../packages/runtime/src/config/settings.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import { recommendProfile, selectProfile } from '../packages/runtime/src/hardware/profiles.mjs';
import { parseNvidia } from '../packages/runtime/src/hardware/probe.mjs';
import { request } from '../packages/runtime/src/http.mjs';
import { markerPath, markerBelongsHere } from '../packages/runtime/src/host/processes.mjs';
import { modelPlan } from '../packages/runtime/src/providers/model-plan.mjs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { startGateway } from '../packages/runtime/src/providers/services.mjs';
import { nodePath, settings } from '../packages/runtime/src/index.mjs';
import {
  applyModelProfile,
  createGatewayConfiguration,
  initialize,
  runtime,
  relocateManagedPaths,
} from '../packages/runtime/src/context.mjs';

const parent = path.join(paths.cache, 'test-data/runtime');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'fixture-'));
const defaults = JSON.parse(readFileSync(path.join(root, 'config/core.json'), 'utf8'));
test('runtime initialization without a provider choice preserves API routing and its context across relaunches', () => {
  const options = { stateDir: folder(), workspace: folder() };
  const active = runtime(options);
  active.remote = {
    enabled: true,
    model: 'fixture/provider-model',
    vision: true,
    tools: true,
    contextTokens: 8192,
  };
  active.inferenceUrl = 'http://127.0.0.1:19765';
  initialize(active);
  const read = () => JSON.parse(readFileSync(active.configPath, 'utf8'));
  const selected = read();
  assert.equal(selected.logging.level, 'silent');
  assert.equal(selected.logging.consoleLevel, 'silent');
  for (let repeat = 0; repeat < 3; repeat++) {
    initialize(runtime(options));
    const retained = read();
    assert.equal(retained.logging.level, 'silent');
    assert.equal(retained.diagnostics.otel.enabled, false);
    assert.deepEqual(retained.agents.defaults.model, selected.agents.defaults.model);
    assert.equal(retained.agents.defaults.imageModel, selected.agents.defaults.imageModel);
    assert.deepEqual(
      retained.models.providers['capri-api'],
      selected.models.providers['capri-api'],
    );
    assert.deepEqual(retained.agents.defaults.compaction, selected.agents.defaults.compaction);
    assert.deepEqual(retained.memory, selected.memory);
  }
});
test('an explicit local provider selection still replaces API routing during initialization', () => {
  const options = { stateDir: folder(), workspace: folder() };
  const api = runtime(options);
  api.remote = {
    enabled: true,
    model: 'fixture/provider-model',
    vision: false,
    contextTokens: 65536,
  };
  api.inferenceUrl = 'http://127.0.0.1:19765';
  initialize(api);
  const local = runtime(options);
  local.remote = { enabled: false };
  initialize(local);
  const selected = JSON.parse(readFileSync(local.configPath, 'utf8'));
  assert.equal(selected.agents.defaults.model.primary, 'ollama/' + settings.model);
  assert.equal(selected.agents.defaults.imageModel, 'ollama/' + settings.model);
  assert.equal(selected.models.providers['capri-api'], undefined);
});
test('occupied Gateway ports are detected before sending private credentials', async (t) => {
  const observed = [];
  const server = createServer((req, res) => {
    observed.push(req.headers.authorization);
    res.end('ready');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const rt = runtime({
    stateDir: folder(),
    workspace: folder(),
    gatewayPort: server.address().port,
    logPrefix: 'test-' + randomUUID(),
  });
  await assert.rejects(startGateway(rt), /occupied by another installation/);
  assert.deepEqual(observed, [undefined]);
});
test('moving a checkout rebases only proven managed workspace and plugin paths', () => {
  const rt = runtime(),
    oldRoot = path.join(root, 'previous-location');
  const config = createGatewayConfiguration(
    { ...rt, workspace: path.join(oldRoot, 'data/workspace') },
    defaults,
  );
  config.plugins.load.paths = ['filesystem', 'desktop-actions', 'perception'].map((name) =>
    path.join(oldRoot, 'integrations', name),
  );
  const moved = relocateManagedPaths(config, rt);
  assert.equal(moved.agents.defaults.workspace, rt.workspace);
  assert.equal(moved.plugins.load.paths[0], path.join(root, 'integrations/filesystem'));
  assert.equal(config.agents.defaults.workspace, path.join(oldRoot, 'data/workspace'));
  const custom = structuredClone(config);
  custom.plugins.load.paths = [path.join(root, 'integrations/filesystem')];
  assert.deepEqual(relocateManagedPaths(custom, rt), custom);
});
test('process markers copied from another checkout cannot adopt its running processes', () => {
  assert.equal(
    markerBelongsHere({ projectRoot: path.join(root, 'another-copy'), executable: nodePath }),
    false,
  );
  assert.equal(markerBelongsHere({ projectRoot: root, executable: nodePath }), true);
  assert.equal(
    markerBelongsHere({
      executable: path.join(root, '.runtime/ollama/ollama.exe'),
      args: ['serve'],
    }),
    true,
  );
  assert.equal(
    markerBelongsHere({
      executable: path.join(root, 'another-copy-marker.exe').replace(root, root + '-other'),
      args: ['serve'],
    }),
    false,
  );
});
test('profile migration changes inference without dropping memory, tools, permissions or private overrides', () => {
  const rt = runtime({ stateDir: folder(), workspace: folder() }),
    original = createGatewayConfiguration(rt, defaults);
  original.memory.ownerSetting = 'preserve';
  original.plugins.entries.spotify = { enabled: true };
  original.tools.allow.push('spotify_control');
  const before = structuredClone(original),
    profile = { ...defaults, model: 'capri-qwen3.5:4b', contextTokens: 8192 };
  const next = applyModelProfile(original, rt, profile);
  assert.deepEqual(original, before);
  assert.deepEqual(next.memory, before.memory);
  assert.deepEqual(next.plugins, before.plugins);
  assert.deepEqual(next.tools, before.tools);
  assert.equal(next.agents.defaults.model.primary, 'ollama/capri-qwen3.5:4b');
  assert.equal(next.models.providers.ollama.models.at(-1).contextTokens, 8192);
});
test('model planning is side-effect free and CLI command names never become model names', () => {
  assert.deepEqual(modelPlan(defaults, ['--plan']), {
    models: [defaults.upstreamModel, 'bge-m3:latest'],
    preview: true,
  });
  assert.throws(() => modelPlan(defaults, ['../bad model']));
  assert.deepEqual(modelPlan(defaults, ['--embedding-only', '--plan']), {
    models: ['bge-m3:latest'],
    preview: true,
    embeddingOnly: true,
  });
  assert.throws(() => modelPlan(defaults, ['--embedding-only', 'qwen3.5:2b']));
  const result = spawnSync(nodePath, ['packages/runtime/bin/capri.mjs', 'models', '--plan'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).models, [settings.upstreamModel, 'bge-m3:latest']);
});
test('portable settings merge a private override without editing public defaults', () => {
  const directory = folder();
  writeJsonAtomic(path.join(directory, 'core.json'), defaults);
  writeJsonAtomic(path.join(directory, 'core.local.json'), {
    model: 'capri-qwen3.5:4b',
    generation: { temperature: 0.6 },
    cpuThreads: 2,
  });
  const result = loadCoreSettings(directory);
  assert.equal(result.model, 'capri-qwen3.5:4b');
  assert.equal(result.generation.temperature, 0.6);
  assert.equal(result.generation.repeat_last_n, defaults.generation.repeat_last_n);
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'core.json'), 'utf8')), defaults);
  for (const extra of [
    { gatewayPort: 80 },
    { gatewayPort: defaults.ollamaPort },
    { cpuThreads: 0 },
    { cpuThreads: 200 },
    { contextTokens: 4096 },
    { acceleration: 'magic' },
  ])
    assert.throws(() => validateCoreSettings({ ...defaults, ...extra }));
});
test('hardware profiles do not sum VRAM, mistake shared memory for VRAM or assume unknown GPU support', () => {
  const host = { ramBytes: 48 * 2 ** 30, cpuThreads: 32, gpus: [] };
  assert.equal(recommendProfile(host).profile.id, 'balanced');
  assert.equal(
    recommendProfile({ ...host, gpus: [{ memoryKind: 'unknown', vramMiB: 64000 }] }).profile.id,
    'balanced',
  );
  assert.equal(
    recommendProfile({
      ...host,
      gpus: [
        { memoryKind: 'dedicated', vramMiB: 6144 },
        { memoryKind: 'dedicated', vramMiB: 6144 },
      ],
    }).profile.id,
    'balanced',
  );
  const quality = recommendProfile({
    ...host,
    gpus: [{ memoryKind: 'dedicated', vramMiB: 12288 }],
  });
  assert.equal(quality.profile.id, 'quality');
  assert.equal(quality.profile.voice, 'optional');
  assert.equal(
    recommendProfile({
      ...host,
      ramBytes: 31.9 * 2 ** 30,
      gpus: [{ memoryKind: 'dedicated', vramMiB: 12282 }],
    }).profile.id,
    'quality',
  );
  assert.equal(recommendProfile({ ...host, ramBytes: 15.8 * 2 ** 30 }).profile.id, 'balanced');
  assert.equal(
    recommendProfile({ ...host, ramBytes: 8 * 2 ** 30, cpuThreads: 2 }).profile.cpuThreads,
    1,
  );
  assert.equal(recommendProfile({ ...host, ramBytes: 4 * 2 ** 30 }).supported, false);
  assert.throws(() => selectProfile('quality', { ...host, ramBytes: 16 * 2 ** 30 }));
  assert.equal(parseNvidia('NVIDIA RTX 4070, 12282, 590.00')[0].vramMiB, 12282);
  assert.deepEqual(parseNvidia('NVIDIA RTX, N/A, 590.00'), []);
});
test('standard executable discovery handles spaces without shell expansion', () => {
  const directory = folder(),
    file = path.join(directory, 'node.exe');
  writeFileSync(file, 'fixture');
  assert.equal(findExecutable('node', { platform: 'win32', env: { PATH: directory } }), file);
  assert.equal(
    findExecutable('not-present', { platform: 'win32', env: { PATH: directory } }),
    null,
  );
  for (const value of ['../desktop', 'desktop/../../other', '', String.raw`..\other`])
    assert.throws(() => markerPath(value));
});
test('failed atomic writes keep the last valid settings and remove temporary files', () => {
  const directory = folder(),
    file = path.join(directory, 'settings.json');
  writeJsonAtomic(file, { version: 1 });
  const circular = {};
  circular.self = circular;
  assert.throws(() => writeJsonAtomic(file, circular));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1 });
  assert.deepEqual(readdirSync(directory), ['settings.json']);
});
test('service HTTP rejects oversized bodies and keeps error responses out of diagnostics', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(5000)));
  await assert.rejects(request('http://localhost/test', { maxBytes: 100 }), /exceeds limit/);
  globalThis.fetch = async () => new Response('PRIVATE TEST TOKEN', { status: 401 });
  await assert.rejects(
    request('http://localhost/test'),
    (error) => error.message.includes('401') && !error.message.includes('PRIVATE'),
  );
});
