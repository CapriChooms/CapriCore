// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { replyHistory, ReplyPages } from '../apps/desktop/renderer/reply-pages.mjs';

const assistant = (id, text) => ({ id, role: 'assistant', text });
const fits = (value) => Array.from(value).length <= 30;

test('reply history forwards only recent assistant id/text and replaces duplicate streamed snapshots', () => {
  const rows = Array.from({ length: 40 }, (_, index) =>
    assistant(`reply-${index}`, `Answer ${index}.`),
  );
  rows.push({ id: 'user', role: 'user', text: 'Private user text', key: 'private' });
  rows.push({
    ...assistant('reply-39', 'Updated answer.'),
    token: 'private',
    metadata: { path: 'private' },
  });
  const history = replyHistory(rows);
  assert.equal(history.length, 30);
  assert.equal(history[0].id, 'reply-10');
  assert.deepEqual(history.at(-1), { id: 'reply-39', text: 'Updated answer.' });
  assert(history.every((row) => Object.keys(row).join(',') === 'id,text'));
  assert(!JSON.stringify(history).includes('private'));
  assert.deepEqual(replyHistory(null), []);
  let called = false;
  assert.deepEqual(
    replyHistory([
      Object.defineProperty({}, 'role', {
        get: () => {
          called = true;
        },
      }),
    ]),
    [],
  );
  assert.equal(called, false);
});

test('history bounds each reply and total text without splitting a surrogate pair', () => {
  const history = replyHistory(
    Array.from({ length: 30 }, (_, i) => assistant(String(i), '😺'.repeat(10000))),
  );
  assert.equal(history.length, 4);
  assert.equal(
    history.reduce((total, row) => total + row.text.length, 0),
    64000,
  );
  assert(history.every((row) => row.text.length <= 16000 && row.text.isWellFormed()));
  const edge = replyHistory([assistant('edge', 'a'.repeat(15999) + '😺')])[0].text;
  assert.equal(edge.length, 15999);
  assert(edge.isWellFormed());
});

test('default view follows the live cue while navigation crosses full historical replies', () => {
  const pager = new ReplyPages();
  const history = replyHistory([
    assistant('first', 'The first completed answer.'),
    assistant('second', 'A second completed answer.'),
    assistant('current', 'A current full answer. Another sentence.'),
  ]);
  const value = pager.update({ text: 'Another sentence.', turnId: 'current', history }, fits);
  assert.equal(value.text, 'Another sentence.');
  assert.equal(value.index, 3);
  assert.equal(value.total, 4);
  assert.equal(value.previous, true);
  assert.equal(value.next, false);
  assert.equal(pager.step(-1).text, 'A current full answer.');
  assert.equal(pager.step(-1).text, 'A second completed answer.');
  assert.equal(pager.step(-1).text, 'The first completed answer.');
  assert.equal(pager.step(-1).index, 0);
  assert.equal(pager.step(1).text, 'A second completed answer.');
});

test('stream updates replace one record, preserve manual selection and reset for a new message', () => {
  const pager = new ReplyPages();
  const older = { id: 'older', text: 'Earlier reply.' };
  pager.update(
    {
      text: 'First sentence.',
      turnId: 'current',
      history: [older, { id: 'current', text: 'First sentence.' }],
    },
    fits,
  );
  assert.equal(pager.step(-1).text, 'Earlier reply.');
  const expanded = 'First sentence. A second thought. A final sentence.';
  let view = pager.update(
    {
      text: 'A final sentence.',
      turnId: 'current',
      history: [older, { id: 'current', text: expanded }],
    },
    fits,
  );
  assert.equal(view.text, 'Earlier reply.');
  assert.equal(view.index, 0);
  assert.equal(view.total, 4);
  view = pager.update(
    {
      text: 'A final sentence.',
      turnId: 'current',
      history: [older, { id: 'current', text: expanded }],
    },
    fits,
  );
  assert.equal(view.total, 4, 'Repeated snapshots never append streamed fragments');
  view = pager.update(
    {
      text: 'New reply.',
      turnId: 'new',
      history: [older, { id: 'current', text: expanded }, { id: 'new', text: 'New reply.' }],
    },
    fits,
  );
  assert.equal(view.text, 'New reply.');
  assert.equal(view.index, view.total - 1);
});

