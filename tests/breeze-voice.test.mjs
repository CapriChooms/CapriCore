import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BREEZE_MODEL,
  BreezeVoice,
  loadBreezeProfile,
  prepareBreezeProfile,
  saveBreezeProfile,
  validateBreezeProfile,
} from '../apps/desktop/breeze-voice.mjs';
import { VoiceCatalogService } from '../apps/desktop/voice-catalog-service.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import { ModelDeviceService } from '../apps/desktop/model-device-service.mjs';
import { probeBreezeDevices } from '../apps/desktop/breeze-devices.mjs';
import { modelDevice, voiceDeviceLaunch } from '../packages/runtime/src/hardware/model-devices.mjs';
import { root as configRoot } from '../packages/runtime/src/host/paths.mjs';
import { saveModelDevices } from '../packages/runtime/src/model-device-settings.mjs';

async function fixtures(t) {
  await mkdir(path.join(configRoot, '.runtime'), { recursive: true });
  const root = await mkdtemp(path.join(configRoot, '.runtime/breeze-voice-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function profile(version, reference = 'Reference text') {
  const text = Buffer.from(reference);
  const header = Buffer.alloc(24);
  header.write('BRZV');
  for (const [index, value] of [version, 24000, 16, 1, text.length].entries())
    header.writeUInt32LE(value, (index + 1) * 4);
  return Buffer.concat([header, text, Buffer.alloc(version === 2 ? 72 : 64)]);
}

const wave = () =>
  Buffer.from(
    '524946462800000057415645666d74201000000001000100c05d000080bb0000020010006461746104000000004000c0',
    'hex',
  );

const radeon = 'AMD Radeon RX 6750 XT';
const vulkanRow = (index, name, driver) => `ggml_vulkan: ${index} = ${name} (${driver}) | uma: 0`;

test('Breeze settings expose the Radeon using its actual mask index, independently of the LLM or Python', async (t) => {
  const root = await fixtures(t);
  const engine = { executable: 'fixture-cli.exe', cwd: root };
  const expected = modelDevice('vulkan', 1, radeon);
  const pipGpu = modelDevice('rocm', 0, radeon);
  const llmGpu = modelDevice('vulkan', 0, radeon);
  await mkdir(path.join(root, 'data/speech'), { recursive: true });
  await writeFile(
    path.join(root, 'data/speech/voice-selections.json'),
    JSON.stringify({ schemaVersion: 1, languages: { en: BREEZE_MODEL } }),
  );
  saveModelDevices(root, { language: llmGpu.id, voice: pipGpu.id });
  let masked = [];
  const probe = () =>
    probeBreezeDevices(engine, {
      run: async (file, [missing], options) => {
        assert.equal(file, engine.executable);
        assert.match(missing, /capri-device-probe-[a-f0-9-]+\.gguf$/);
        const index = options.env.GGML_VK_VISIBLE_DEVICES;
        masked.push(index);
        const row =
          index === '0'
            ? vulkanRow(0, 'Software adapter', 'Software driver')
            : vulkanRow(0, radeon, 'AMD proprietary driver');
        throw Object.assign(new Error('Expected probe exit'), {
          code: 1,
          stderr: row + '\r\nfailed to load model\r\n',
        });
      },
    });
  const service = new ModelDeviceService({
    root,
    hardware: async () => ({ gpus: [{ name: radeon }, { name: radeon }] }),
    languageProbe: async () => [llmGpu],
    voiceProbe: async () => assert.fail('Breeze must use its native device inventory'),
    breezeProbe: probe,
  });
  const state = await service.refresh('en');
  assert.deepEqual(masked, [undefined, '0', '1']);
  assert.equal(state.current.voice, 'auto');
  assert.deepEqual(state.options.voice.slice(2), [expected]);
  const selected = { language: llmGpu.id, voice: expected.id };
  assert.deepEqual(await service.validate(selected, 'en'), selected);
  assert.notDeepEqual(llmGpu.id, expected.id);
  service.save(selected);
  assert.equal((await service.refresh('en')).current.voice, expected.id);

  const python = await voiceDeviceLaunch(
    root,
    'fixture',
    {},
    {
      probe: async () => assert.fail('A Breeze-only device must not reach a Python engine'),
    },
  );
  assert.equal(python.key, 'auto');
});

test('Breeze applies the saved Vulkan mask and rejects a CPU fallback or a different physical GPU', async (t) => {
  const root = await fixtures(t);
  saveBreezeProfile(root, { name: 'QA.breeze', bytes: profile(1) });
  const gpu = modelDevice('vulkan', 1, radeon);
  saveModelDevices(root, { language: 'auto', voice: gpu.id });
  let backend = 'Vulkan0',
    name = radeon;
  const voice = new BreezeVoice({
    root,
    installed: () => ({ executable: 'fixture-cli.exe', model: 'fixture.gguf', cwd: root }),
    run: async (_file, args, { env }) => {
      assert.equal(env.GGML_VK_VISIBLE_DEVICES, '1');
      assert.equal(args.includes('--cpu'), false);
      await writeFile(args[args.indexOf('--output') + 1], wave());
      return {
        stdout: `backend: ${backend}, sample rate: 24000\r\n`,
        stderr: vulkanRow(0, name, 'fixture-driver'),
      };
    },
  });
  assert.equal((await voice.synthesize({ text: 'QA fixture' })).ok, true);
  name = 'Different GPU';
  await assert.rejects(voice.synthesize({ text: 'QA fixture' }), /could not synthesize/);
  name = radeon;
  backend = 'CPU';
  await assert.rejects(voice.synthesize({ text: 'QA fixture' }), /could not synthesize/);
});

test('validates both profile versions and retains the last valid voice after a malformed import', async (t) => {
  const root = await fixtures(t);
  assert.equal(validateBreezeProfile(profile(1)).readUInt32LE(4), 1);
  assert.throws(() => validateBreezeProfile(profile(2, '')), /valid Breeze/);
  const invalid = profile(2);
  invalid.writeUInt32LE(2048, invalid.length - 4);
  assert.throws(() => validateBreezeProfile(invalid), /valid Breeze/);
  assert.throws(() => validateBreezeProfile(profile(2).subarray(0, -1)), /valid Breeze/);

  const library = new VoiceCatalogService({ root, configRoot });
  assert.throws(() => library.install({ modelId: BREEZE_MODEL, language: 'en' }), /license/);
  const source = path.join(root, 'Capri.breeze');
  await writeFile(source, profile(2));
  const imported = await library.importBreezeVoice(source);
  assert.deepEqual(imported.breezeVoice, { name: 'Capri.breeze' });
  assert.deepEqual(loadBreezeProfile(root).bytes, profile(2));
  await writeFile(source, invalid);
  await assert.rejects(library.importBreezeVoice(source), /valid Breeze/);
  assert.deepEqual(loadBreezeProfile(root).bytes, profile(2));
});

test('native Breeze preview uses the imported voice and CPU preference without an HTTP request', async (t) => {
  const root = await fixtures(t);
  const source = path.join(root, 'Capri.breeze');
  await writeFile(source, profile(2));
  saveBreezeProfile(root, prepareBreezeProfile(source));
  saveModelDevices(root, { language: 'auto', voice: 'cpu' });
  const signals = [];
  const native = new BreezeVoice({
    root,
    installed: () => ({ executable: 'fixture-cli.exe', model: 'fixture.gguf', cwd: root }),
    run: async (file, args, options) => {
      assert.equal(file, 'fixture-cli.exe');
      assert.equal(args[0], 'fixture.gguf');
      assert.deepEqual(args.slice(-2), ['--text', '你好，Capri。']);
      assert.ok(args.includes('--cpu'));
      assert.ok(args.includes('capri'));
      signals.push(options.signal);
      await writeFile(args[args.indexOf('--output') + 1], wave());
    },
  });
  const events = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8888',
    headers: () => assert.fail('Unexpected HTTP headers'),
    fetchImpl: () => assert.fail('Unexpected HTTP request'),
    language: 'zh',
    native: () => native,
    emit: (event) => events.push(event),
  });
  await voice.prepareLanguage();
  assert.equal(voice.snapshot().ready, true);
  assert.equal(voice.snapshot().source, 'local');
  voice.preview('breeze-preview', '你好，Capri。');
  for (let attempt = 0; attempt < 200 && !events.some((e) => e.type === 'voice.audio'); attempt++)
    await delay(10);
  const audio = events.find((e) => e.type === 'voice.audio');
  assert.ok(audio, 'Native audio reached the renderer queue');
  assert.equal(audio.sampleRate, 24000);
  assert.equal(Buffer.from(audio.pcm).readFloatLE(0), 0.5);
  assert.equal(Buffer.from(audio.pcm).readFloatLE(4), -0.5);
  assert.equal(signals.length, 1);
  assert.deepEqual(await readdir(path.join(root, '.runtime/breeze-voice-tmp')), []);
});
