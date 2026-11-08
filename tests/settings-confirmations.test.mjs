// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsApi } from '../apps/desktop/renderer/settings-api.mjs';
import { ConfirmationRequests } from '../apps/desktop/renderer/confirmation-requests.mjs';
import { Confirmations } from '../apps/desktop/main/confirmations.mjs';

test('restart is an explicit current choice and cannot approve an unrelated confirmation', async () => {
  const events = [];
  const broker = new Confirmations({ show() {}, emit: (value) => events.push(value) });
  const binary = broker.request({ title: 'Enable access?' });
  const firstId = events.at(-1).id;
  assert.equal(broker.respond({ id: firstId, choice: 'restart' }), false);
  broker.respond({ id: firstId, choice: 'cancel' });
  assert.equal(await binary, false);
  for (const choice of ['restart', 'confirm', 'cancel']) {
    const action = broker.choose({
      title: 'Quit Capri?',
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'restart', label: 'Restart' },
        { id: 'confirm', label: 'Quit and unload models' },
      ],
    });
    const id = events.at(-1).id;
    assert.equal(await broker.choose({ title: 'Duplicate' }), 'cancel');
    assert.equal(broker.respond({ id: firstId, choice }), false, 'Ignore a stale dialog');
    assert.equal(broker.respond({ id, choice: 'unknown' }), false);
    assert.equal(broker.respond({ id, choice }), true);
    assert.equal(await action, choice);
    assert.equal(broker.respond({ id, choice }), false, 'Never dispatch an action twice');
  }
});

test('multi-action confirmation still respects the read delay and cancellation', async () => {
  let now = 0,
    id;
  const broker = new Confirmations({
    show() {},
    now: () => now,
    emit: (value) => {
      id = value.id;
    },
  });
  const options = {
    delayMs: 3000,
    choices: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'restart', label: 'Restart' },
    ],
  };
  const delayed = broker.choose(options);
  assert.equal(broker.respond({ id, choice: 'restart' }), false);
  now = 3000;
  assert.equal(broker.respond({ id, choice: 'restart' }), true);
  assert.equal(await delayed, 'restart');
  const cancelled = broker.choose(options);
  broker.cancel();
  assert.equal(await cancelled, 'cancel');
  assert.throws(() => broker.choose({ choices: [{ id: 'restart' }] }), /choices/);
});

test('Spotify approval cannot block on its own settings write; saves still flush with revisions', async () => {
  const writes = new Set(),
    saved = [],
    revisions = { speech: 'old' };
  let broker, seenRevision;
  const save = Promise.withResolvers();
  const shown = Promise.withResolvers();
  const requests = new ConfirmationRequests({
    prepare: () => Promise.allSettled([...writes]).then(() => true),
    dialog: {
      ask: async (value) => {
        shown.resolve(value);
        return 'confirm';
      },
    },
    respond: (value) => Promise.resolve(broker.respond(value)),
  });
  broker = new Confirmations({
    show() {},
    emit: (value) => {
      if (value.type === 'confirmation.request') void requests.request(value);
      else requests.close(value.id);
    },
  });
  const api = settingsApi(
    {
      setSpeechSettings: (_value, revision) => {
        seenRevision = revision;
        return save.promise;
      },
      setSpotifyAccess: () => broker.request({ title: 'Enable Spotify?' }),
    },
    { writes, revisions: () => revisions, saved: (panel) => saved.push(panel) },
  );
  const saving = api.setSpeechSettings({ trailingSilenceSeconds: 1 });
  const action = api.setSpotifyAccess(true);
  assert.equal(writes.size, 1, 'Only draft persistence may block the leave-settings barrier');
  assert.equal(seenRevision, 'old');
  save.resolve({ settings: { trailingSilenceSeconds: 1 }, revision: 'new' });
  assert.deepEqual(await saving, { trailingSilenceSeconds: 1 });
  assert.equal((await shown.promise).title, 'Enable Spotify?');
  assert.equal(await action, true);
  assert.equal(writes.size, 0);
  assert.equal(revisions.speech, 'new');
  assert.deepEqual(saved, ['speech-panel']);
});

test('failed draft writes keep their draft and revision, and release the navigation barrier', async () => {
  const writes = new Set(),
    revisions = { languages: 'current' };
  const api = settingsApi(
    {
      setLanguages: async () => {
        throw Error('Conflict');
      },
    },
    {
      writes,
      revisions: () => revisions,
      saved: () => assert.fail('Failed writes are not saved'),
    },
  );
  await assert.rejects(api.setLanguages({ speech: 'en' }), /Conflict/);
  assert.equal(writes.size, 0);
  assert.equal(revisions.languages, 'current');
});

test('an expired backend approval closes the UI and rejects a late confirm', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const broker = new Confirmations({ show() {}, emit: (value) => events.push(value) });
  const result = broker.request({ title: 'Enable?' });
  const { id } = events[0];
  t.mock.timers.tick(180000);
  assert.equal(await result, false);
  assert.deepEqual(events.at(-1), { type: 'confirmation.closed', id });
  assert.equal(broker.respond({ id, choice: 'confirm' }), false);
  const next = broker.request({ title: 'Retry' });
  broker.respond({ id: events.at(-1).id, choice: 'confirm' });
  assert.equal(await next, true);
});

test('cancellation during draft saving never resurrects an expired confirmation', async () => {
  const saving = Promise.withResolvers();
  const requests = new ConfirmationRequests({
    prepare: () => saving.promise,
    dialog: { ask: () => assert.fail('Expired confirmation must not open') },
    respond: () => assert.fail('Expired confirmation must not submit'),
  });
  const request = requests.request({ id: 'expired' });
  requests.close('other');
  assert.equal(requests.pending.get('expired').signal.aborted, false);
  requests.close('expired');
  saving.resolve(true);
  await request;
  assert.equal(requests.pending.size, 0);
});

test('confirmation lifetime aborts an open dialog and isolates a later request', async () => {
  const shown = Promise.withResolvers(),
    replies = [];
  let calls = 0;
  const requests = new ConfirmationRequests({
    prepare: async () => true,
    dialog: {
      ask: ({ signal }) => {
        calls++;
        if (calls > 1) return Promise.resolve('confirm');
        shown.resolve();
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve('cancel'), { once: true }),
        );
      },
    },
    respond: async (value) => replies.push(value),
  });
  const first = requests.request({ id: 'first' });
  await shown.promise;
  await requests.request({ id: 'first' });
  assert.equal(calls, 1, 'Duplicate events must not enqueue duplicate dialogs');
  requests.close('first');
  await first;
  await requests.request({ id: 'second' });
  assert.deepEqual(replies, [{ id: 'second', choice: 'confirm' }]);
  assert.equal(requests.pending.size, 0);
});

test('unsaved changes and UI failures fail closed without keeping an approval pending', async () => {
  const replies = [];
  const requests = new ConfirmationRequests({
    prepare: async () => false,
    dialog: { ask: () => assert.fail('Stay on unsaved settings') },
    respond: async (value) => replies.push(value),
  });
  await requests.request({ id: 'unsaved' });
  requests.prepare = async () => {
    throw Error('Unable to save');
  };
  await assert.rejects(requests.request({ id: 'failed' }), /Unable to save/);
  assert.deepEqual(replies, [
    { id: 'unsaved', choice: 'cancel' },
    { id: 'failed', choice: 'cancel' },
  ]);
  assert.equal(requests.pending.size, 0);
});
