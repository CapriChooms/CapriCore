// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AttachmentDrafts } from '../apps/desktop/attachments.mjs';
import { AttachmentHistory, historyAttachments } from '../apps/desktop/attachment-history.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';
import { resourceResponse } from '../apps/desktop/main/protocol.mjs';
import { visionImage } from './fixtures/vision-image.mjs';

function fixture(options = {}) {
  const parent = path.resolve('.runtime/test-data/attachment-history');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'fixture-'));
  const store = new TranscriptStore(path.join(directory, 'transcript.json'));
  const image = visionImage();
  const history = new AttachmentHistory({
    directory: path.join(directory, 'conversation-attachments'),
    references: () => store.snapshot(),
    normalizeImage: () => ({ preview: image, thumb: image }),
    ...options,
  });
  store.onAttachmentsChanged = () => history.prune();
  const message = (attachments) => ({
    id: randomUUID(),
    turnId: randomUUID(),
    role: 'user',
    text: 'Public fixture question.',
    status: 'complete',
    createdAt: new Date().toISOString(),
    attachments,
  });
  return { directory, store, history, image, message };
}

test('accepted file names and bounded original sizes survive drafts without changing inference content', () => {
  const drafts = new AttachmentDrafts({ canSee: () => true, validImage: () => true });
  const frame = {};
  const text = drafts.add(
    {
      name: 'C:\\private\\notes.txt',
      originalBytes: 4096,
      bytes: Buffer.from('Synthetic document text'),
    },
    frame,
  );
  assert.equal(text.accepted, true);
  const [file] = drafts.take([text.id], frame, { includeMetadata: true });
  assert.deepEqual(file.metadata, { name: 'notes.txt', kind: 'document', bytes: 4096 });
  assert.equal(file.text, 'Synthetic document text');
  const video = drafts.add(
    { name: 'clip.mp4', originalBytes: 32 * 1024 * 1024, bytes: visionImage() },
    frame,
  );
  assert.equal(video.accepted, true);
  assert.equal(drafts.take([video.id], frame, { includeMetadata: true })[0].metadata.kind, 'video');
  assert.equal(
    drafts.add(
      { name: 'clip.mp4', originalBytes: 32 * 1024 * 1024 + 1, bytes: visionImage() },
      frame,
    ).accepted,
    false,
  );
  assert.equal(
    drafts.add({ name: 'notes.txt', originalBytes: -1, bytes: Buffer.from('text') }, frame)
      .accepted,
    false,
  );
});

test('the transcript retains only canonical display metadata and opaque re-encoded image derivatives', async () => {
  const f = fixture();
  const attachments = f.history.persist([
    { png: f.image, metadata: { name: '../private/photo.png', kind: 'image', bytes: 200 } },
    {
      text: 'PRIVATE_SYNTHETIC_DOCUMENT',
      metadata: { name: 'notes.txt', kind: 'document', bytes: 700 },
    },
  ]);
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].name, 'photo.png');
  assert.equal(attachments[0].preview, true);
  assert.equal(attachments[1].preview, false);
  f.store.put(f.message(attachments));
  const saved = readFileSync(f.store.file, 'utf8');
  assert.ok(!/PRIVATE_SYNTHETIC_DOCUMENT|private\/|data:|base64|\.png\./.test(saved));
  assert.equal(readdirSync(f.history.directory).length, 2);
  const restored = new TranscriptStore(f.store.file);
  assert.deepEqual(restored.snapshot()[0].attachments, attachments);
  const uri = `capri://desktop/attachments/${attachments[0].id}/thumb.png`;
  const response = resourceResponse({ url: uri, method: 'GET' }, new Map(), {
    attachments: f.history,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.image);
  for (const url of [
    uri + '?path=secret',
    uri + '#fragment',
    uri.replace('desktop', 'foreign'),
    uri.replace('thumb.png', '../transcript.json'),
    uri.replace('/thumb', '/%74humb'),
    `capri://desktop/attachments/${randomUUID()}/preview.png`,
    'capri://desktop/attachments/../../data/secrets/key',
  ])
    assert.equal(
      resourceResponse({ url, method: 'GET' }, new Map(), { attachments: f.history }).status,
      404,
      url,
    );
  assert.equal(
    resourceResponse({ url: uri, method: 'POST' }, new Map(), { attachments: f.history }).status,
    404,
  );
});

