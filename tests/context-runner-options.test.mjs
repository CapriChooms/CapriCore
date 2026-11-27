// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncRunnerOptions } from '../packages/runtime/src/context.mjs';

const model = 'capri-qwen3.5:0.8b';
const providers = (entries) => ({ models: { providers: { ollama: { models: entries } } } });

test('a changed cpuThreads reaches an existing managed model at the next start', () => {
  const config = providers([
    { id: model, params: { num_ctx: 32768, num_thread: 2, temperature: 0.8 } },
  ]);
  const managed = providers([{ id: model, params: { num_ctx: 32768, num_thread: 8 } }]);
  syncRunnerOptions(config, managed, model);
  assert.deepEqual(config.models.providers.ollama.models[0].params, {
    num_ctx: 32768,
    num_thread: 8,
    temperature: 0.8,
  });
});

test('num_gpu follows the acceleration setting in both directions', () => {
  const config = providers([{ id: model, params: { num_ctx: 4096 } }]);
  syncRunnerOptions(
    config,
    providers([{ id: model, params: { num_gpu: 0, num_thread: 4 } }]),
    model,
  );
  assert.equal(config.models.providers.ollama.models[0].params.num_gpu, 0);
  syncRunnerOptions(config, providers([{ id: model, params: { num_thread: 4 } }]), model);
  assert.equal('num_gpu' in config.models.providers.ollama.models[0].params, false);
  assert.equal(config.models.providers.ollama.models[0].params.num_thread, 4);
});

test('runner options are removed when the managed model no longer sets them', () => {
  const config = providers([{ id: model, params: { num_thread: 2, num_gpu: 0 } }]);
  syncRunnerOptions(config, providers([{ id: model }]), model);
  assert.deepEqual(config.models.providers.ollama.models[0].params, {});
  const orphaned = providers([{ id: model, params: { num_thread: 2 } }]);
  syncRunnerOptions(orphaned, providers([{ id: 'other', params: { num_thread: 8 } }]), model);
  assert.deepEqual(orphaned.models.providers.ollama.models[0].params, {});
});

test('a model that is not managed or not configured is left alone', () => {
  const config = providers([{ id: 'custom:7b', params: { num_thread: 2 } }]);
  const before = structuredClone(config);
  syncRunnerOptions(config, providers([{ id: model, params: { num_thread: 8 } }]), model);
  assert.deepEqual(config, before);
  assert.deepEqual(syncRunnerOptions({}, providers([]), model), {});
  assert.deepEqual(syncRunnerOptions({ models: { providers: { ollama: {} } } }, {}, model), {
    models: { providers: { ollama: {} } },
  });
});