test('an empty live cue hides without erasing history, while an empty message id clears it', () => {
  const pager = new ReplyPages();
  const history = [
    { id: 'old', text: 'An older reply.' },
    { id: 'live', text: 'Current answer.' },
  ];
  pager.update({ text: 'Current answer.', turnId: 'live', history }, fits);
  pager.step(-1);
  assert.deepEqual(pager.update({ text: '', turnId: 'live' }, fits), {
    text: '',
    index: 0,
    total: 0,
    previous: false,
    next: false,
  });
  assert.equal(
    pager.update({ text: 'Current answer.', turnId: 'live', history }, fits).text,
    'An older reply.',
  );
  assert.equal(pager.update({ text: '', turnId: '', history }, fits).total, 0);
  assert.equal(pager.step(-1).text, '');
  assert.equal(pager.update({ text: 'After reset.', turnId: 'after' }, fits).total, 1);
});

test('missing history uses a single current record and preserves well-formed Unicode pages', () => {
  const pager = new ReplyPages();
  const cue = '😺'.repeat(80);
  let view = pager.update({ text: cue, turnId: 'fixture' }, fits);
  assert.equal(view.text, '😺'.repeat(30));
  assert.equal(view.total, 3);
  for (let index = 0; index < 2; index++) {
    view = pager.step(1);
    assert(view.text.isWellFormed());
    assert(Array.from(view.text).length <= 30);
  }
  view = pager.update({ text: 'Replacement.', turnId: 'fixture' }, fits);
  assert.equal(view.total, 1);
  assert.equal(view.text, 'Replacement.');
  view = pager.update({ text: 'x'.repeat(900), turnId: 'new' }, () => true);
  assert.equal(view.text.length, 512);
  assert.equal(
    view.total,
    3,
    'Even permissive measurement keeps historical pages within240 code points',
  );
});

test('a narrow bubble starts with a fitted page instead of clipping an overlong live cue', () => {
  const pager = new ReplyPages();
  const text = 'A long current reply. Another complete thought. A final complete thought.';
  const view = pager.update({ text, turnId: 'current', history: [{ id: 'current', text }] }, fits);
  assert(view.text.length <= 30);
  assert.equal(view.index, 0);
  assert.equal(view.next, true);
  assert.equal(pager.step(1).text, 'Another complete thought.');
});

test('temporarily hiding a cue does not move an earlier repeated sentence to the final occurrence', () => {
  const pager = new ReplyPages();
  const history = [{ id: 'current', text: 'Repeat. Middle. Repeat.' }];
  const short = (value) => value.length <= 8;
  assert.equal(pager.update({ text: 'Repeat.', turnId: 'current', history }, short).index, 0);
  pager.update({ text: '', turnId: 'current', history }, short);
  assert.equal(pager.update({ text: 'Repeat.', turnId: 'current', history }, short).index, 0);
});

test('unchanged replies are cached, and resize reflow retains the selected record and text anchor', () => {
  const pager = new ReplyPages();
  let calls = 0,
    width = 30;
  const measure = (value) => {
    calls++;
    return value.length <= width;
  };
  const older = { id: 'old', text: 'First old sentence. Second old sentence. Third old sentence.' };
  const live = { id: 'live', text: 'A current answer.' };
  pager.update({ text: live.text, turnId: live.id, history: [older, live] }, measure);
  const measured = calls;
  pager.update({ text: live.text, turnId: live.id, history: [older, live] }, measure);
  assert.equal(calls, measured);
  pager.step(-1);
  const selected = pager.view().text;
  width = 18;
  const reflowed = pager.refresh();
  assert(calls > measured);
  assert.notEqual(reflowed.text, live.text);
  assert(older.text.includes(reflowed.text));
  width = 30;
  assert.equal(pager.refresh().text, selected);
});
