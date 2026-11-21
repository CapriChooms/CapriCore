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
