import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import catalog from '../config/tts-catalog.json' with { type: 'json' };
import {
  VoiceCatalogService,
  voiceDataPath,
  voiceBackendChanged,
} from '../apps/desktop/voice-catalog-service.mjs';
import { VoiceTrainingService } from '../apps/desktop/voice-training-service.mjs';
import { speechModelsInstalled } from '../apps/desktop/language-models.mjs';
import {
  readVoiceSettings,
  readTrainingSettings,
} from '../packages/runtime/src/voice-settings.mjs';

function fixture(t) {
  const parent = path.resolve('.runtime/voice-library-tests');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'case-'));
  const write = (name, value) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
    );
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write('config/tts-catalog.json', catalog);
  write('config/companion-voice.json', {
    schemaVersion: 1,
    profileDir: 'data/voices/capri/en/exports/original',
  });
  write('config/voice-training.json', {
    engine: 'chatterbox-turbo',
    language: 'en',
    modelDir: 'data/speech/turbo',
    datasetDir: 'data/voices/capri/en',
    training: { minimumFreeVramGiB: 5 },
  });
  write('config/multilingual-runtime.json', {
    tts: {
      directory: 'data/speech/multilingual',
      files: [{ file: 'weights.safetensors', bytes: 3 }],
    },
  });
  write('data/voices/capri/en/exports/original/voice-profile.json', { id: 'original' });
  write('.runtime/voice-training-venv/Scripts/python.exe', 'fixture');
  write('data/speech/turbo/model-receipt.json', {});
  write('data/speech/multilingual/weights.safetensors', 'abc');
  write('data/voices/capri/en/metadata.csv', 'fixture,'.repeat(30));
  return { root, write };
}

function result(write, jobId) {
  const profileDir = 'data/voices/capri/en/exports/capri-trained-' + jobId;
  write(profileDir + '/voice-profile.json', {
    engine: 'chatterbox-turbo',
    language: 'en',
    adapterSha256: 'a'.repeat(64),
  });
  write('data/speech/training-jobs/' + jobId + '/candidate.json', {
    schemaVersion: 1,
    jobId,
    modelId: 'chatterbox-turbo',
    language: 'en',
    profileDir,
    preview: 'preview.wav',
    quality: 'requires-listening',
  });
  write('data/speech/training-jobs/' + jobId + '/preview.wav', 'RIFF0000WAVEfixture');
}

test('voice library persists independent supported languages and stops speech before switching', async (t) => {
  const { root } = fixture(t);
  let stopped = 0;
  const library = new VoiceCatalogService({ root, beforeChange: async () => stopped++ });
  assert.equal(library.snapshot().models.length, catalog.models.length);
  await library.select({ language: 'en', modelId: 'chatterbox-multilingual-v3' });
  await library.select({ language: 'ru', modelId: 'chatterbox-multilingual-v3' });
  const restored = new VoiceCatalogService({ root }).snapshot();
  assert.equal(restored.selections.en, 'chatterbox-multilingual-v3');
  assert.equal(restored.selections.ru, 'chatterbox-multilingual-v3');
  assert.equal(stopped, 2);
  await assert.rejects(
    library.select({ language: 'ru', modelId: 'chatterbox-turbo' }),
    /does not support/,
  );
  assert.throws(() => voiceDataPath(root, '../outside'), /Invalid/);
});

test('Qwen installs in its own runtime and selected CPU voices do not require the CUDA environment', async (t) => {
  const { root, write } = fixture(t);
  write('config/qwen-tts-upstream.json', {
    directory: 'data/speech/qwen',
    files: [{ file: 'model.safetensors', bytes: 3 }],
  });
  let prepared = false,
    stopped = false;
  const library = new VoiceCatalogService({
    root,
    free: () => 20 * 1024 ** 3,
    ownerStamp: () => '123',
    beforeChange: async () => {
      stopped = true;
    },
    prepare: async () => {
      prepared = true;
    },
    run: async (executable, args, options) => {
      assert.equal(stopped, true);
      assert.equal(prepared, true);
      assert.equal(executable, 'powershell.exe');
      assert.ok(args.includes('qwen'));
      assert.ok(args.includes('-OwnerStamp'));
      assert.equal(options.env.HF_TOKEN, undefined);
      write('.runtime/qwen-tts-venv/Scripts/python.exe', 'fixture');
      write('data/speech/qwen/model.safetensors', 'abc');
      options.output('{"stage":"models","progress":50}');
    },
  });
  assert.equal(
    library.install({ modelId: 'qwen3-tts-0.6b-base', language: 'ru' }).phase,
    'installing',
  );
  await library.task;
  assert.equal(library.snapshot().phase, 'ready');
  assert.equal(library.busy(), false);
  await library.select({ modelId: 'qwen3-tts-0.6b-base', language: 'ru' });
  assert.equal(voiceBackendChanged(root, 'ru', 'en'), true);
  assert.equal(voiceBackendChanged(root, 'en', 'ru'), true);
  assert.equal(voiceBackendChanged(root, 'ru', 'off'), false);
  await library.select({ modelId: 'qwen3-tts-0.6b-base', language: 'en' });
  assert.equal(voiceBackendChanged(root, 'ru', 'en'), false);
  rmSync(path.join(root, '.runtime/voice-training-venv'), { recursive: true });
  assert.equal(speechModelsInstalled(root, 'ru'), true);
  assert.equal(speechModelsInstalled(root, 'en'), true);
});

