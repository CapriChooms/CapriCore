// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  modelDevice,
  parseLlamaDevices,
  parseVoiceDevices,
  resolveModelDevice,
  languageDeviceLaunch,
  voiceDeviceLaunch,
} from '../packages/runtime/src/hardware/model-devices.mjs';
import {
  readModelDevices,
  saveModelDevices,
  deviceEnvironment,
  modelsShareDevice,
  unrestrictedDeviceEnvironment,
} from '../packages/runtime/src/model-device-settings.mjs';
import { ModelDeviceService } from '../apps/desktop/model-device-service.mjs';
import { loadCoreSettings } from '../packages/runtime/src/config/settings.mjs';
import { saveInferenceSettings } from '../packages/runtime/src/hardware/model-profile.mjs';
import { createGatewayConfiguration } from '../packages/runtime/src/context.mjs';
import { availableParallelism } from 'node:os';
import { cpuExecutionProfile } from '../packages/runtime/src/hardware/cpu-execution.mjs';
const parent = path.resolve('.runtime/model-device-tests');
mkdirSync(parent, { recursive: true });
const fixture = () => mkdtempSync(path.join(parent, 'case-'));
const cuda = modelDevice('cuda', 0, 'NVIDIA QA'),
  amd = modelDevice('vulkan', 1, 'AMD Radeon QA');

test('CPU profiles scale conservative preset budgets to the available cores', () => {
  const base = {
    resourceProfile: 'minimal',
    model: 'capri-qwen3.5:0.8b',
    acceleration: 'cpu',
    cpuThreads: 2,
    contextTokens: 32768,
  };
  for (const [host, expected] of [
    [1, 1],
    [2, 1],
    [4, 2],
    [8, 4],
    [16, 8],
    [32, 8],
  ]) {
    const result = cpuExecutionProfile(base, host);
    assert.equal(result.cpuThreads, expected);
    assert.equal(result.contextTokens, base.contextTokens);
    assert.equal(result.model, base.model);
  }
  assert.equal(base.cpuThreads, 2);
  for (const config of [
    { ...base, acceleration: 'auto' },
    { ...base, cpuThreads: 3 },
    { ...base, resourceProfile: 'custom' },
  ])
    assert.equal(cpuExecutionProfile(config, 32), config);
});

test('CPU switching applies the same effective thread budget to settings and gateway without changing the saved profile', () => {
  const root = fixture();
  mkdirSync(path.join(root, 'config'), { recursive: true });
  const config = {
    ...JSON.parse(readFileSync('config/core.json', 'utf8')),
    resourceProfile: 'minimal',
    model: 'capri-qwen3.5:0.8b',
    cpuThreads: 2,
    acceleration: 'auto',
  };
  const file = path.join(root, 'config/core.json');
  writeFileSync(file, JSON.stringify(config));
  const rt = {
    workspace: path.join(root, 'data/workspace'),
    stateDir: path.join(root, 'data/openclaw'),
    configPath: path.join(root, 'data/openclaw/openclaw.json'),
    ollamaUrl: 'http://127.0.0.1:30251',
    gatewayPort: 30151,
  };
  mkdirSync(path.dirname(rt.configPath), { recursive: true });
  writeFileSync(rt.configPath, JSON.stringify(createGatewayConfiguration(rt, config)));
  saveModelDevices(root, { language: 'cpu', voice: 'cpu' });
  const expected = Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2)));
  const cpu = loadCoreSettings(path.join(root, 'config'));
  assert.equal(cpu.cpuThreads, expected);
  saveInferenceSettings({ root, rt, overrides: { acceleration: 'cpu' } });
  const gateway = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  assert.equal(gateway.models.providers.ollama.models[0].params.num_thread, expected);
  assert.equal(gateway.models.providers.ollama.models[0].params.num_gpu, 0);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).cpuThreads, 2);
  saveModelDevices(root, { language: 'auto', voice: 'auto' });
  assert.equal(loadCoreSettings(path.join(root, 'config')).cpuThreads, 2);
});

test('backend discovery uses actual backend ordinals and bounded names, never DXGI order', () => {
  const text =
    'Available devices:\n  CUDA0: NVIDIA QA (12281 MiB, 11000 MiB free)\n  Vulkan1: AMD Radeon QA (8000 MiB, 6000 MiB free)\n';
  assert.deepEqual(
    parseLlamaDevices(text, 'cuda').map((x) => x.id),
    [cuda.id],
  );
  assert.deepEqual(
    parseLlamaDevices(text, 'vulkan').map((x) => x.id),
    [amd.id],
  );
  assert.deepEqual(parseLlamaDevices('CUDA999: bad\nVulkan0: bad', 'cuda'), []);
  const values = parseVoiceDevices(
    JSON.stringify({
      backend: 'cuda',
      devices: [
        {
          ordinal: 0,
          name: 'NVIDIA QA',
          totalBytes: 100,
          available: true,
          uuid: '12345678-1234-1234-1234-123456789abc',
        },
      ],
    }),
  );
  assert.equal(values[0].uuid, 'GPU-12345678-1234-1234-1234-123456789abc');
  assert.equal(
    parseVoiceDevices(
      '{"backend":"cuda","devices":[{"ordinal":0,"name":"old GPU","available":false}]}',
    )[0].available,
    false,
  );
  assert.throws(() => parseVoiceDevices('{"backend":"cuda","devices":[{"ordinal":1}]}'));
});

