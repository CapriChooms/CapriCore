// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import { prepareVoiceCatalog } from '../packages/installer/src/voice-catalog-prepare.mjs';
import { validateVoicePack } from '../packages/installer/src/voice-pack.mjs';

const manifest = JSON.parse(readFileSync(path.join(root, 'config/installer.json'), 'utf8'));
const upstream = JSON.parse(readFileSync(path.join(root, 'config/voice-upstream.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fixture({ seed = true, custom = false } = {}) {
  const parent = path.join(root, '.runtime/voice-catalog-prepare-tests');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'case-'));
  const profileDir = custom
    ? 'data/voices/capri/en/imports/00000000-0000-4000-8000-000000000001/exports/capri-trained-00000000-0000-4000-8000-000000000002'
    : 'data/voices/capri/en/exports/capri-en-v1';
  writeJsonAtomic(path.join(folder, 'config/installer.json'), manifest);
  writeJsonAtomic(path.join(folder, 'config/voice-upstream.json'), upstream);
  writeJsonAtomic(path.join(folder, 'config/companion-voice.json'), { profileDir });
  // The catalog is already holding this lock. Preparation must not acquire it again.
  writeJsonAtomic(path.join(folder, '.runtime/installer/install.lock.json'), { pid: process.pid });
  if (seed || custom) {
    const voice = path.join(folder, custom ? profileDir : 'data/speech/bundled-voice');
    const adapter = Buffer.from('safe adapter fixture'),
      reference = Buffer.from('safe reference fixture');
    mkdirSync(path.join(voice, 'references'), { recursive: true });
    writeFileSync(path.join(voice, 'adapter.safetensors'), adapter);
    writeFileSync(path.join(voice, 'references/neutral.wav'), reference);
    writeJsonAtomic(path.join(voice, 'adapter.json'), {});
    writeJsonAtomic(path.join(voice, 'voice-profile.json'), {
      schemaVersion: 1,
      engine: 'chatterbox-turbo',
      language: 'en',
      id: custom ? 'capri-trained-user' : 'capri-en-v1',
      baseModel: upstream.model,
      adapter: 'adapter.safetensors',
      adapterConfig: 'adapter.json',
      adapterSha256: hash(adapter),
      references: { neutral: { file: 'references/neutral.wav', sha256: hash(reference) } },
    });
  }
  return { folder, profileDir };
}
function mockRuntime(folder) {
  let downloads = 0,
    extractions = 0;
  return {
    env: {},
    ownerStamp: () => '1234',
    async download(spec, cache) {
      assert.deepEqual(spec, manifest.artifacts.uv);
      assert.equal(cache, path.join(folder, '.runtime/installer/downloads'));
      downloads++;
      return path.join(cache, 'verified-uv.zip');
    },
    async execute(_file, args, options) {
      assert.equal(args[args.indexOf('-Component') + 1], 'archive');
      assert.equal(args[args.indexOf('-OwnerStamp') + 1], '1234');
      assert.equal(options.cwd, folder);
      const decoded = JSON.parse(
        Buffer.from(args[args.indexOf('-ArgumentsBase64') + 1], 'base64').toString('utf8'),
      );
      const destination = decoded[decoded.indexOf('-Destination') + 1];
      assert.equal(destination, path.join(folder, '.runtime/uv'));
      mkdirSync(destination, { recursive: true });
      writeFileSync(path.join(destination, 'uv.exe'), 'verified runtime fixture');
      extractions++;
    },
    counts: () => ({ downloads, extractions }),
  };
}

test('Qwen preparation repairs a clean API-only install using the verified bundled reference and pinned uv', async () => {
  const { folder, profileDir } = fixture();
  const mocks = mockRuntime(folder);
  assert.deepEqual(await prepareVoiceCatalog({ root: folder, ...mocks }), { profileDir });
  validateVoicePack(path.join(folder, profileDir), upstream.model);
  assert.deepEqual(mocks.counts(), { downloads: 1, extractions: 1 });
  await prepareVoiceCatalog({ root: folder, ...mocks });
  assert.deepEqual(mocks.counts(), { downloads: 1, extractions: 1 });
  writeFileSync(path.join(folder, '.runtime/uv/uv.exe'), 'damaged runtime fixture');
  await prepareVoiceCatalog({ root: folder, ...mocks });
  assert.deepEqual(mocks.counts(), { downloads: 2, extractions: 2 });
});

test('Qwen preparation preserves a valid custom voice and refuses missing reference data before downloading', async () => {
  const { folder, profileDir } = fixture({ custom: true });
  const mocks = mockRuntime(folder);
  await prepareVoiceCatalog({ root: folder, ...mocks });
  assert.equal(json(path.join(folder, 'config/companion-voice.json')).profileDir, profileDir);
  assert.equal(existsSync(path.join(folder, 'data/voices/capri/en/exports/capri-en-v1')), false);
  const missing = fixture({ seed: false });
  const missingMocks = mockRuntime(missing.folder);
  await assert.rejects(
    prepareVoiceCatalog({ root: missing.folder, ...missingMocks }),
    /reference voice is missing/,
  );
  assert.deepEqual(missingMocks.counts(), { downloads: 0, extractions: 0 });
});

test('cancelled Qwen preparation does not extract a runtime or activate an incomplete profile', async () => {
  const { folder, profileDir } = fixture();
  const mocks = mockRuntime(folder),
    controller = new AbortController();
  await assert.rejects(
    prepareVoiceCatalog({
      root: folder,
      ...mocks,
      signal: controller.signal,
      download: async (...args) => {
        const file = await mocks.download(...args);
        controller.abort();
        return file;
      },
    }),
    /abort/i,
  );
  assert.deepEqual(mocks.counts(), { downloads: 1, extractions: 0 });
  assert.equal(existsSync(path.join(folder, profileDir)), false);
});

test('Qwen preparation preserves valid local voice choices and repairs stale ones without modifying public defaults', async () => {
  const custom = fixture({ custom: true });
  const baseFile = path.join(custom.folder, 'config/companion-voice.json');
  const localFile = path.join(custom.folder, 'config/companion-voice.local.json');
  writeJsonAtomic(baseFile, { profileDir: 'data/voices/capri/en/exports/capri-en-v1' });
  writeJsonAtomic(localFile, { schemaVersion: 1, profileDir: custom.profileDir });
  const publicBytes = readFileSync(baseFile);
  assert.deepEqual(
    await prepareVoiceCatalog({ root: custom.folder, ...mockRuntime(custom.folder) }),
    { profileDir: custom.profileDir },
  );
  assert.equal(json(localFile).profileDir, custom.profileDir);
  assert.deepEqual(readFileSync(baseFile), publicBytes);

  const missing = fixture();
  const missingLocal = path.join(missing.folder, 'config/companion-voice.local.json');
  writeJsonAtomic(missingLocal, { schemaVersion: 1, profileDir: custom.profileDir });
  const missingBase = path.join(missing.folder, 'config/companion-voice.json');
  const before = readFileSync(missingBase);
  assert.deepEqual(
    await prepareVoiceCatalog({ root: missing.folder, ...mockRuntime(missing.folder) }),
    { profileDir: missing.profileDir },
  );
  assert.equal(existsSync(missingLocal), false);
  assert.deepEqual(readFileSync(missingBase), before);
});
