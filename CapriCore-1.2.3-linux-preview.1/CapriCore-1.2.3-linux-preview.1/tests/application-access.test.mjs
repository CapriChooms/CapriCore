import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ApplicationAccess } from '../apps/desktop/application-access.mjs';
const parent = path.resolve('.runtime/0.6.2/test-access');
mkdirSync(parent, { recursive: true });
test('pause persists before cancellation, blocks writes and preserves unrelated capabilities', async () => {
  const file = path.join(mkdtempSync(path.join(parent, 'case-')), 'access.json');
  const events = [];
  const access = new ApplicationAccess({
    file,
    stop: () => {
      assert.equal(new ApplicationAccess({ file }).enabled, false);
      events.push('stop');
    },
    changed: (state) => events.push(state.enabled),
  });
  assert.equal(access.enabled, true);
  await access.set(false);
  assert.deepEqual(events, ['stop', false]);
  for (const tool of ['application_control', 'desktop_control', 'spotify_control'])
    assert.throws(() => access.assertAllowed(tool, { action: 'launch' }), {
      code: 'APPLICATION_ACCESS_PAUSED',
    });
  access.assertAllowed('file_control', { action: 'read' });
  access.assertAllowed('desktop_control', { action: 'status' });
  assert.deepEqual(access.mask({ calculator: true, notepad: false }), {
    calculator: false,
    notepad: false,
  });
  await access.set(true);
  assert.equal(new ApplicationAccess({ file }).enabled, true);
  await assert.rejects(access.set('true'));
});
test('a failed worker stop cannot restore permissions or suppress the paused event', async () => {
  const file = path.join(mkdtempSync(path.join(parent, 'case-')), 'access.json');
  let emitted;
  const access = new ApplicationAccess({
    file,
    stop: async () => {
      throw new Error('worker lost');
    },
    changed: (value) => (emitted = value),
  });
  await assert.rejects(access.set(false));
  assert.deepEqual(emitted, { enabled: false });
  assert.equal(access.enabled, false);
});
