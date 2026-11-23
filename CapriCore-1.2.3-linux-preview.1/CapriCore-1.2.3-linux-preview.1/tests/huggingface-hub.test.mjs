// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  linkSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { HuggingFaceHub, parseRepository } from '../packages/runtime/src/huggingface/hub.mjs';
import { HF_DRAFT_CHAT_ERROR } from '../packages/runtime/src/hardware/imported-model.mjs';
import {
  downloadArtifact,
  safeFileName,
  operationLock,
} from '../packages/runtime/src/huggingface/artifacts.mjs';
import { hubResponse, hubJson, hubUrl } from '../packages/runtime/src/huggingface/transport.mjs';

const revision = 'a'.repeat(40);
const bytes = Buffer.alloc(32);
bytes.write('GGUF');
bytes.writeUInt32LE(3, 4);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const artifact = {
  path: 'weights/model-Q4_K_M.gguf',
  bytes: bytes.length,
  sha256,
  url: `https://huggingface.co/capri-test/model/resolve/${revision}/model.gguf`,
};
function folder() {
  const base = path.join(root, '.runtime/huggingface-tests');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, 'case-'));
}
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function fixture({ show, metadata, running = [] } = {}) {
  const calls = [];
  const base = folder();
  const hub = new HuggingFaceHub({
    root: base,
    ollamaUrl: 'http://127.0.0.1:11435',
    diskFree: () => 1e12,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/models/') && String(url).includes('/revision/'))
        return json(
          metadata ?? {
            sha: revision,
            pipeline_tag: 'text-generation',
            cardData: { language: ['en', 'ru'], license: 'apache-2.0' },
            siblings: [{ rfilename: artifact.path, lfs: { size: bytes.length, sha256 } }],
          },
        );
      if (String(url).includes('/resolve/'))
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
      if (String(url).includes('/api/blobs/'))
        assert.fail('GGUF imports reuse the downloaded file');
      if (String(url).endsWith('/api/create')) return json({ status: 'success' });
      if (String(url).endsWith('/api/show'))
        return json(
          show ?? {
            template: '{{ .Messages }}',
            capabilities: ['completion', 'tools'],
            model_info: { 'general.architecture': 'llama', 'llama.context_length': 16384 },
          },
        );
      if (String(url).endsWith('/api/ps')) return json({ models: running });
      if (String(url).endsWith('/api/delete')) return new Response(null);
      throw new Error('Unexpected fixture request');
    },
  });
  return { hub, base, calls };
}

test('Hub references accept repository/file URLs and reject credentials, path escapes and Windows special paths', () => {
  assert.deepEqual(parseRepository('capri-test/model'), { repository: 'capri-test/model' });
  assert.deepEqual(
    parseRepository('https://huggingface.co/capri-test/model/blob/main/weights/a.gguf'),
    { repository: 'capri-test/model', revision: 'main', filename: 'weights/a.gguf' },
  );
  for (const value of [
    'https://evil.test/a/b',
    'https://user:secret@huggingface.co/a/b',
    'https://huggingface.co/a/b?token=secret',
    'a/../../b',
    'a/b/c',
    'https://huggingface.co/a%2Fb/c',
  ])
    assert.throws(() => parseRepository(value));
  for (const value of [
    '../a.gguf',
    'C:/a.gguf',
    '/a.gguf',
    'a\\b.gguf',
    'a:stream',
    'CON.gguf',
    'a./x',
    'x/%2e%2e',
  ])
    assert.throws(() => safeFileName(value));
});

test('Hub transport strips credentials on CDN redirects and refuses unapproved origins', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://cas-bridge.xethub.hf.co/file?signed=opaque' },
        })
      : new Response(bytes);
  };
  await hubResponse(artifact.url, {
    fetchImpl,
    token: async () => 'fixture-secret',
    headers: { Authorization: 'untrusted-header', Cookie: 'private-cookie' },
  });
  assert.equal(calls[0].headers.authorization, 'Bearer fixture-secret');
  assert.equal(calls[1].headers.authorization, undefined);
  assert.equal(calls[0].headers.cookie, undefined);
  assert.equal(calls[1].headers.cookie, undefined);
  for (const url of [
    'http://huggingface.co/a',
    'https://127.0.0.1/a',
    'https://huggingface.co.evil.test/a',
    'https://evil.hf.co/a',
  ])
    assert.throws(() => hubUrl(url));
  await assert.rejects(
    hubResponse(artifact.url, {
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secrets' },
        }),
    }),
    /Unapproved/,
  );
});

test('metadata errors are bounded and never echo upstream exception text', async () => {
  await assert.rejects(
    hubJson('https://huggingface.co/api/models', {
      fetchImpl: async () => {
        throw new Error('private-token signed-url personal-text');
      },
    }),
    (error) => !/private-token|signed-url|personal-text/.test(error.message),
  );
  await assert.rejects(
    hubJson('https://huggingface.co/api/models', {
      fetchImpl: async () => new Response('x'.repeat(4 * 1024 ** 2 + 1)),
    }),
    /size and time limits/,
  );
});

