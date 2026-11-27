// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LlamaModelStore } from '../packages/runtime/src/providers/llama-model-store.mjs';
import { prepareMacModels } from '../apps/desktop/main/macos-models.mjs';

const settings = { model: 'capri-qwen3.5:2b', embeddingModel: 'capri-embed:latest' };
function fixture(available = []) {
  const controller = new AbortController();
  const installed = new Set(available);
  const requests = [],
    pulls = [],
    updates = [];
  const store = {
    upstream: LlamaModelStore.prototype.upstream,
    get(name) {
      if (!installed.has(name)) throw Object.assign(new Error('missing'), { status: 404 });
      return { name };
    },
    async pull(name, { signal, onProgress }) {
      signal.throwIfAborted();
      pulls.push(name);
      onProgress({ completed: 50, status: 'downloading' });
      installed.add(name);
    },
  };
  const run = (overrides = {}) =>
    prepareMacModels({
      store,
      settings,
      localChat: true,
      signal: controller.signal,
      confirm: async (options) => {
        requests.push(options);
        return { response: 0 };
      },
      progress: (message, fraction) => updates.push({ message, fraction }),
      ...overrides,
    });
  return { run, store, installed, controller, requests, pulls, updates };
}

test('a local first run displays the pinned chat and memory sizes before downloading', async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  assert.deepEqual(f.pulls, [settings.model, settings.embeddingModel]);
  assert.equal(f.requests.length, 1);
  const [request] = f.requests;
  assert.match(request.detail, /qwen3\.5:2b · 2\.68 GB/);
  assert.match(request.detail, /bge-m3:latest · 1\.16 GB/);
  assert.match(request.detail, /Up to 3\.84 GB/);
  assert.deepEqual(request.buttons, ['Download', 'Later']);
  assert.equal(request.defaultId, request.cancelId);
  assert.equal(request.signal, f.controller.signal);
  assert.ok(f.updates.some(({ fraction }) => fraction > 0));
  assert.equal(await f.run(), true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.pulls.length, 2);
});

test('API mode asks only for missing memory, and Later leaves storage untouched', async () => {
  const f = fixture();
  assert.equal(
    await f.run({
      localChat: false,
      confirm: async (options) => {
        assert.match(options.detail, /bge-m3/);
        assert.doesNotMatch(options.detail, /qwen/);
        return { response: options.cancelId };
      },
    }),
    false,
  );
  assert.deepEqual(f.pulls, []);
  assert.deepEqual(f.updates, []);
  assert.equal(await f.run({ localChat: false }), true);
  assert.deepEqual(f.pulls, [settings.embeddingModel]);
});

test('an existing custom model can start but a missing one is never fetched', async () => {
  const custom = { ...settings, model: 'user/example:latest' };
  const f = fixture([settings.embeddingModel]);
  await assert.rejects(f.run({ settings: custom }), { code: 'CAPRI_MAC_MODEL_SETUP' });
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.pulls, []);
  f.installed.add(custom.model);
  assert.equal(await f.run({ settings: custom }), true);
  assert.deepEqual(f.requests, []);
});

test('cancelling the native sheet or pausing a transfer stops subsequent pulls', async () => {
  const sheet = fixture();
  await assert.rejects(
    sheet.run({
      confirm: async () => {
        sheet.controller.abort();
        return { response: 0 };
      },
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(sheet.pulls, []);
  const f = fixture();
  const reason = new Error('pause');
  f.store.pull = async (name, { signal }) => {
    f.pulls.push(name);
    f.controller.abort(reason);
    signal.throwIfAborted();
  };
  await assert.rejects(f.run(), (error) => error === reason);
  assert.deepEqual(f.pulls, [settings.model]);
});

test('a failed second transfer can retry without re-downloading completed weights', async () => {
  const f = fixture();
  const pull = f.store.pull;
  f.store.pull = async (name, options) => {
    if (name === settings.embeddingModel) throw new Error('Not enough free disk space.');
    return pull(name, options);
  };
  await assert.rejects(f.run(), /free disk space.+Reconnect/);
  f.store.pull = pull;
  assert.equal(await f.run(), true);
  assert.deepEqual(f.pulls, [settings.model, settings.embeddingModel]);
  assert.match(f.requests.at(-1).detail, /Up to 1\.16 GB/);
});
