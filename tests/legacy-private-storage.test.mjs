// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  readLegacyPrivateStorage,
  legacyPrivateFileReader,
} from '../apps/desktop/legacy-private-storage.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';
import { AttachmentHistory } from '../apps/desktop/attachment-history.mjs';
import { visionImage } from './fixtures/vision-image.mjs';

function fixture() {
  const parent = path.resolve('.runtime/test-data/legacy-private-storage');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'synthetic-'));
  return {
    directory,
    file: path.join(directory, 'transcript.json'),
    keyFile: path.join(directory, 'private-data-key.json'),
  };
}
function sealFixture(bytes, key, purpose) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`Capri private file v1:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([
    Buffer.from('CAPRI-PRIVATE\x00\x01', 'ascii'),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
const message = (text) => ({
  id: randomUUID(),
  turnId: randomUUID(),
  role: 'user',
  text,
  createdAt: new Date().toISOString(),
  status: 'complete',
});

test('clean installs neither request secure storage nor create dialogue encryption keys', async () => {
  const f = fixture();
  const privacy = await readLegacyPrivateStorage({
    keyFile: f.keyFile,
    storage: {
      available() {
        throw new Error('Must not run');
      },
    },
  });
  assert.equal(privacy, null);
  assert.deepEqual(readdirSync(f.directory), []);
  new TranscriptStore(f.file, { privacy }).put(message('Synthetic new dialogue'));
  assert.equal(JSON.parse(readFileSync(f.file)).messages[0].text, 'Synthetic new dialogue');
  assert.equal(existsSync(f.keyFile), false);
});

test('old OS-wrapped keys recover sealed history without writing or refreshing any key', async () => {
  const f = fixture(),
    key = randomBytes(32),
    record = JSON.stringify({
      schemaVersion: 1,
      ciphertext: Buffer.from('synthetic wrapper').toString('base64'),
    });
  writeFileSync(f.keyFile, record);
  const privacy = await readLegacyPrivateStorage({
    keyFile: f.keyFile,
    storage: {
      available: async () => true,
      decrypt: async () => ({
        result: 'Capri private data key v1:' + key.toString('hex'),
        shouldReEncrypt: true,
      }),
    },
  });
  const original = message('Synthetic retained dialogue');
  const bytes = sealFixture(
    Buffer.from(JSON.stringify({ schemaVersion: 1, messages: [original] })),
    key,
    'transcript',
  );
  writeFileSync(f.file, bytes);
  const store = new TranscriptStore(f.file, { privacy });
  assert.equal(store.warning, null);
  assert.deepEqual(store.snapshot(), [original]);
  assert.deepEqual(readFileSync(f.file), bytes, 'Reading does not rewrite old history');
  assert.equal(readFileSync(f.keyFile, 'utf8'), record);
  assert.equal(privacy.seal, undefined, 'Compatibility decoder cannot encrypt');
  store.put(message('Synthetic later dialogue'));
  assert.equal(JSON.parse(readFileSync(f.file)).messages.length, 2);
});

for (const cause of [
  'missing key',
  'unavailable secure storage',
  'wrong key',
  'damaged ciphertext',
])
  test(`unreadable old history survives new messages after ${cause}`, async () => {
    const f = fixture(),
      key = randomBytes(32);
    const bytes = sealFixture(
      Buffer.from(
        JSON.stringify({ schemaVersion: 1, messages: [message('Synthetic saved history')] }),
      ),
      key,
      'transcript',
    );
    if (cause === 'damaged ciphertext') bytes[bytes.length - 1] ^= 1;
    writeFileSync(f.file, bytes);
    let privacy = null;
    if (cause === 'unavailable secure storage') {
      writeFileSync(f.keyFile, JSON.stringify({ schemaVersion: 1, ciphertext: 'AAAA' }));
      privacy = await readLegacyPrivateStorage({
        keyFile: f.keyFile,
        storage: { available: async () => false },
      });
    } else if (cause !== 'missing key')
      privacy = legacyPrivateFileReader(cause === 'wrong key' ? randomBytes(32) : key);
    const store = new TranscriptStore(f.file, { privacy });
    assert.ok(store.warning);
    store.put(message('Synthetic live response'));
    assert.deepEqual(readFileSync(f.file), bytes);
    assert.throws(() => store.persist({ schemaVersion: 1, messages: [] }));
  });

test('old encrypted image previews remain readable while new images use ordinary PNG files', () => {
  const f = fixture(),
    id = randomUUID(),
    key = randomBytes(32),
    image = visionImage();
  const directory = path.join(f.directory, 'images');
  mkdirSync(directory);
  const attachment = {
    id,
    name: 'synthetic.png',
    kind: 'image',
    bytes: image.length,
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
    preview: true,
  };
  const store = new AttachmentHistory({
    directory,
    privacy: legacyPrivateFileReader(key),
    references: () => [{ role: 'user', attachments: [attachment] }],
    normalizeImage: () => ({ thumb: image, preview: image }),
  });
  const file = path.join(directory, `${id}.preview.png`),
    sealed = sealFixture(image, key, `attachment:${id}:preview`);
  writeFileSync(file, sealed);
  assert.deepEqual(store.read(id, 'preview'), image);
  assert.deepEqual(readFileSync(file), sealed);
  const saved = store.persist([
    { png: image, metadata: { name: 'new.png', kind: 'image', bytes: image.length } },
  ])[0];
  assert.equal(saved.preview, true);
  assert.deepEqual(readFileSync(path.join(directory, `${saved.id}.preview.png`)), image);
});

for (const cause of ['missing key', 'wrong key'])
  test(`orphaned sealed previews survive automatic pruning and eviction after ${cause}`, () => {
    const f = fixture(),
      id = randomUUID(),
      image = visionImage(),
      key = randomBytes(32);
    const directory = path.join(f.directory, 'images');
    mkdirSync(directory);
    const file = path.join(directory, `${id}.preview.png`);
    const sealed = sealFixture(image, key, `attachment:${id}:preview`);
    writeFileSync(file, sealed);
    const archive = new AttachmentHistory({
      directory,
      references: () => [],
      privacy: cause === 'wrong key' ? legacyPrivateFileReader(randomBytes(32)) : null,
      normalizeImage: () => ({ thumb: image, preview: image }),
      maximumBytes: sealed.length,
    });
    archive.prune();
    assert.deepEqual(readFileSync(file), sealed);
    assert.throws(() => archive.makeRoom(1), /limit reached/);
    assert.deepEqual(readFileSync(file), sealed);
  });

test('readable legacy orphan previews can still be pruned normally', () => {
  const f = fixture(),
    id = randomUUID(),
    key = randomBytes(32),
    directory = path.join(f.directory, 'images');
  mkdirSync(directory);
  const file = path.join(directory, `${id}.preview.png`);
  writeFileSync(file, sealFixture(visionImage(), key, `attachment:${id}:preview`));
  const archive = new AttachmentHistory({
    directory,
    references: () => [],
    privacy: legacyPrivateFileReader(key),
  });
  archive.prune();
  assert.equal(existsSync(file), false);
});