test('invalid or foreign metadata is dropped without losing legacy conversation entries', () => {
  const id = randomUUID();
  const record = {
    id,
    name: 'C:\\private\\<b>photo</b>.png',
    kind: 'image',
    bytes: 12,
    width: 320,
    height: 180,
    preview: true,
    file: 'private',
    text: 'private',
    url: 'https://example.com',
  };
  assert.deepEqual(Object.keys(historyAttachments([record])[0]), [
    'id',
    'name',
    'kind',
    'bytes',
    'width',
    'height',
    'preview',
  ]);
  assert.equal(historyAttachments([record])[0].name, 'b>.png');
  for (const values of [
    [{ ...record, id: '../escape' }],
    [{ ...record, bytes: Infinity }],
    [{ ...record, bytes: 33 * 1024 * 1024 }],
    Array(5).fill(record),
    'not an array',
  ])
    assert.deepEqual(historyAttachments(values), []);
  assert.equal(historyAttachments([{ ...record, width: 99999 }])[0].preview, false);
  const f = fixture();
  const legacy = f.message(undefined);
  f.store.put(legacy);
  f.store.put({ ...f.message([{ ...record, id: '../escape' }]), text: 'Preserved text.' });
  f.store.put({ ...f.message([record]), role: 'assistant' });
  const restored = new TranscriptStore(f.store.file).snapshot();
  assert.equal(restored.length, 3);
  assert.ok(restored.every((message) => message.attachments === undefined));
});

test('archive failures retain file cards; caps evict only derivatives and transcript clearing removes previews', () => {
  const f = fixture({
    normalizeImage: () => {
      throw new Error('Synthetic disk/codec failure');
    },
  });
  const [failed] = f.history.persist([
    { png: f.image, metadata: { name: 'image.png', kind: 'image', bytes: 12 } },
  ]);
  assert.equal(failed.preview, false);
  assert.equal(failed.name, 'image.png');
  const small = fixture();
  small.history.maximumBytes = small.image.length * 3;
  const [first] = small.history.persist([
    { png: small.image, metadata: { name: 'first.png', kind: 'image', bytes: 12 } },
  ]);
  small.store.put(small.message([first]));
  const [second] = small.history.persist([
    { png: small.image, metadata: { name: 'second.png', kind: 'image', bytes: 12 } },
  ]);
  small.store.put(small.message([second]));
  assert.equal(small.history.read(first.id, 'preview'), null);
  assert.ok(small.history.read(second.id, 'preview'));
  writeFileSync(path.join(small.history.directory, 'unrelated.txt'), 'Keep unrelated data.');
  writeFileSync(
    path.join(small.history.directory, second.id + '.preview.png.' + randomUUID() + '.tmp'),
    'Synthetic interrupted atomic write.',
  );
  small.store.clear();
  assert.equal(small.history.read(second.id, 'preview'), null);
  assert.deepEqual(readdirSync(small.history.directory), ['unrelated.txt']);
});

test('startup/pruning follows current references and never follows a linked preview directory', (t) => {
  const f = fixture();
  const [entry] = f.history.persist([
    { png: f.image, metadata: { name: 'old.png', kind: 'image', bytes: 12 } },
  ]);
  f.store.put(f.message([entry]));
  for (let index = 0; index < 200; index++) f.store.put(f.message(undefined));
  assert.deepEqual(readdirSync(f.history.directory), []);
  const linked = path.join(f.directory, 'linked');
  const outside = path.join(f.directory, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, entry.id + '.preview.png'), f.image);
  try {
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.diagnostic('Directory links unavailable.');
      return;
    }
    throw error;
  }
  const guarded = new AttachmentHistory({
    directory: linked,
    references: () => [{ attachments: [entry] }],
    normalizeImage: () => ({ preview: f.image, thumb: f.image }),
  });
  assert.equal(guarded.read(entry.id, 'preview'), null);
  guarded.clear();
  assert.equal(readFileSync(path.join(outside, entry.id + '.preview.png')).length, f.image.length);
});
