import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeModelDefinition } from '../packages/runtime/src/providers/native-model.mjs';
import { llamaChatBody } from '../packages/runtime/src/providers/llama-bridge.mjs';
import { reasoningBudget, settings } from '../packages/runtime/src/index.mjs';

const digest = (n) => 'sha256:' + String(n).repeat(64);
const layer = (type, n) => ({
  mediaType: 'application/vnd.ollama.image.' + type,
  digest: digest(n),
});

test('native Qwen uses the exact upstream language and vision blobs without inheriting the Go renderer', () => {
  const manifest = {
    layers: [
      layer('model', 1),
      layer('projector', 2),
      layer('params', 3),
      layer('license', 4),
      layer('template', 5),
    ],
  };
  const reads = [];
  const definition = nativeModelDefinition(
    manifest,
    (id) => {
      reads.push(id);
      return id === digest(3)
        ? '{"temperature":1,"top_p":0.95,"presence_penalty":1.5}'
        : 'Upstream license';
    },
    { temperature: 0.85, repeat_last_n: 512 },
  );
  assert.deepEqual(definition.files, { 'model.gguf': digest(1), 'mmproj.gguf': digest(2) });
  assert.deepEqual(definition.parameters, {
    temperature: 0.85,
    top_p: 0.95,
    presence_penalty: 1.5,
    repeat_last_n: 512,
  });
  assert.equal(definition.license, 'Upstream license');
  assert.ok(!reads.includes(digest(5)));
  for (const key of ['from', 'template', 'renderer', 'parser']) assert.ok(!(key in definition));
});

test('native model preparation rejects invalid blob paths and ambiguous model shards before reading data', () => {
  const blob = () => {
    throw new Error('Must not read an invalid blob');
  };
  assert.throws(
    () =>
      nativeModelDefinition({ layers: [{ ...layer('model', 1), digest: '../../private' }] }, blob),
    /Invalid upstream/,
  );
  assert.throws(() => nativeModelDefinition({ layers: [] }, blob), /Expected one language/);
  assert.throws(
    () => nativeModelDefinition({ layers: [layer('model', 1), layer('model', 2)] }, blob),
    /Expected one language/,
  );
  assert.throws(
    () =>
      nativeModelDefinition(
        { layers: [layer('model', 1), layer('projector', 2), layer('projector', 3)] },
        blob,
      ),
    /Expected one language/,
  );
});

test('llama.cpp receives a bounded per-request reasoning budget', () => {
  for (const value of [0, 48, 256, 4096]) assert.equal(reasoningBudget(value), value);
  for (const value of [-1, 4097, 48.5, '48', null, Infinity])
    assert.throws(() => reasoningBudget(value), /Invalid/);
  const config = { ...settings, reasoningBudget: 64 };
  const options = { config, model: { name: 'fixture' } };
  const messages = [{ role: 'user', content: 'Hello' }];
  const thinking = llamaChatBody({ messages, reasoning_effort: 'high' }, options);
  const ordinary = llamaChatBody({ messages, reasoning_effort: 'off' }, options);
  assert.equal(thinking.reasoning_budget, 256);
  assert.equal(thinking.chat_template_kwargs.enable_thinking, true);
  assert.equal(ordinary.reasoning_budget, 0);
  assert.equal(ordinary.chat_template_kwargs.enable_thinking, false);
  assert.deepEqual(ordinary.messages, thinking.messages);
});
