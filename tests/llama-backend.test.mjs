// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createLlamaBridge,
  llamaChatBody,
} from '../packages/runtime/src/providers/llama-bridge.mjs';
import { LlamaModelStore } from '../packages/runtime/src/providers/llama-model-store.mjs';
import { LlamaWorkers } from '../packages/runtime/src/providers/llama-workers.mjs';
import { ensureLanguageModelReady } from '../packages/runtime/src/providers/model-residency.mjs';
import {
  migrateLanguageDevice,
  modelDevice,
} from '../packages/runtime/src/hardware/model-devices.mjs';

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return 'http://127.0.0.1:' + server.address().port;
}
const post = (url, value, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });

test('Ollama cache aliases are read in place and unsupported Ministral weights are excluded', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'capri-llama-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new LlamaModelStore(root);
  mkdirSync(store.blobs, { recursive: true });
  const sha = 'a'.repeat(64);
  const blob = path.join(store.blobs, 'sha256-' + sha);
  writeFileSync(blob, 'GGUF fixture');
  for (const id of ['qwen3.5:2b', 'bge-m3:latest', 'ministral-3:3b']) {
    const file = store.manifest(id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        layers: [
          { digest: 'sha256:' + sha, size: 12, mediaType: 'application/vnd.ollama.image.model' },
        ],
      }),
    );
  }
  assert.equal(store.get('capri-qwen3.5:2b').files[0].file, blob);
  assert.equal(store.get('capri-embed:latest').embedding, true);
  assert.throws(() => store.get('ministral-3:3b'), /missing or incomplete/);
  await store.pull('qwen3.5:2b', {
    fetchImpl: () => assert.fail('Do not redownload installed weights'),
  });
  assert.ok(store.list().some((item) => item.name === 'capri-qwen3.5:2b'));
  assert.throws(() => store.get('../private'), /Invalid local model name/);
});

test('an Ollama v2 Capri model alias reuses local GGUF files after switching engines', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'capri-llama-v2-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new LlamaModelStore(root);
  const alias = 'capri-qwen3.5:2b';
  const folder = path.join(root, 'data/models/manifests-v2/ollama.com/library/capri-qwen3.5');
  const digest = 'a'.repeat(64);
  const file = path.join(store.blobs, 'sha256-' + digest);
  mkdirSync(folder, { recursive: true });
  mkdirSync(store.blobs, { recursive: true });
  writeFileSync(file, 'GGUF fixture');
  writeFileSync(
    path.join(folder, '2b'),
    JSON.stringify({
      layers: [
        { digest: 'sha256:' + digest, size: 12, mediaType: 'application/vnd.ollama.image.model' },
      ],
    }),
  );

  assert.equal(store.get(alias).files[0].file, file);
  assert.ok(store.list().some(({ name }) => name === alias));
  await store.pull(alias, {
    fetchImpl: () => assert.fail('The cached model is already available'),
  });
  writeFileSync(file, 'incomplete');
  assert.throws(() => store.get(alias), { code: 'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING' });
});

test('model preparation distinguishes missing weights, an unavailable GPU, and a native GPU load failure', async (t) => {
  let missing = true;
  const model = { name: 'local:latest', files: [{ file: 'fixture' }] };
  const workers = new LlamaWorkers({
    root: tmpdir(),
    config: { acceleration: 'auto', contextTokens: 32768 },
    device: 'unavailable',
    start: () => assert.fail('Missing weights and unavailable GPUs must not start a worker'),
  });
  t.after(() => workers.close());
  const url = await listen(
    t,
    createLlamaBridge({
      config: {},
      version: 'test',
      store: {
        get() {
          if (missing)
            throw Object.assign(new Error('missing'), {
              status: 404,
              code: 'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING',
            });
          return model;
        },
      },
      workers,
    }),
  );
  const prepare = () => ensureLanguageModelReady({ url, model: model.name, contextTokens: 32768 });
  const verifyCode = (code) => (error) =>
    error.code === 'CAPRI_MODEL_NOT_READY' && error.cause?.code === code;

  await assert.rejects(prepare, verifyCode('CAPRI_LOCAL_LANGUAGE_MODEL_MISSING'));
  missing = false;
  await assert.rejects(prepare, verifyCode('CAPRI_LLAMA_GPU_UNAVAILABLE'));
  workers.device = 'Vulkan0';
  workers.start = (_role, args) => {
    assert.equal(args[args.indexOf('--device') + 1], 'Vulkan0');
    return { alive: () => false, stop: async () => {} };
  };
  await assert.rejects(prepare, verifyCode('CAPRI_LLAMA_GPU_LOAD_FAILED'));
});