test('language and voice choices persist independently, reject injected environment settings and restore atomically', () => {
  const root = fixture();
  assert.equal(readModelDevices(root).language, 'auto');
  const restore = saveModelDevices(root, { language: amd.id, voice: cuda.id });
  assert.equal(readModelDevices(root).language, amd.id);
  assert.equal(readModelDevices(root).voice, cuda.id);
  assert.throws(() =>
    saveModelDevices(root, { language: 'cpu', voice: 'auto', CUDA_VISIBLE_DEVICES: '0' }),
  );
  assert.throws(() => saveModelDevices(root, { language: 'cuda:0;evil', voice: 'auto' }));
  restore();
  assert.equal(existsSync(path.join(root, 'data/desktop/model-devices.json')), false);
  saveModelDevices(root, { language: 'cpu', voice: 'auto' });
  const undo = saveModelDevices(root, { language: 'auto', voice: 'cpu' });
  undo();
  assert.equal(readModelDevices(root).language, 'cpu');
});

test('CPU and mixed-vendor masks affect only the requested child, with no backend leakage', () => {
  const inherited = { CUDA_VISIBLE_DEVICES: '3', HIP_VISIBLE_DEVICES: '2', PATH: 'unchanged' };
  const cleared = unrestrictedDeviceEnvironment(inherited);
  assert.equal(cleared.CUDA_VISIBLE_DEVICES, undefined);
  assert.equal(inherited.CUDA_VISIBLE_DEVICES, '3');
  assert.deepEqual(deviceEnvironment({ id: 'auto' }), {});
  const cpu = deviceEnvironment({ id: 'cpu' });
  for (const key of ['CUDA_VISIBLE_DEVICES', 'HIP_VISIBLE_DEVICES', 'GGML_VK_VISIBLE_DEVICES'])
    assert.equal(cpu[key], '-1');
  assert.equal(deviceEnvironment(cuda).CUDA_VISIBLE_DEVICES, '0');
  assert.equal(deviceEnvironment(cuda).GGML_VK_VISIBLE_DEVICES, '-1');
  const vk = deviceEnvironment(amd);
  assert.equal(vk.CUDA_VISIBLE_DEVICES, '-1');
  assert.equal(vk.GGML_VK_VISIBLE_DEVICES, '1');
  assert.equal(vk.OLLAMA_VULKAN, '1');
  const hip = deviceEnvironment(modelDevice('rocm', 1, 'AMD QA'));
  assert.equal(hip.HIP_VISIBLE_DEVICES, '1');
  assert.equal(hip.CUDA_VISIBLE_DEVICES, undefined);
  assert.equal(modelsShareDevice(cuda.id, modelDevice('cuda', 1, 'NVIDIA QA').id), false);
  assert.equal(modelsShareDevice(cuda.id, 'cpu'), false);
  assert.equal(modelsShareDevice(cuda.id, 'auto'), true);
});

test('manual devices are verified again at launch; missing or reordered cards cannot silently select another GPU', async () => {
  const root = fixture();
  saveModelDevices(root, { language: amd.id, voice: cuda.id });
  assert.equal(
    (await languageDeviceLaunch(root, 'fixture', { probe: async () => [amd] })).env
      .GGML_VK_VISIBLE_DEVICES,
    '1',
  );
  await assert.rejects(
    languageDeviceLaunch(root, 'fixture', {
      probe: async () => [modelDevice('vulkan', 0, 'AMD QA')],
    }),
    /unavailable/,
  );
  assert.equal(
    (await voiceDeviceLaunch(root, 'fixture', {}, { probe: async () => [cuda] })).env
      .CAPRI_VOICE_COMPUTE_DEVICE,
    'cuda:0',
  );
  saveModelDevices(root, { language: 'cpu', voice: 'cpu' });
  let called = false;
  const result = await voiceDeviceLaunch(
    root,
    'missing',
    {},
    {
      probe: async () => {
        called = true;
        return [];
      },
    },
  );
  assert.equal(result.env.CAPRI_VOICE_COMPUTE_DEVICE, 'cpu');
  assert.equal(called, false);
  assert.throws(() => resolveModelDevice(cuda.id, [{ ...cuda, available: false }]), /unavailable/);
});

