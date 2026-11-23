// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InferenceApi } from '../apps/desktop/inference-api.mjs';

const google = {
  enabled: true,
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  model: 'gemini-fixture-model',
  vision: true,
  tools: false,
  contextTokens: 32768,
};
const storage = {
  available: async () => true,
  encrypt: async (value) => Buffer.from(value).reverse(),
  decrypt: async (value) => Buffer.from(value).reverse().toString(),
};

test('ordinary Google AI Studio key format saves, survives restart and reaches the OpenAI-compatible endpoint', async () => {
  // Intentionally synthetic, never usable against Google; all requests are mocked.
  const key = 'AIza' + 'x'.repeat(35);
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-google-key-format-'));
  let requests = 0;
  const options = {
    root,
    storage,
    fetchImpl: async (url, request) => {
      requests++;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer ' + key);
      assert.equal(request.redirect, 'error');
      assert.equal(JSON.parse(request.body).model, google.model);
      return Response.json({ choices: [{ message: { content: 'OK' } }] });
    },
  };
  const first = new InferenceApi(options);
  const id = await first.saveProfile({ settings: google, name: 'Google fixture', key });
  await first.selectProfile(id);
  const restored = new InferenceApi(options);
  assert.equal(await restored.key(), key);
  assert.equal((await restored.status()).activeId, id);
  assert.equal((await restored.status()).profiles[0].hasKey, true);
  assert(!JSON.stringify(await restored.status()).includes(key));
  assert(!readFileSync(restored.settingsFile, 'utf8').includes(key));
  assert(!readFileSync(restored.profilesFile, 'utf8').includes(key));
  await restored.testProfile(id);
  assert.equal(requests, 1);
});

test('custom provider keys do not require any vendor-specific prefix', async () => {
  for (const key of ['custom-fixture-auth-key', 'fixture.AQ_x-y+z/=value', 'a'.repeat(100)]) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'capri-custom-key-format-'));
    const api = new InferenceApi({
      root,
      storage,
      fetchImpl: async () => assert.fail('Saving a key does not send it'),
    });
    const id = await api.saveProfile({
      settings: { ...google, baseUrl: 'https://provider.example/v1' },
      key,
    });
    await api.selectProfile(id);
    assert.equal(await new InferenceApi({ root, storage }).key(), key);
  }
});

test('copied Google keys normalize boundary artifacts and one outer quote pair before encryption or forwarding', async () => {
  const canonical = 'AIza' + 'x'.repeat(35);
  for (const key of [
    ' \t\n\uFEFF' + canonical + '\u200b \r\n',
    '"' + canonical + '"',
    '\u200b " \uFEFF' + canonical + ' \u200b" \uFEFF',
  ]) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'capri-copied-key-format-'));
    const encryptedValues = [];
    let requests = 0;
    const options = {
      root,
      storage: {
        ...storage,
        encrypt: async (value) => {
          encryptedValues.push(value);
          return storage.encrypt(value);
        },
      },
      fetchImpl: async (_url, request) => {
        requests++;
        assert.equal(request.headers.authorization, 'Bearer ' + canonical);
        return Response.json({ choices: [{ message: { content: 'OK' } }] });
      },
    };
    const api = new InferenceApi(options);
    const id = await api.saveProfile({ settings: google, key });
    await api.selectProfile(id);
    assert.deepEqual(encryptedValues, [canonical]);
    const restored = new InferenceApi(options);
    assert.equal(await restored.key(), canonical);
    assert(!readFileSync(restored.profilesFile, 'utf8').includes(canonical));
    assert(!JSON.stringify(await restored.status()).includes(canonical));
    await restored.testProfile(id);
    assert.equal(requests, 1);
  }
});

test('long provider auth keys survive encrypted persistence and forward without a 512-character cutoff', async () => {
  for (const length of [1024, 4096]) {
    const prefix = 'AQ.fixture_';
    const key = prefix + 'x'.repeat(length - prefix.length);
    const root = mkdtempSync(path.join(os.tmpdir(), 'capri-long-key-format-'));
    let requests = 0;
    const options = {
      root,
      storage,
      fetchImpl: async (_url, request) => {
        requests++;
        assert.equal(request.headers.authorization, 'Bearer ' + key);
        return Response.json({ choices: [{ message: { content: 'OK' } }] });
      },
    };
    const api = new InferenceApi(options);
    const id = await api.saveProfile({ settings: google, key });
    await api.selectProfile(id);
    const restored = new InferenceApi(options);
    assert.equal((await restored.key()).length, length);
    assert.equal(await restored.key(), key);
    assert(!readFileSync(restored.profilesFile, 'utf8').includes(key));
    assert(!JSON.stringify(await restored.status()).includes(key));
    await restored.testProfile(id);
    assert.equal(requests, 1);
  }
});

test('a retired Google model is reported as provider HTTP 404 after valid credential input', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'capri-retired-google-model-'));
  const key = 'AIza' + 'x'.repeat(35);
  let requests = 0;
  const api = new InferenceApi({
    root,
    storage,
    fetchImpl: async (_url, request) => {
      requests++;
      assert.equal(request.headers.authorization, 'Bearer ' + key);
      assert.equal(JSON.parse(request.body).model, 'gemini-1.5-pro');
      return Response.json({ error: { message: 'Fixture model is unavailable' } }, { status: 404 });
    },
  });
  const id = await api.saveProfile({ settings: { ...google, model: 'gemini-1.5-pro' }, key });
  assert.equal(requests, 0);
  await assert.rejects(
    api.testProfile(id),
    (error) => /HTTP 404/.test(error.message) && !/valid API key/.test(error.message),
  );
  assert.equal(requests, 1);
});