test('voice installation checks free space and cancellation releases the shared installer lock', async (t) => {
  const { root } = fixture(t);
  const insufficient = new VoiceCatalogService({ root, free: () => 1 });
  assert.throws(
    () => insufficient.install({ modelId: 'qwen3-tts-0.6b-base', language: 'en' }),
    /space/i,
  );
  const library = new VoiceCatalogService({
    root,
    free: () => 20 * 1024 ** 3,
    ownerStamp: () => '123',
    prepare: async () => {},
    run: (_file, _args, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  });
  library.install({ modelId: 'qwen3-tts-0.6b-base', language: 'en' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await library.close();
  assert.equal(library.snapshot().phase, 'cancelled');
  assert.equal(library.busy(), false);
  assert.throws(
    () => insufficient.install({ modelId: 'qwen3-tts-0.6b-base', language: 'en' }),
    /space/i,
  );
});

test('dataset import changes only the validated dataset after success and exposes no source path', async (t) => {
  const { root, write } = fixture(t);
  const source = path.join(root, 'reviewed-input');
  mkdirSync(source);
  const service = new VoiceTrainingService({
    root,
    importRun: async ({ importId }) => {
      write('data/voices/capri/en/imports/' + importId + '/import-receipt.json', {
        schemaVersion: 1,
        importId,
        clips: 4,
        seconds: 20,
        reviewed: true,
      });
      write('data/voices/capri/en/imports/' + importId + '/metadata.csv', 'fixture,'.repeat(30));
    },
  });
  await service.importDataset({ source });
  const config = readTrainingSettings(root);
  assert.match(config.datasetDir, /^data\/voices\/capri\/en\/imports\/[a-f0-9-]+$/);
  assert.equal(config.allowProvisionalTranscripts, false);
  assert.equal(service.busy(), false);
  assert.equal(service.snapshot().available, true);
  assert.ok(!JSON.stringify(service.snapshot()).includes(source));
  const failed = new VoiceTrainingService({
    root,
    importRun: async () => {
      throw new Error('invalid');
    },
  });
  await assert.rejects(failed.importDataset({ source }), /invalid/);
  assert.deepEqual(readTrainingSettings(root), config);
  assert.equal(
    JSON.parse(readFileSync(path.join(root, 'config/voice-training.json'))).datasetDir,
    'data/voices/capri/en',
  );
});

test('voice switch failure preserves saved selection and missing weights remain unselectable', async (t) => {
  const { root, write } = fixture(t);
  const library = new VoiceCatalogService({
    root,
    beforeChange: async () => {
      throw new Error('busy');
    },
  });
  await assert.rejects(library.select({ language: 'en', modelId: 'chatterbox-turbo' }), /busy/);
  assert.deepEqual(library.snapshot().selections, {});
  write('data/speech/multilingual/weights.safetensors', 'corrupt length');
  await assert.rejects(
    library.select({ language: 'ru', modelId: 'chatterbox-multilingual-v3' }),
    /Install/,
  );
});

test('one-click training produces a preview candidate and applies only on explicit selection', async (t) => {
  const { root, write } = fixture(t);
  write('data/speech/voice-selections.json', {
    schemaVersion: 1,
    languages: { en: 'qwen3-tts-0.6b-base', ru: 'chatterbox-multilingual-v3' },
  });
  const phases = [];
  let stopped = 0;
  const service = new VoiceTrainingService({
    root,
    before: async () => stopped++,
    emit: (event) => phases.push(event.phase),
    run: async ({ jobId, onProgress }) => {
      onProgress({ stage: 'training', epoch: 1 });
      result(write, jobId);
    },
  });
  service.start({ modelId: 'chatterbox-turbo', language: 'en' });
  await service.task;
  assert.equal(service.snapshot().phase, 'review');
  assert.equal(readVoiceSettings(root).profileDir, 'data/voices/capri/en/exports/original');
  assert.equal(service.preview().mimeType, 'audio/wav');
  await service.apply();
  assert.equal(service.snapshot().phase, 'applied');
  assert.match(readVoiceSettings(root).profileDir, /capri-trained-/);
  assert.equal(stopped, 2);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, 'data/speech/voice-selections.json'))).languages,
    { en: 'chatterbox-turbo', ru: 'chatterbox-multilingual-v3' },
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(root, 'config/companion-voice.json'))).profileDir,
    'data/voices/capri/en/exports/original',
  );
  assert.ok(phases.includes('training'));
});