test('llama.cpp receives local image data and stable tool IDs without network image URLs', () => {
  const config = { reasoningBudget: 64 };
  const model = { name: 'local' };
  const input = {
    think: true,
    options: { num_predict: 128 },
    messages: [
      { role: 'assistant', tool_calls: [{ function: { name: 'list', arguments: { count: 1 } } }] },
      { role: 'tool', tool_name: 'list', content: 'one' },
      { role: 'user', content: 'Describe this', images: ['/9j/AQ=='] },
    ],
  };
  const payload = llamaChatBody(input, { config, model, legacy: true });
  assert.equal(payload.messages[0].tool_calls[0].id, payload.messages[1].tool_call_id);
  assert.equal(payload.messages[0].tool_calls[0].function.arguments, '{"count":1}');
  assert.match(payload.messages[2].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(payload.reasoning_budget, 64);
  assert.equal(payload.max_tokens, 128);
  assert.equal(
    llamaChatBody({ ...input, think: false }, { config, model, legacy: true }).reasoning_budget,
    0,
  );
  assert.throws(
    () =>
      llamaChatBody(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: 'https://example.org/private.png' } },
              ],
            },
          ],
        },
        { config, model, legacy: false },
      ),
    /Invalid local image/,
  );
});

test('compatibility stream preserves reasoning, completed tool arguments, and native counters', async (t) => {
  const native = await listen(
    t,
    createServer(async (req, res) => {
      for await (const chunk of req) void chunk;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const item of [
        { choices: [{ delta: { reasoning_content: 'thinking' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_qa', function: { name: 'lookup', arguments: '{"x":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '7}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 42, completion_tokens: 12 },
        },
      ])
        res.write('data: ' + JSON.stringify(item) + '\n\n');
      res.end('data: [DONE]\n\n');
    }),
  );
  const url = await listen(
    t,
    createLlamaBridge({
      config: {},
      version: 'test',
      store: { get: (name) => ({ name }) },
      workers: {
        use: (_model, _role, _input, signal, run) => run({ url: native, token: 'fixture' }, signal),
      },
    }),
  );
  const response = await post(url + '/api/chat', {
    model: 'local',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });
  assert.equal(response.status, 200);
  const items = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(items[0].message.thinking, 'thinking');
  assert.deepEqual(items[1].message.tool_calls[0], {
    id: 'call_qa',
    function: { index: 0, name: 'lookup', arguments: { x: 7 } },
  });
  assert.equal(items[2].done, true);
  assert.equal(items[2].prompt_eval_count, 42);
  assert.equal((await post(url + '/api/chat', {}, { origin: 'https://example.org' })).status, 403);
});

test('saved CUDA and HIP choices migrate only to an unambiguous matching Vulkan GPU', () => {
  const old = modelDevice('cuda', 1, 'NVIDIA RTX Fixture');
  const gpu = modelDevice('vulkan', 0, old.name);
  assert.equal(migrateLanguageDevice(old.id, [gpu]).at(-1).ordinal, 0);
  assert.equal(migrateLanguageDevice(old.id, [gpu, modelDevice('vulkan', 1, old.name)]).length, 2);
});
