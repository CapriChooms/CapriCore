// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { root, writeJsonAtomic } from '../packages/runtime/src/index.mjs';
import { exportVoicePack } from '../tools/release/voice-pack-export.mjs';
import { importVoicePack, validateVoicePack } from '../packages/installer/src/voice-pack.mjs';

const parent = path.join(root, '.runtime/voice-pack-release-tests');
mkdirSync(parent, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fixture() {
  const folder = mkdtempSync(path.join(parent, 'pack-'));
  const source = path.join(folder, 'source');
  mkdirSync(path.join(source, 'references'), { recursive: true });
  const upstream = json(path.join(root, 'config/voice-upstream.json'));
  const adapter = Buffer.from('runtime adapter fixture');
  const reference = Buffer.from('reference fixture');
  writeFileSync(path.join(source, 'adapter.safetensors'), adapter);
  writeFileSync(path.join(source, 'references/neutral.wav'), reference);
  writeFileSync(path.join(source, 'private-history.txt'), 'private canary');
  writeFileSync(path.join(source, 'selection.json'), 'private review canary');
  writeJsonAtomic(path.join(source, 'adapter.json'), {
    schemaVersion: 1,
    engine: 'chatterbox-turbo',
    language: 'en',
    upstream,
    adapter: { rank: 8, alpha: 16, dropout: 0.05 },
    datasetSha256: 'private dataset canary',
    metrics: { notes: 'private metrics canary' },
  });
  writeJsonAtomic(path.join(source, 'voice-profile.json'), {
    schemaVersion: 1,
    id: 'capri-en-fixture',
    character: 'capri',
    language: 'en',
    engine: 'chatterbox-turbo',
    baseModel: upstream.model,
    adapter: 'adapter.safetensors',
    adapterConfig: 'adapter.json',
    adapterSha256: hash(adapter),
    references: { neutral: { file: 'references/neutral.wav', sha256: hash(reference) } },
    sampleRate: 24000,
    selection: 'private selection canary',
    localPath: 'private path canary',
  });
  return { source, destination: path.join(folder, 'public'), folder, upstream };
}
test('voice release includes runtime files and pinned provenance without training or history metadata', () => {
  const input = fixture();
  const { directory, manifest } = exportVoicePack(input);
  assert.deepEqual(readdirSync(directory).sort(), [
    'UPSTREAM-LICENSE.txt',
    'VOICE-PACK-NOTICE.md',
    'VOICE_PACK_MANIFEST.json',
    'adapter.json',
    'adapter.safetensors',
    'references',
    'voice-profile.json',
  ]);
  assert.equal(manifest.files.length, 4);
  for (const entry of manifest.files) {
    assert.equal(hash(readFileSync(path.join(directory, entry.path))), entry.sha256);
  }
  const profile = json(path.join(directory, 'voice-profile.json'));
  assert.equal(profile.selection, undefined);
  assert.equal(profile.localPath, undefined);
  const config = json(path.join(directory, 'adapter.json'));
  assert.equal(config.datasetSha256, undefined);
  assert.equal(config.metrics, undefined);
  assert.deepEqual(config.upstream, input.upstream);
  assert.equal(validateVoicePack(directory, input.upstream.model).profile.id, profile.id);
  const installed = path.join(input.folder, 'installed');
  const relative = importVoicePack(directory, installed, input.upstream.model);
  assert.equal(existsSync(path.join(installed, relative, 'adapter.safetensors')), true);
  assert.equal(existsSync(path.join(installed, relative, 'private-history.txt')), false);
  assert.equal(existsSync(path.join(installed, relative, 'VOICE_PACK_MANIFEST.json')), false);
  assert.equal(
    json(path.join(input.source, 'adapter.json')).datasetSha256,
    'private dataset canary',
  );
});
test('voice release rejects damaged adapters and incompatible metadata before creating an output', () => {
  for (const damaged of [true, false]) {
    const input = fixture();
    if (damaged) writeFileSync(path.join(input.source, 'adapter.safetensors'), 'broken');
    else {
      const file = path.join(input.source, 'adapter.json');
      writeJsonAtomic(file, { ...json(file), upstream: {} });
    }
    assert.throws(() => exportVoicePack(input), damaged ? /checksum/ : /metadata/);
    assert.equal(existsSync(input.destination), false);
  }
});

test('voice release accepts an existing adapter after the pack download changes', () => {
  const input = fixture();
  const file = path.join(input.source, 'adapter.json');
  const original = json(file);
  delete original.upstream.bundledPack;
  writeJsonAtomic(file, original);
  input.upstream.bundledPack = { url: 'https://example.invalid/current.zip', bytes: 2 };
  const { directory } = exportVoicePack(input);
  assert.deepEqual(json(path.join(directory, 'adapter.json')).upstream, input.upstream);
});

test('reinstalling the same voice ignores archive metadata and preserves the original export', () => {
  const input = fixture();
  const installed = path.join(input.folder, 'installed');
  const relative = importVoicePack(input.source, installed, input.upstream.model);
  const installedConfig = path.join(installed, relative, 'adapter.json');
  const before = readFileSync(installedConfig);
  const adapterFile = path.join(input.source, 'adapter.json');
  const adapter = json(adapterFile);
  adapter.upstream.bundledPack = { url: 'https://example.invalid/rebuilt.zip', bytes: 1 };
  writeFileSync(adapterFile, JSON.stringify(adapter));
  assert.equal(importVoicePack(input.source, installed, input.upstream.model), relative);
  assert.deepEqual(readFileSync(installedConfig), before);
  assert.deepEqual(readdirSync(path.dirname(path.join(installed, relative))), [
    path.basename(relative),
  ]);
});

test('different content with the same ID installs alongside the original and retries reuse it', () => {
  const input = fixture();
  const installed = path.join(input.folder, 'installed');
  const relative = importVoicePack(input.source, installed, input.upstream.model);
  const original = path.join(installed, relative);
  const config = path.join(input.source, 'adapter.json');
  const adapter = json(config);
  writeJsonAtomic(config, { ...adapter, adapter: { ...adapter.adapter, alpha: 32 } });
  const changed = importVoicePack(input.source, installed, input.upstream.model);
  assert.notEqual(changed, relative);
  assert.equal(json(path.join(original, 'adapter.json')).adapter.alpha, 16);
  assert.equal(json(path.join(installed, changed, 'adapter.json')).adapter.alpha, 32);
  assert.equal(importVoicePack(input.source, installed, input.upstream.model), changed);
  const changedDir = path.join(installed, changed);
  writeFileSync(path.join(changedDir, 'adapter.safetensors'), 'damaged revision');
  const repaired = importVoicePack(input.source, installed, input.upstream.model);
  assert.notEqual(repaired, changed);
  assert.equal(importVoicePack(input.source, installed, input.upstream.model), repaired);
  assert.equal(
    readFileSync(path.join(changedDir, 'adapter.safetensors'), 'utf8'),
    'damaged revision',
  );
  validateVoicePack(path.join(installed, repaired), input.upstream.model);
});

test('an incomplete earlier import is preserved and never mixed with new pack files', () => {
  const input = fixture();
  const installed = path.join(input.folder, 'installed');
  const old = path.join(installed, 'data/voices/capri/en/exports/capri-en-fixture');
  mkdirSync(old, { recursive: true });
  writeFileSync(path.join(old, 'adapter.json'), 'incomplete import');
  writeFileSync(path.join(old, 'notes.txt'), 'owner data');
  const relative = importVoicePack(input.source, installed, input.upstream.model);
  assert.notEqual(path.join(installed, relative), old);
  assert.deepEqual(readdirSync(old).sort(), ['adapter.json', 'notes.txt']);
  assert.equal(readFileSync(path.join(old, 'adapter.json'), 'utf8'), 'incomplete import');
  assert.equal(readFileSync(path.join(old, 'notes.txt'), 'utf8'), 'owner data');
  validateVoicePack(path.join(installed, relative), input.upstream.model);
});