test('cancellation stops the worker and permits a later training run', async (t) => {
  const { root } = fixture(t);
  const service = new VoiceTrainingService({
    root,
    run: async ({ signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  });
  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  service.cancel();
  await service.task;
  assert.equal(service.snapshot().phase, 'cancelled');
  service.run = async ({ onProgress }) => onProgress({ stage: 'no-improvement' });
  service.start();
  await service.task;
  assert.equal(service.snapshot().phase, 'no-improvement');
});

test('training cannot use unsupported model recipes or provisional datasets', (t) => {
  const { root, write } = fixture(t);
  const service = new VoiceTrainingService({ root });
  assert.throws(
    () => service.start({ modelId: 'chatterbox-multilingual-v3', language: 'ru' }),
    /compatible fine-tuning/,
  );
  write('config/voice-training.json', {
    engine: 'chatterbox-turbo',
    language: 'en',
    allowProvisionalTranscripts: true,
  });
  assert.equal(service.snapshot().available, false);
  assert.throws(() => service.start(), /reviewed English/);
});

test('failed activation rolls the voice profile back and retains the candidate', async (t) => {
  const { root, write } = fixture(t);
  const previousSelections = {
    schemaVersion: 1,
    languages: { en: 'qwen3-tts-0.6b-base', ru: 'chatterbox-multilingual-v3' },
  };
  write('data/speech/voice-selections.json', previousSelections);
  const service = new VoiceTrainingService({
    root,
    ready: async () => {
      throw new Error('warmup failed');
    },
    run: async ({ jobId }) => result(write, jobId),
  });
  service.start();
  await service.task;
  await assert.rejects(service.apply(), /warmup failed/);
  assert.equal(service.snapshot().phase, 'review');
  assert.equal(
    JSON.parse(readFileSync(path.join(root, 'config/companion-voice.json'))).profileDir,
    'data/voices/capri/en/exports/original',
  );
  assert.equal(existsSync(path.join(root, 'config/companion-voice.local.json')), false);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, 'data/speech/voice-selections.json'))),
    previousSelections,
  );
});

test('voice local overrides reject extra properties and survive replacement of release defaults', (t) => {
  const { root, write } = fixture(t);
  const uuid = '11111111-1111-1111-1111-111111111111';
  const profileDir = 'data/voices/capri/en/exports/capri-trained-' + uuid;
  write('config/companion-voice.local.json', { schemaVersion: 1, profileDir });
  assert.equal(readVoiceSettings(root).profileDir, profileDir);
  write('config/companion-voice.json', {
    schemaVersion: 1,
    profileDir: 'data/voices/capri/en/exports/capri-en-v1',
    cpuThreads: 4,
  });
  assert.equal(readVoiceSettings(root).profileDir, profileDir);
  assert.equal(readVoiceSettings(root).cpuThreads, 4);
  write('config/companion-voice.local.json', { schemaVersion: 1, profileDir, port: 9999 });
  assert.throws(() => readVoiceSettings(root), /Invalid local voice selection/);
  write('config/voice-training.local.json', { schemaVersion: 1, datasetDir: '../private' });
  assert.throws(() => readTrainingSettings(root), /Invalid local voice selection/);
});

test('restored jobs report interruption and candidate path tampering is rejected', async (t) => {
  const { root, write } = fixture(t);
  const jobId = '11111111-1111-1111-1111-111111111111';
  write('data/speech/voice-training-status.json', { phase: 'training', jobId });
  assert.equal(new VoiceTrainingService({ root }).snapshot().phase, 'interrupted');
  result(write, jobId);
  write('data/speech/voice-training-status.json', { phase: 'review', jobId });
  write('data/speech/training-jobs/' + jobId + '/candidate.json', {
    schemaVersion: 1,
    jobId,
    modelId: 'chatterbox-turbo',
    language: 'en',
    profileDir: '../outside',
    preview: 'preview.wav',
    quality: 'requires-listening',
  });
  const service = new VoiceTrainingService({ root });
  assert.throws(() => service.preview(), /candidate is invalid/);
  await assert.rejects(service.apply(), /candidate is invalid/);
});

test('concurrent service instances cannot start a second training worker', async (t) => {
  const { root } = fixture(t);
  let finish;
  const service = new VoiceTrainingService({
    root,
    run: async ({ onProgress }) => {
      await new Promise((resolve) => (finish = resolve));
      onProgress({ stage: 'no-improvement' });
    },
  });
  service.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => new VoiceTrainingService({ root }).start(), /already running/);
  finish();
  await service.task;
});
