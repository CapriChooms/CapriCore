// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncAwareness } from '../apps/desktop/awareness-sync.mjs';
import { voiceStartupError } from '../integrations/voice_runtime/startup-error.mjs';
import { responsiveness } from '../packages/runtime/src/hardware/responsiveness.mjs';
test('startup reduces concurrent model pressure when free RAM is low even on a larger-memory PC', () => {
  assert.equal(
    responsiveness({ ramBytes: 32 * 1024 ** 3, availableRamBytes: 3 * 1024 ** 3 }).sequentialModels,
    true,
  );
  assert.equal(
    responsiveness({ ramBytes: 32 * 1024 ** 3, availableRamBytes: 16 * 1024 ** 3 })
      .sequentialModels,
    false,
  );
});
test('concurrent startup/show callbacks share the observer; disabling still cancels it', async () => {
  let resolve,
    starts = 0,
    stops = 0;
  const observer = {
    status: 'off',
    child: null,
    start() {
      starts++;
      this.child = {};
      this.status = 'starting';
      this.starting = new Promise((r) => (resolve = r));
      return this.starting;
    },
    stop() {
      stops++;
      this.child = null;
      this.status = 'off';
    },
    snapshot() {
      return { active: true };
    },
  };
  const first = syncAwareness({ observer, enabled: true, prepare() {} });
  const second = syncAwareness({ observer, enabled: true, prepare() {} });
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  observer.status = 'active';
  resolve({ active: true });
  assert.deepEqual(await first, await second);
  await syncAwareness({ observer, enabled: true, prepare() {} });
  assert.equal(starts, 1);
  await syncAwareness({ observer, enabled: false, prepare() {} });
  assert.equal(stops, 1);
});
test('memory failure is shown only for the current voice process, never a stale report', () => {
  const now = Date.now(),
    value = {
      schemaVersion: 1,
      pid: 10,
      at: now,
      code: 'CAPRI_VOICE_COMMIT_LIMIT',
      memory: { availableCommit: 12 },
    };
  const error = voiceStartupError(value, { pid: 10, startedAt: now - 100 });
  assert.match(error.message, /paging file/);
  assert.equal(error.code, value.code);
  assert.equal(voiceStartupError(value, { pid: 11, startedAt: now - 100 }), null);
  assert.equal(voiceStartupError(value, { pid: 10, startedAt: now + 100 }), null);
});
