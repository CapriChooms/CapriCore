// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { speechModelsInstalled } from '../apps/desktop/language-models.mjs';

const parent = path.join(root, '.runtime/voice-installation-unit');
mkdirSync(parent, { recursive: true });
const json = (file, value) => writeFileSync(file, JSON.stringify(value));

test('a profile and Python alone cannot advertise an English voice without adapter and TTS models', () => {
  const folder = mkdtempSync(path.join(parent, 'case-'));
  const profileDir = 'data/voices/capri/en/exports/capri-en-v1';
  const modelDir = 'data/speech/chatterbox-turbo';
  const put = (name, value = 'fixture') => {
    const file = path.join(folder, name);
    mkdirSync(path.dirname(file), { recursive: true });
    if (typeof value === 'object') json(file, value);
    else writeFileSync(file, value);
    return file;
  };
  put('config/companion-voice.json', { profileDir });
  assert.equal(speechModelsInstalled(folder, 'en'), false);
  const python = put('.runtime/voice-training-venv/Scripts/python.exe');
  put(profileDir + '/voice-profile.json', {
    language: 'en',
    engine: 'chatterbox-turbo',
    references: { neutral: { file: 'references/neutral.wav' } },
  });
  assert.equal(speechModelsInstalled(folder, 'en'), false, 'old code returned true here');
  put(profileDir + '/adapter.json', {});
  put(profileDir + '/adapter.safetensors');
  put(profileDir + '/references/neutral.wav');
  put('config/voice-training.json', { modelDir });
  const upstream = {
    model: {
      repository: 'fixture',
      revision: 'pinned',
      files: ['model.safetensors', 'tokenizer.json'],
    },
  };
  put('config/voice-upstream.json', upstream);
  const model = put(modelDir + '/model.safetensors');
  put(modelDir + '/tokenizer.json');
  assert.equal(speechModelsInstalled(folder, 'en'), false, 'download receipt is required');
  const receipt = {
    upstream,
    files: { 'model.safetensors': 'a'.repeat(64), 'tokenizer.json': 'b'.repeat(64) },
  };
  put(modelDir + '/model-receipt.json', receipt);
  assert.equal(speechModelsInstalled(folder, 'en'), true);
  writeFileSync(model, '');
  assert.equal(speechModelsInstalled(folder, 'en'), false, 'an empty download is not a model');
  writeFileSync(model, 'fixture');
  put(modelDir + '/model-receipt.json', { ...receipt, upstream: { model: { revision: 'wrong' } } });
  assert.equal(speechModelsInstalled(folder, 'en'), false);
  put(modelDir + '/model-receipt.json', receipt);
  assert.equal(speechModelsInstalled(folder, 'en'), true);
  unlinkSync(python);
  assert.equal(speechModelsInstalled(folder, 'en'), false);
});