test('artifact download resumes partial bytes, verifies digest and reuses verified cache', async () => {
  const base = folder();
  writeFileSync(path.join(base, sha256 + '.partial'), bytes.subarray(0, 9));
  let calls = 0;
  const result = await downloadArtifact(artifact, base, {
    diskFree: () => 1e12,
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.headers.range, 'bytes=9-');
      return new Response(bytes.subarray(9), {
        status: 206,
        headers: {
          'content-range': `bytes 9-${bytes.length - 1}/${bytes.length}`,
          'content-length': String(bytes.length - 9),
        },
      });
    },
  });
  assert.deepEqual(readFileSync(result), bytes);
  assert.equal(existsSync(result + '.partial'), false);
  await downloadArtifact(artifact, base, {
    fetchImpl: () => assert.fail('verified cache fetched again'),
  });
  assert.equal(calls, 1);
});

test('ignored Range replaces partial prefix instead of corrupting the model', async () => {
  const base = folder();
  writeFileSync(path.join(base, sha256 + '.partial'), bytes.subarray(0, 5));
  const result = await downloadArtifact(artifact, base, {
    diskFree: () => 1e12,
    fetchImpl: async () =>
      new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
  });
  assert.deepEqual(readFileSync(result), bytes);
});

test('corrupt digest, incorrect range and insufficient space cannot publish an artifact', async () => {
  const base = folder();
  await assert.rejects(
    downloadArtifact(artifact, base, {
      diskFree: () => 1e12,
      fetchImpl: async () => new Response(Buffer.alloc(bytes.length)),
    }),
    /checksum/,
  );
  assert.equal(existsSync(path.join(base, sha256)), false);
  writeFileSync(path.join(base, sha256 + '.partial'), bytes.subarray(0, 1));
  await assert.rejects(
    downloadArtifact(artifact, base, {
      diskFree: () => 1e12,
      fetchImpl: async () =>
        new Response(bytes.subarray(1), {
          status: 206,
          headers: { 'content-range': 'bytes 0-30/32' },
        }),
    }),
    /byte range/,
  );
  await assert.rejects(
    downloadArtifact(artifact, folder(), {
      diskFree: () => 1,
      fetchImpl: () => assert.fail('low-disk request sent'),
    }),
    /free disk space/,
  );
});

test('operation lock prevents concurrent mutations and releases after the owner finishes', () => {
  const base = folder(),
    release = operationLock(base);
  assert.throws(() => operationLock(base), /Another Hugging Face operation/);
  release();
  operationLock(base)();
});

test('resuming a hardlinked partial cannot overwrite unrelated files', async (t) => {
  const base = folder(),
    outside = path.join(folder(), 'keep.bin');
  const original = Buffer.from('keep this external content');
  writeFileSync(outside, original);
  try {
    linkSync(outside, path.join(base, sha256 + '.partial'));
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Hardlink permission unavailable');
    throw error;
  }
  await assert.rejects(
    downloadArtifact(artifact, base, {
      diskFree: () => 1e12,
      fetchImpl: () => assert.fail('hardlinked staging must fail before network'),
    }),
    /private regular file/,
  );
  assert.deepEqual(readFileSync(outside), original);
});

