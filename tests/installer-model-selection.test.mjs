// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, linkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import {
  applyInstallerModelSelection,
  installerModelProfile,
} from '../packages/installer/src/model-selection.mjs';
import { validateRequest } from '../packages/installer/src/policy.mjs';
import { estimateInstallStorage } from '../packages/installer/src/storage-estimate.mjs';
import { HuggingFaceHub } from '../packages/runtime/src/huggingface/hub.mjs';
const parent = path.join(root, '.runtime/installer-model-tests');
mkdirSync(parent, { recursive: true });
const hardware = {
  ramBytes: 48 * 2 ** 30,
  cpuThreads: 16,
  gpus: [{ name: 'NVIDIA fixture', vendor: 'nvidia', memoryKind: 'dedicated', vramMiB: 12288 }],
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fixture() {
  const folder = mkdtempSync(path.join(parent, 'case-'));
  const local = path.join(folder, 'config/core.local.json');
  const gateway = path.join(folder, 'data/openclaw/openclaw.json');
  writeJsonAtomic(path.join(folder, '.capri-install.json'), {
    schemaVersion: 1,
    productId: 'capri.desktop',
    root: folder,
    installId: randomUUID(),
    version: '1.0.4',
  });
  writeJsonAtomic(path.join(folder, 'config/core.json'), json(path.join(root, 'config/core.json')));
  writeJsonAtomic(local, {
    model: 'gemma4:e2b',
    upstreamModel: 'gemma4:e2b',
    resourceProfile: 'balanced',
    gatewayPort: 19876,
    ollamaPort: 19877,
    contextTokens: 65536,
    generation: { temperature: 0.92 },
    preloadModels: false,
  });
  writeJsonAtomic(gateway, {
    agents: {
      defaults: {
        workspace: path.join(folder, 'data/workspace'),
        model: { primary: 'ollama/gemma4:e2b' },
      },
    },
    tools: { allow: ['memory_search'] },
  });
  return { folder, local, gateway };
}
test('keeping the actual selected model preserves local and gateway settings byte for byte', () => {
  const { folder, local, gateway } = fixture(),
    before = [local, gateway].map((file) => readFileSync(file));
  assert.equal(
    applyInstallerModelSelection({
      root: folder,
      hardware,
      plan: { inferenceMode: 'local', profile: 'gemma4-e2b' },
    }),
    null,
  );
  for (const [i, file] of [local, gateway].entries())
    assert.deepEqual(readFileSync(file), before[i]);
});
test('an explicit upgrade model switch updates the gateway, preserves private settings, and can roll back', () => {
  const { folder, local, gateway } = fixture();
  // A stale upstream hint must not make the installer keep the wrong active model.
  writeJsonAtomic(local, { ...json(local), upstreamModel: 'qwen3.5:9b' });
  const before = [local, gateway].map((file) => readFileSync(file));
  const restore = applyInstallerModelSelection({
    root: folder,
    hardware,
    plan: { inferenceMode: 'local', profile: 'quality' },
  });
  const next = json(local);
  assert.equal(next.model, 'capri-qwen3.5:9b');
  assert.equal(next.upstreamModel, 'qwen3.5:9b');
  assert.equal(next.resourceProfile, 'quality');
  assert.equal(next.contextTokens, 65536);
  assert.equal(next.gatewayPort, 19876);
  assert.equal(next.ollamaPort, 19877);
  assert.deepEqual(next.generation, { temperature: 0.92 });
  assert.equal(json(gateway).agents.defaults.model.primary, 'ollama/capri-qwen3.5:9b');
  assert.deepEqual(json(gateway).tools.allow, ['memory_search']);
  restore();
  for (const [i, file] of [local, gateway].entries())
    assert.deepEqual(readFileSync(file), before[i]);
});
test('API and deferred Hugging Face updates keep the local selection untouched', () => {
  for (const plan of [
    { inferenceMode: 'api', profile: 'minimal' },
    { inferenceMode: 'local', modelSetupRequired: true, profile: 'minimal' },
  ]) {
    const { folder, local } = fixture(),
      before = readFileSync(local);
    assert.equal(applyInstallerModelSelection({ root: folder, hardware, plan }), null);
    assert.deepEqual(readFileSync(local), before);
  }
});
test(
  'upgrades refuse linked model settings before changing the selected model',
  { skip: process.platform !== 'win32' },
  () => {
    const { folder, local } = fixture();
    const linked = path.join(folder, 'linked-private.json');
    linkSync(local, linked);
    const before = readFileSync(local);
    assert.throws(
      () =>
        applyInstallerModelSelection({
          root: folder,
          hardware,
          plan: { inferenceMode: 'local', profile: 'quality' },
        }),
      /filesystem links/,
    );
    assert.deepEqual(readFileSync(linked), before);
  },
);
test(
  'native metadata chooses actual model over a stale resource profile and combines downloaded catalog and HF choices',
  { skip: process.platform !== 'win32' },
  () => {
    const { folder } = fixture();
    const hf = 'hf-' + 'a'.repeat(24),
      digest = 'b'.repeat(64);
    writeJsonAtomic(path.join(folder, 'data/model-inventory.json'), {
      models: [
        { name: 'capri-qwen3.5:2b' },
        { name: 'gemma4:e2b' },
        { name: 'capri-embed:latest' },
      ],
    });
    writeJsonAtomic(path.join(folder, 'data/huggingface/packages', hf, 'receipt.json'), {
      id: hf,
      task: 'llm',
      files: [{ sha256: digest, bytes: 12 }],
      profile: {
        id: hf,
        source: 'huggingface',
        model: 'capri-' + hf + ':latest',
        alias: 'capri-' + hf + ':latest',
      },
    });
    mkdirSync(path.join(folder, 'data/huggingface/blobs'), { recursive: true });
    writeFileSync(path.join(folder, 'data/huggingface/blobs', digest), Buffer.alloc(12));
    const script = path.join(folder, 'metadata.ps1');
    writeFileSync(
      script,
      `param($Source,$Target)
. (Join-Path $Source 'packages/installer/windows/common.ps1')
. (Join-Path $Source 'packages/installer/windows/installed-models.ps1')
$profiles=@(Get-CapriSetupModels $Target (Read-CapriJson (Join-Path $Source 'config/installer.json')).profiles)
$selected=Get-CapriSetupProfileForConfig (Read-CapriJson (Join-Path $Target 'config/core.local.json')) $profiles
[pscustomobject]@{count=$profiles.Count;selected=$selected;downloaded=@($script:installedModelNames);hf=@($profiles|Where-Object{$_.PSObject.Properties['source'] -and $_.source -eq 'huggingface'}).Count}|ConvertTo-Json -Compress
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
        script,
        root,
        folder,
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 20000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.count, 7);
    assert.equal(value.selected, 'gemma4-e2b');
    assert.equal(value.hf, 1);
    assert(
      value.downloaded.includes('capri-qwen3.5:2b') && value.downloaded.includes('gemma4:e2b'),
    );
  },
);
test('installer accepts only a verified imported receipt and excludes its existing weights from downloads', async () => {
  const { folder } = fixture();
  const hub = new HuggingFaceHub({
    root: folder,
    ollamaUrl: 'http://127.0.0.1:11435',
    fetchImpl: () => assert.fail('No network in receipt tests'),
  });
  const weights = Buffer.alloc(12);
  weights.write('GGUF');
  weights.writeUInt32LE(3, 4);
  const digest = createHash('sha256').update(weights).digest('hex');
  hub.inspect = async () => ({
    repository: 'fixture/model',
    revision: 'a'.repeat(40),
    files: [{ path: 'model-Q4_K_M.gguf', kind: 'gguf', bytes: 12, sha256: digest, split: false }],
    task: 'llm',
  });
  const plan = await hub.plan({
    repository: 'fixture/model',
    filename: 'model-Q4_K_M.gguf',
    contextTokens: 8192,
  });
  const profile = {
    id: plan.id,
    source: 'huggingface',
    model: 'capri-' + plan.id + ':latest',
    alias: 'capri-' + plan.id + ':latest',
    contextTokens: 8192,
    contextLimit: 16384,
    cpuThreads: 4,
    capabilities: [],
    ramGiB: 8,
    recommendedVramGiB: 4,
    sizeBytes: 12,
  };
  mkdirSync(hub.blobs, { recursive: true });
  writeFileSync(path.join(hub.blobs, digest), weights);
  writeJsonAtomic(path.join(hub.packages, plan.id, 'receipt.json'), { ...plan, profile });
  assert.equal(installerModelProfile(plan.id, hardware, folder).model, profile.model);
  const request = {
    schemaVersion: 1,
    target: folder,
    profile: plan.id,
    inferenceMode: 'local',
    modelSource: 'catalog',
    interfaceLanguage: 'en',
    conversationLanguage: 'en',
    recognition: false,
    downloadModels: true,
    desktopShortcut: false,
    startMenuShortcut: false,
    voiceMode: 'off',
    voicePack: '',
    acceptLicense: true,
    acceptDownloads: true,
  };
  const validated = validateRequest(request, {
    sourceRoot: root,
    version: '1.0.5',
    hardware,
    freeBytes: 2 ** 40,
  });
  assert.equal(validated.profile, plan.id);
  assert.equal(validated.installedModel, profile.model);
  assert.equal(validated.modelSetupRequired, false);
  assert.equal(validated.downloadModels, true);
  const restore = applyInstallerModelSelection({
    root: folder,
    hardware,
    plan: { inferenceMode: 'local', profile: plan.id },
  });
  assert.equal(json(path.join(folder, 'config/core.local.json')).model, profile.model);
  restore();
  const selected = {
    profile: 'balanced',
    inferenceMode: 'local',
    conversationLanguage: 'en',
    downloadModels: true,
  };
  assert(
    estimateInstallStorage({ ...selected, installedModel: profile.model }).downloadBytes <
      estimateInstallStorage(selected).downloadBytes,
  );
  assert.throws(() => installerModelProfile('hf-' + '0'.repeat(24), hardware, folder));
});
