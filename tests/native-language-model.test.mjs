import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { nativeModelDefinition } from '../packages/runtime/src/providers/native-model.mjs';
import {
  reasoningBudget,
  environment,
  runtime,
  initialize,
  root,
  settings,
} from '../packages/runtime/src/index.mjs';

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

test('the owned worker receives a best-effort backend reasoning hint without changing context', () => {
  for (const value of [0, 48, 256, 4096]) assert.equal(reasoningBudget(value), value);
  for (const value of [-1, 4097, 48.5, '48', null, Infinity])
    assert.throws(() => reasoningBudget(value), /Invalid/);
  const parent = path.join(root, '.runtime/test-data/native-environment');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'fixture-'));
  const env = environment(
    initialize(runtime({ stateDir: folder, workspace: path.join(folder, 'workspace') })),
  );
  assert.equal(env.LLAMA_ARG_THINK_BUDGET, '4096');
  assert.equal(env.OLLAMA_CONTEXT_LENGTH, String(settings.contextTokens));
});
