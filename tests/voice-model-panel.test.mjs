// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  voiceModelInstallLanguage,
  voiceModelInstallState,
  voiceModelInstallProgress,
} from '../apps/desktop/renderer/voice-model-panel.mjs';

const qwen = { id: 'qwen', backend: 'qwen3-tts' };
const chatterbox = {
  id: 'multilingual',
  backend: 'chatterbox-multilingual-v3',
  installLanguage: 'ru',
};

test('French multilingual downloads use French while English still requests shared multilingual weights', () => {
  assert.equal(voiceModelInstallLanguage(chatterbox, 'fr'), 'fr');
  assert.equal(voiceModelInstallLanguage(chatterbox, 'zh'), 'zh');
  assert.equal(voiceModelInstallLanguage(chatterbox, 'en'), 'ru');
  assert.equal(voiceModelInstallLanguage({ backend: 'chatterbox-turbo' }, 'en'), 'en');
});

test('voice installation errors belong to their selected backend and language', () => {
  const catalog = {
    phase: 'error',
    installingModelId: 'qwen',
    installingLanguage: 'fr',
    error: 'Qwen failed',
    progress: 0,
  };
  const speech = {
    phase: 'error',
    selection: { speech: 'fr', recognition: 'off' },
    error: 'Unsupported GPU',
    errorCode: 'CAPRI_VOICE_GPU_UNSUPPORTED',
  };
  assert.equal(voiceModelInstallState(catalog, speech, chatterbox, 'fr'), speech);
  assert.equal(voiceModelInstallState(catalog, speech, qwen, 'fr'), catalog);
  assert.deepEqual(voiceModelInstallState(catalog, speech, chatterbox, 'de'), { phase: 'idle' });
  assert.deepEqual(voiceModelInstallState(catalog, speech, qwen, 'de'), { phase: 'idle' });
  assert.equal(voiceModelInstallProgress(catalog), null, 'A stale 0% must not follow an error.');
});

test('running voice installations remain visible and accept both installer progress schemas', () => {
  const catalog = { phase: 'installing', progress: 25 };
  const speech = { phase: 'installing', progress: { received: 2, total: 8 } };
  assert.equal(voiceModelInstallState(catalog, {}, chatterbox, 'fr'), catalog);
  assert.equal(voiceModelInstallState({ phase: 'idle' }, speech, qwen, 'fr'), speech);
  for (const progress of [25, { received: 2, total: 8 }, { completed: 2, total: 8 }])
    assert.equal(voiceModelInstallProgress({ phase: 'installing', progress }), 25);
  assert.equal(voiceModelInstallProgress({ phase: 'installing', progress: { total: 8 } }), null);
  assert.equal(voiceModelInstallProgress({ phase: 'ready', progress: 100 }), null);
});
