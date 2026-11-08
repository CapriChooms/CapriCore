// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HuggingFaceCredentials } from '../apps/desktop/huggingface-credentials.mjs';

const token = 'hf_' + 'SyntheticCredentialCanary'.repeat(2);
const storage = {
  available: async () => true,
  encrypt: async (text) => Buffer.from(text).reverse(),
  decrypt: async (bytes) => Buffer.from(bytes).reverse().toString(),
};
const fixture = (overrides = {}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-hf-credentials-'));
  return new HuggingFaceCredentials({ root, storage: { ...storage, ...overrides } });
};

test('Hub token is encrypted, status is public and access is bound to the Hub origin', async () => {
  const credentials = fixture();
  assert.deepEqual(await credentials.status(), {
    hasToken: false,
    secureStorage: true,
    error: null,
  });
  const status = await credentials.save(token);
  assert.equal(status.hasToken, true);
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(readFileSync(credentials.file, 'utf8').includes(token), false);
  assert.equal(await credentials.tokenFor('https://huggingface.co/api/models'), token);
  for (const url of [
    'https://router.huggingface.co/v1',
    'https://huggingface.co.attacker.example/model',
    'https://cdn-lfs.hf.co/model',
    'http://huggingface.co/model',
    'https://huggingface.co:444/model',
    'https://user:password@huggingface.co/model',
    'not a URL',
  ])
    assert.equal(await credentials.tokenFor(url), null, url);
  await credentials.remove();
  assert.equal((await credentials.status()).hasToken, false);
  assert.equal(await credentials.tokenFor('https://huggingface.co/model'), null);
});

test('Hub access fails closed for corrupt or unavailable encrypted storage', async () => {
  const credentials = fixture();
  await credentials.save(token);
  writeFileSync(
    credentials.file,
    JSON.stringify({ schemaVersion: 1, origin: 'https://other.example', ciphertext: 'abcd' }),
  );
  assert.equal((await credentials.status()).hasToken, false);
  await assert.rejects(credentials.tokenFor('https://huggingface.co/model'), /could not be read/);
  await credentials.remove();
  const unavailable = fixture({ available: async () => false });
  await assert.rejects(unavailable.save(token), /Secure credential storage is unavailable/);
  await assert.rejects(credentials.save('bad token'), /valid Hugging Face read token/);
  const failed = fixture({
    encrypt: async () => {
      throw new Error(token);
    },
  });
  await assert.rejects(failed.save(token), (error) => !error.message.includes(token));
});

test('removing Hub access during encryption prevents a late save from restoring the token', async () => {
  let complete;
  const credentials = fixture({
    encrypt: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const pending = credentials.save(token);
  await Promise.resolve();
  assert.equal(typeof complete, 'function');
  await credentials.remove();
  complete(Buffer.from(token).reverse());
  await assert.rejects(pending, /cancelled/);
  assert.equal((await credentials.status()).hasToken, false);
});