test('device catalogs show unavailable cards and validate fresh availability without loading any model', async () => {
  const root = fixture();
  let current = [cuda];
  const service = new ModelDeviceService({
    root,
    config: { acceleration: 'cpu' },
    ollama: 'fixture',
    languageProbe: async () => [cuda, amd],
    voiceProbe: async () => current,
    hardware: async () => ({ gpus: [{ name: 'NVIDIA QA' }, { name: 'AMD Radeon QA' }] }),
  });
  const catalog = await service.refresh('en');
  assert.equal(catalog.current.language, 'cpu');
  assert.equal(catalog.options.voice.find((x) => x.name === 'AMD Radeon QA').available, false);
  const value = await service.validate({ language: amd.id, voice: cuda.id });
  service.save(value);
  current = [];
  await assert.rejects(service.validate({ language: amd.id, voice: cuda.id }), /unavailable/);
  assert.equal(service.current().voice, cuda.id);
});

test('CPU to GPU switching removes old CPU-only gateway options and preserves unrelated settings', () => {
  const root = fixture();
  mkdirSync(path.join(root, 'config'), { recursive: true });
  const config = JSON.parse(readFileSync('config/core.json', 'utf8'));
  writeFileSync(
    path.join(root, 'config/core.json'),
    JSON.stringify({ ...config, acceleration: 'cpu' }),
  );
  const rt = {
    workspace: path.join(root, 'data/workspace'),
    stateDir: path.join(root, 'data/openclaw'),
    configPath: path.join(root, 'data/openclaw/openclaw.json'),
    ollamaUrl: 'http://127.0.0.1:30251',
    gatewayPort: 30151,
  };
  mkdirSync(path.dirname(rt.configPath), { recursive: true });
  writeFileSync(
    rt.configPath,
    JSON.stringify(createGatewayConfiguration(rt, { ...config, acceleration: 'cpu' })),
  );
  saveModelDevices(root, { language: cuda.id, voice: 'cpu' });
  assert.equal(loadCoreSettings(path.join(root, 'config')).acceleration, 'auto');
  saveInferenceSettings({ root, rt, overrides: { acceleration: 'auto' } });
  const gateway = JSON.parse(readFileSync(rt.configPath, 'utf8'));
  assert.equal(gateway.models.providers.ollama.models[0].params.num_gpu, undefined);
  assert.equal(gateway.models.providers.ollama.models[0].id, config.model);
  saveModelDevices(root, { language: 'cpu', voice: cuda.id });
  assert.equal(loadCoreSettings(path.join(root, 'config')).acceleration, 'cpu');
});

test('an unsupported voice language cannot block language devices or CPU/Automatic choices', async () => {
  const service = new ModelDeviceService({
    root: fixture(),
    ollama: 'fixture',
    languageProbe: async () => [cuda],
    voiceProbe: async () => assert.fail('An unsupported voice has no runtime to probe'),
    hardware: async () => ({ gpus: [{ name: cuda.name }] }),
  });
  const catalog = await service.refresh('unsupported-language');
  assert.equal(catalog.voiceModel, null);
  assert.equal(catalog.options.language.find((device) => device.id === cuda.id).available, true);
  assert.deepEqual(
    catalog.options.voice.filter((device) => device.available).map((device) => device.id),
    ['auto', 'cpu'],
  );
  assert.equal(catalog.options.voice.find((device) => device.name === cuda.name).available, false);
  assert.deepEqual(
    await service.validate({ language: cuda.id, voice: 'cpu' }, 'unsupported-language'),
    { language: cuda.id, voice: 'cpu' },
  );
});

test('a failed device probe leaves the other model inventory usable and refreshing can recover', async () => {
  let failedRole = 'voice';
  const service = new ModelDeviceService({
    root: fixture(),
    ollama: 'fixture',
    languageProbe: async () => {
      if (failedRole === 'language') throw Error('Private backend error');
      return [cuda];
    },
    voiceProbe: async () => {
      if (failedRole === 'voice') throw Error('Private Python path');
      return [cuda];
    },
    hardware: async () => ({ gpus: [{ name: cuda.name }] }),
  });
  const voiceFailed = await service.refresh('en');
  assert(voiceFailed.options.language.some((device) => device.id === cuda.id && device.available));
  assert(!JSON.stringify(voiceFailed).includes('Private'));
  failedRole = 'language';
  const languageFailed = await service.refresh('en');
  assert(languageFailed.options.voice.some((device) => device.id === cuda.id && device.available));
  assert.deepEqual(
    languageFailed.options.language.filter((device) => device.available).map((device) => device.id),
    ['auto', 'cpu'],
  );
  failedRole = null;
  const recovered = await service.refresh('en');
  for (const role of ['language', 'voice'])
    assert(recovered.options[role].some((device) => device.id === cuda.id && device.available));
});
