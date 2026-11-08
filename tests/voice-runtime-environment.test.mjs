// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { voiceRuntimeEnvironment } from '../integrations/voice_runtime/environment.mjs';
test('only a valid AMD runtime receipt selects the packaged SDK before Python starts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-voice-env-'));
  mkdirSync(path.join(root, '.runtime'));
  const file = path.join(root, '.runtime/voice-runtime.json');
  assert.deepEqual(voiceRuntimeEnvironment(root), {});
  writeFileSync(file, '{');
  assert.deepEqual(voiceRuntimeEnvironment(root), {});
  for (const profile of ['legacy', 'blackwell']) {
    writeFileSync(file, JSON.stringify({ profile }));
    assert.deepEqual(voiceRuntimeEnvironment(root), {});
  }
  writeFileSync(file, JSON.stringify({ profile: 'amd' }));
  assert.deepEqual(voiceRuntimeEnvironment(root), { ROCM_SDK_TARGET_FAMILY: 'custom' });
  assert.equal(voiceRuntimeEnvironment(root).HSA_OVERRIDE_GFX_VERSION, undefined);
});