test('long credential echoes cannot escape through network chunks, SSE deltas, truncated replies or final frames', async (t) => {
  const key = 'AQ.fixture_' + 'x'.repeat(4096 - 'AQ.fixture_'.length);
  const contentFrame = (content) =>
    'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content } }] }) + '\n\n';
  const stopFrame =
    'data: ' +
    JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }) +
    '\n\n';
  for (const kind of [
    'full-frame',
    'split-deltas',
    'truncated-with-finish',
    'truncated-at-end',
    'prefix-with-tail',
    'split-prefix-with-tail',
    'metadata-prefix-with-tail',
  ]) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'capri-stream-key-format-'));
    let stream;
    if (kind === 'full-frame') stream = contentFrame(key) + 'data: [DONE]\n\n';
    else if (kind === 'split-deltas')
      stream =
        [key.slice(0, 1024), key.slice(1024, 2048), key.slice(2048)].map(contentFrame).join('') +
        stopFrame +
        'data: [DONE]\n\n';
    else if (kind === 'prefix-with-tail')
      stream =
        contentFrame(key.slice(0, -1) + '... unrelated suffix') + stopFrame + 'data: [DONE]\n\n';
    else if (kind === 'split-prefix-with-tail')
      stream =
        [key.slice(0, 4), key.slice(4, -1), '... unrelated suffix'].map(contentFrame).join('') +
        stopFrame +
        'data: [DONE]\n\n';
    else if (kind === 'metadata-prefix-with-tail')
      stream =
        'data: ' +
        JSON.stringify({
          choices: [{ index: 0, delta: { content: 'OK' } }],
          providerMetadata: key.slice(0, -1) + '... unrelated suffix',
        }) +
        '\n\ndata: [DONE]\n\n';
    else
      stream =
        contentFrame(key.slice(0, -1)) +
        (kind === 'truncated-with-finish' ? stopFrame : '') +
        'data: [DONE]\n\n';
    const options = {
      root,
      storage,
      fetchImpl: async (_url, request) => {
        assert.equal(request.headers.authorization, 'Bearer ' + key);
        const bytes = new TextEncoder().encode(stream);
        return new Response(
          new ReadableStream({
            start(controller) {
              for (let offset = 0; offset < bytes.length; offset += 97)
                controller.enqueue(bytes.subarray(offset, offset + 97));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    };
    const seed = new InferenceApi(options);
    const id = await seed.saveProfile({ settings: google, key });
    await seed.selectProfile(id);
    const api = new InferenceApi(options);
    await api.start(0);
    t.after(() => api.close());
    let received = '',
      failure = '';
    try {
      const response = await api.localFetch(api.url + '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [], stream: true }),
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
      received += decoder.decode();
    } catch (error) {
      failure = error.message;
    }
    assert(
      !received.includes(key.slice(0, 32)),
      kind + ' must not disclose a recoverable credential prefix',
    );
    assert(!failure.includes(key.slice(0, 32)), kind + ' errors never disclose credential data');
    if (kind === 'full-frame') {
      assert.match(received, /REDACTED/);
      assert.match(received, /\[DONE\]/);
    }
    api.close();
  }
});

test('ordinary short final prefixes stay readable while a nearly complete short credential is withheld', async (t) => {
  for (const [key, content, blocked] of [
    ['AIza' + 'x'.repeat(35), 'The answer is A', false],
    ['AIza' + 'x'.repeat(35), 'Capri uses AI', false],
    ['fixture8', 'Pronounce fi', false],
    ['fixture8', 'fixtur', true],
  ]) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'capri-final-prefix-format-'));
    const frame =
      'data: ' +
      JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }) +
      '\n\ndata: [DONE]\n\n';
    const options = {
      root,
      storage,
      fetchImpl: async () =>
        new Response(frame, { headers: { 'content-type': 'text/event-stream' } }),
    };
    const seed = new InferenceApi(options);
    const id = await seed.saveProfile({ settings: google, key });
    await seed.selectProfile(id);
    const api = new InferenceApi(options);
    await api.start(0);
    t.after(() => api.close());
    let received = '';
    try {
      const response = await api.localFetch(api.url + '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [], stream: true }),
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }
      received += decoder.decode();
    } catch (error) {
      assert.equal(blocked, true, error.message);
    }
    if (blocked) assert(!received.includes(content));
    else assert(received.includes(content));
    api.close();
  }
});

test('header injection, empty and malformed credential inputs cannot write profiles or send requests', async () => {
  for (const key of [
    undefined,
    null,
    '',
    ' ',
    'key\r\nX-Injected: yes',
    'fixture\0secret',
    'fixture secret',
    'fixture\tsecret',
    'fixture\u200bsecret',
    'fixture"secret',
    'fixture\\secret',
    '""fixture-key""',
    '“fixture-key”',
    'x'.repeat(4097),
  ]) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'capri-invalid-key-format-'));
    let encryptions = 0;
    const api = new InferenceApi({
      root,
      storage: {
        ...storage,
        encrypt: async () => {
          encryptions++;
          assert.fail('Invalid input is not encrypted');
        },
      },
      fetchImpl: async () => assert.fail('Invalid input is not sent'),
    });
    await assert.rejects(api.saveProfile({ settings: google, key }), /API key/i);
    assert.equal(encryptions, 0);
    assert.equal(existsSync(api.profilesFile), false);
    assert.equal(existsSync(api.settingsFile), false);
  }
});
