// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { settings } from '../packages/runtime/src/config/settings.mjs';
import { generationParams } from '../packages/runtime/src/config/inference.mjs';
import { createGatewayConfiguration } from '../packages/runtime/src/context.mjs';
import { nativeModelDefinition } from '../packages/runtime/src/providers/native-model.mjs';
import { ensureLanguageModelReady } from '../packages/runtime/src/providers/model-residency.mjs';
import { localRunnerOptions } from '../packages/runtime/src/providers/runner-policy.mjs';
import { computerIntentClassifier } from '../apps/desktop/computer-planner.mjs';

for (const device of [
  { acceleration: 'auto', cpuThreads: 4 },
  { acceleration: 'cpu', cpuThreads: 2 },
  { acceleration: 'auto' },
]) {
  test(`warmup, intent and gateway share runner allocation: ${JSON.stringify(device)}`, async () => {
    const config = { ...settings, ...device, cpuThreads: device.cpuThreads };
    const runner = localRunnerOptions(config);
    const params = { num_ctx: config.contextTokens, ...runner };
    const gateway = createGatewayConfiguration(
      { ollamaUrl: 'http://127.0.0.1:11435', gatewayPort: 18789, workspace: 'fixture' },
      config,
    ).models.providers.ollama.models[0].params;
    const native = nativeModelDefinition(
      {
        layers: [
          { mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${'a'.repeat(64)}` },
        ],
      },
      () => assert.fail('A plain GGUF has no parameter blob'),
      generationParams(config.generation, config),
    ).parameters;
    let warmup, intent;
    await ensureLanguageModelReady(
      {
        url: 'http://127.0.0.1:11435',
        model: config.model,
        contextTokens: config.contextTokens,
        ...device,
      },
      {
        requestImpl: async (url, options) => {
          if (url.endsWith('/api/ps')) return { models: [] };
          warmup = JSON.parse(options.body);
          return { done: true };
        },
      },
    );
    const classify = computerIntentClassifier({
      url: 'http://127.0.0.1:11435',
      model: config.model,
      params,
      fetchImpl: async (_url, options) => {
        intent = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            done: true,
            message: { content: '{"intent":"chat","usesPrevious":false}' },
          }),
        );
      },
    });
    assert.deepEqual(await classify('How are you?', { fullComputerAccess: true }), {
      intent: 'chat',
      usesPrevious: false,
    });
    for (const [name, options] of [
      ['warmup', warmup.options],
      ['intent', intent.options],
      ['gateway', gateway],
      ['native alias', native],
    ]) {
      assert.equal(options.num_thread, runner.num_thread, `${name}: thread allocation`);
      assert.equal(options.num_gpu, runner.num_gpu, `${name}: GPU allocation`);
    }
    assert.equal(warmup.options.num_ctx, gateway.num_ctx);
    assert.equal(intent.options.num_ctx, gateway.num_ctx);
    assert.equal(warmup.options.num_predict, 1);
    assert.equal(intent.options.num_predict, 64);
    assert.equal(intent.options.temperature, 0);
    assert.equal(intent.shift, warmup.shift);
    assert.equal(intent.truncate, warmup.truncate);
    assert.equal(intent.think, false);
  });
}

test('thread allocation is bounded by the host and ignores unrelated settings', () => {
  assert.deepEqual(
    localRunnerOptions({
      cpuThreads: availableParallelism() + 1,
      acceleration: 'auto',
      temperature: 1,
      num_predict: 999,
    }),
    { num_thread: availableParallelism() },
  );
  assert.deepEqual(localRunnerOptions(), {});
});