test('Hub storage rejects redirected filesystem folders', (t) => {
  const base = folder(),
    target = folder();
  mkdirSync(path.join(base, 'data'), { recursive: true });
  try {
    symlinkSync(target, path.join(base, 'data/huggingface'), 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Junction permission unavailable');
    throw error;
  }
  const hub = new HuggingFaceHub({ root: base, ollamaUrl: 'http://127.0.0.1:11435' });
  assert.throws(() => hub.list(), /filesystem links/);
});

test('normal Hub entry points resolve, install, import, persist and remove a model', async () => {
  const { hub, base, calls } = fixture();
  const info = await hub.inspect('capri-test/model');
  assert.equal(info.revision, revision);
  const plan = await hub.plan({
    repository: info.repository,
    revision: info.revision,
    filename: artifact.path,
  });
  assert.equal(plan.downloadBytes, bytes.length);
  assert.equal(plan.requiredBytes, bytes.length + 64 * 1024 ** 2);
  const receipt = await hub.install(plan);
  assert.equal(receipt.profile, undefined);
  const profile = await hub.importLanguageModel(receipt.id);
  assert.equal(profile.contextTokens, 16384);
  assert.equal(profile.contextLimit, 16384);
  assert.deepEqual(profile.capabilities, ['tools']);
  assert.equal(hub.list()[0].profile.model, profile.model);
  assert.equal(profile.model, `capri-${receipt.id}:latest`);
  const next = await hub.plan({ repository: info.repository, revision, filename: artifact.path });
  assert.equal(next.downloadBytes, 0);
  await assert.rejects(hub.remove(receipt.id, { activeModel: profile.model }), /active model/);
  const removed = await hub.remove(receipt.id);
  assert.equal(removed.freedBytes, bytes.length);
  assert.deepEqual(hub.list(), []);
  assert.ok(calls.some((call) => call.url.endsWith('/api/delete')));
  assert.equal(existsSync(path.join(base, 'data/huggingface/blobs', sha256)), false);
});

test('failed template qualification removes the new alias and leaves downloaded package repairable', async () => {
  const { hub, calls } = fixture({ show: { capabilities: ['completion'], model_info: {} } });
  const receipt = await hub.install(
    await hub.plan({ repository: 'capri-test/model', filename: artifact.path }),
  );
  await assert.rejects(hub.importLanguageModel(receipt.id), /chat template and context/);
  assert.equal(hub.list()[0].profile, undefined);
  assert.ok(calls.some((call) => call.url.endsWith('/api/delete')));
});

test('receipt removal retains a blob still used by another installed package', async () => {
  const { hub, base } = fixture();
  const first = await hub.install(
    await hub.plan({ repository: 'capri-test/one', filename: artifact.path }),
  );
  const second = await hub.install(
    await hub.plan({ repository: 'capri-test/two', filename: artifact.path }),
  );
  assert.notEqual(first.id, second.id);
  assert.equal((await hub.remove(first.id)).freedBytes, 0);
  assert.equal(existsSync(path.join(base, 'data/huggingface/blobs', sha256)), true);
  assert.equal(hub.list().length, 1);
});

test('TTS metadata is discoverable but arbitrary voice snapshots cannot use the GGUF import path', async () => {
  const { hub } = fixture({
    metadata: { sha: revision, pipeline_tag: 'text-to-speech', siblings: [] },
  });
  const info = await hub.inspect('ResembleAI/chatterbox');
  assert.equal(info.compatibility.adapter, 'chatterbox-multilingual');
  await assert.rejects(
    hub.plan({ repository: 'ResembleAI/chatterbox', filename: 'weights.safetensors' }),
    /TTS adapter/,
  );
});

test('speculative GGUF drafts are flagged and cannot be downloaded as the primary model', async () => {
  const siblings = [artifact.path, 'dspark-model-f16.gguf', 'drafts/model-dflash-f16.gguf'].map(
    (rfilename) => ({ rfilename, lfs: { size: bytes.length, sha256 } }),
  );
  const { hub, calls } = fixture({ metadata: { sha: revision, siblings } });
  const { files } = await hub.inspect('capri-test/model');
  assert.deepEqual(
    files.map(({ kind }) => kind),
    ['gguf', 'draft', 'draft'],
  );
  for (const draft of siblings.slice(1))
    await assert.rejects(hub.plan({ repository: 'capri-test/model', filename: draft.rfilename }), {
      message: HF_DRAFT_CHAT_ERROR,
    });
  assert.ok(calls.every(({ url }) => url.includes('/revision/')));
  const main = await hub.plan({ repository: 'capri-test/model', filename: artifact.path });
  assert.equal(main.files[0].path, artifact.path);
});

test('engine metadata rejects a renamed DFlash draft that advertises completion', async () => {
  const { hub, calls } = fixture({
    show: {
      template: '{{ .Messages }}',
      capabilities: ['completion', 'thinking'],
      model_info: { 'general.architecture': 'dflash', 'dflash.context_length': 32768 },
    },
  });
  const plan = await hub.plan({ repository: 'capri-test/model', filename: artifact.path });
  await hub.install(plan);
  await assert.rejects(hub.importLanguageModel(plan.id), { message: HF_DRAFT_CHAT_ERROR });
  assert.equal(hub.receipt(plan.id).profile, undefined);
  assert.ok(calls.some(({ url }) => url.endsWith('/api/delete')));
});

test('incomplete split or unverifiable GGUF selections are rejected before download', async () => {
  for (const file of [
    { rfilename: 'model-00001-of-00002.gguf', lfs: { size: bytes.length, sha256 } },
    { rfilename: 'model.gguf', size: bytes.length },
  ]) {
    const { hub, calls } = fixture({ metadata: { sha: revision, siblings: [file] } });
    await assert.rejects(
      hub.plan({ repository: 'capri-test/model', filename: file.rfilename }),
      /missing shard|verifiable/,
    );
    assert.equal(
      calls.some((call) => call.url.includes('/resolve/')),
      false,
    );
  }
});

test('a selected GGUF shard resolves the complete pinned set and retains original import filenames', async () => {
  const names = ['Q4/model-00001-of-00002.gguf', 'Q4/model-00002-of-00002.gguf'];
  const { hub, calls } = fixture({
    metadata: {
      sha: revision,
      siblings: names.map((rfilename) => ({ rfilename, lfs: { size: bytes.length, sha256 } })),
    },
  });
  const plan = await hub.plan({ repository: 'capri-test/model', filename: names[1] });
  assert.deepEqual(
    plan.files.map((file) => file.path),
    names,
  );
  const receipt = await hub.install(plan);
  await hub.importLanguageModel(receipt.id);
  const create = calls.find((call) => call.url.endsWith('/api/create'));
  assert.deepEqual(Object.keys(JSON.parse(create.options.body).files), names);
});

test('cancellation preserves partial bytes and does not publish a receipt', async () => {
  const { hub } = fixture();
  const plan = await hub.plan({ repository: 'capri-test/model', filename: artifact.path });
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(hub.install(plan, { signal: controller.signal }), /cancelled/);
  assert.deepEqual(hub.list(), []);
});
