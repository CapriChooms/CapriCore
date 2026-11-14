// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Confirmations } from '../apps/desktop/main/confirmations.mjs';
import { ScreenCapturePolicy } from '../apps/desktop/screen-capture-policy.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import {
  savePersonality,
  readPersonality,
  defaultPersonality,
  initializePersonality,
} from '../packages/runtime/src/personality.mjs';

test('destructive confirmations accept only the active request and fail closed', async () => {
  let event;
  const broker = new Confirmations({
    show: () => {},
    emit: (value) => {
      event = value;
    },
  });
  const accepted = broker.request({ title: 'Clear?' });
  assert.equal(broker.respond({ id: 'invented', choice: 'confirm' }), false);
  assert.equal(await broker.request({ title: 'Other?' }), false);
  assert.equal(broker.respond({ id: event.id, choice: 'confirm' }), true);
  assert.equal(await accepted, true);
  const denied = broker.request({ title: 'Clear?' });
  broker.cancel();
  assert.equal(await denied, false);
});
test('a stopped or expired screen selection can be explicitly renewed without granting a different source', async () => {
  let now = 1;
  const native = [{ id: 'window:123:0', name: 'Selected' }];
  const frame = { url: 'capri://desktop/index.html' };
  const policy = new ScreenCapturePolicy({
    sources: async () => native,
    ownerFrame: () => frame,
    now: () => now,
  });
  const [selection] = await policy.discover();
  const first = policy.prepare(selection.id, { mode: 'watch' });
  policy.stop();
  now += 60000;
  const second = policy.prepare(selection.id, { mode: 'watch' });
  assert.notEqual(second.id, first.id);
  native.length = 0;
  await policy.consume(
    {
      frame,
      securityOrigin: 'capri://desktop',
      videoRequested: true,
      audioRequested: false,
      userGesture: true,
    },
    (reply) => assert.deepEqual(reply, {}),
  );
  assert.equal(policy.snapshot().active, false);
  policy.clear();
  assert.throws(() => policy.prepare(selection.id), /Choose/);
});
test('voice preparation failure releases queued speech instead of leaving a permanent pending turn', async () => {
  const events = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    emit: (event) => events.push(event),
    fetchImpl: async () => new Response('{}', { status: 503 }),
  });
  voice.beginTurn('pending');
  await voice.prepareLanguage();
  assert.equal(voice.ready, false);
  assert.ok(voice.snapshot().error);
  assert.equal(voice.turn, null);
  voice.beginTurn('another');
  assert.equal(voice.turn, null);
  assert.ok(events.some((event) => event.type === 'voice.cancelled'));
  voice.setReady(true);
  voice.beginTurn('recovered');
  assert.equal(voice.turn.id, 'recovered');
  voice.cancel();
});
test('closing Capri aborts voice preparation immediately without reporting a cancellation as failure', async () => {
  const events = [];
  let requestSignal;
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    emit: (event) => events.push(event),
    fetchImpl: (_url, options) =>
      new Promise((_resolve, reject) => {
        requestSignal = options.signal;
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
      }),
  });
  const preparation = voice.prepareLanguage();
  voice.close();
  await preparation;
  assert.equal(requestSignal.aborted, true);
  assert.equal(voice.prepareController, null);
  assert.ok(!events.some((event) => event.type === 'voice.error'));
});

test('plain Personality file accepts external edits and empty reset without resurrecting the legacy JSON', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'capri-personality-'));
  writeFileSync(
    path.join(folder, 'personality.json'),
    JSON.stringify({ schemaVersion: 1, text: 'Legacy' }),
  );
  initializePersonality(folder, { backupDirectory: path.join(folder, 'backups') });
  assert.equal(readPersonality(folder), 'Legacy');
  savePersonality(folder, 'A new character.');
  writeFileSync(path.join(folder, 'PERSONALITY.md'), '\ufeffEdited in a text editor.');
  assert.equal(readPersonality(folder), 'Edited in a text editor.');
  savePersonality(folder, '');
  assert.equal(readPersonality(folder), defaultPersonality());
});
