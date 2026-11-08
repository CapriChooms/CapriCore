// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import {
  INFERENCE_STARTUP_DEFAULTS,
  inferenceStartupSettings,
} from '../apps/desktop/inference-startup.mjs';
import { Preferences } from '../apps/desktop/preferences.mjs';

test('API startup defaults skip local language weights and accept only the explicit boolean policy', () => {
  assert.deepEqual(INFERENCE_STARTUP_DEFAULTS, { skipLocalModelOnApi: true });
  assert.deepEqual(inferenceStartupSettings({ skipLocalModelOnApi: false }), {
    skipLocalModelOnApi: false,
  });
  for (const value of [
    null,
    [],
    {},
    { skipLocalModelOnApi: 'false' },
    { skipLocalModelOnApi: true, key: 'extra' },
  ])
    assert.throws(() => inferenceStartupSettings(value), /Invalid/);
});

test('the startup choice survives closing settings and restarting without changing API profiles', () => {
  const parent = path.resolve('.runtime/inference-startup-settings-test');
  mkdirSync(parent, { recursive: true });
  const file = path.join(mkdtempSync(path.join(parent, 'run-')), 'startup.json');
  const open = () => new Preferences(file, INFERENCE_STARTUP_DEFAULTS, inferenceStartupSettings);
  assert.equal(open().value.skipLocalModelOnApi, true);
  open().set({ skipLocalModelOnApi: false });
  assert.equal(open().value.skipLocalModelOnApi, false);
  open().set({ skipLocalModelOnApi: true });
  assert.equal(open().value.skipLocalModelOnApi, true);
});
