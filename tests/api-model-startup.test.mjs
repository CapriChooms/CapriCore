// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';

// Exercise the real provider functions while replacing every side-effecting
// dependency before import. No service, model, network or owner file is used.
async function fixture(options, verify) {
  const key = 'capri-startup-fixture-' + randomUUID();
  const coreUrl = new URL('../packages/runtime/src/providers/core.mjs', import.meta.url);
  coreUrl.searchParams.set('fixture', key);
  const settings = {
    model: 'fixture-language:latest',
    embeddingModel: 'fixture-memory:latest',
    contextTokens: 8192,
    acceleration: 'cpu',
    preloadModels: true,
    modelCapabilities: ['thinking'],
    keepAlive: -1,
    agentId: 'fixture-agent',
    ...options.settings,
  };
  const rt = {
    ollamaUrl: 'http://fixture.invalid/ollama',
    gatewayUrl: 'http://fixture.invalid/gateway',
    logPrefix: 'fixture-gateway',
    remote: { enabled: true, ...options.remote },
  };
  const calls = [];
  let resident = structuredClone(options.resident ?? []);
  const installed = (options.installed ?? [settings.embeddingModel]).map((name) => ({ name }));
  const state = {
    settings,
    rt,
    startLlama: async (_rt, value) => {
      calls.push({ name: 'startLlama', options: value });
      options.afterOllama?.();
      return { version: 'fixture' };
    },
    startGateway: async () => calls.push({ name: 'startGateway' }),
    stopManaged: () => assert.fail('Stopping services is outside startup verification'),
    ensureNativeLanguageModel: async () => calls.push({ name: 'ensureNativeLanguageModel' }),
    ensureEmbeddingModel: async (_rt, value) => {
      calls.push({ name: 'ensureEmbeddingModel', options: value });
      return value.inventory;
    },
    managedProcess: () => {
      calls.push({ name: 'managedProcess' });
      return null;
    },
    runCli: () => assert.fail('No real or synthetic CLI should be required'),
    readFileSync: () => assert.fail('No primed marker or owner file should be read'),
    writeFileSync: () => assert.fail('No primed marker or owner file should be written'),
    request: async (url, value = {}) => {
      value.signal?.throwIfAborted();
      const endpoint = url.startsWith(rt.ollamaUrl)
        ? url.slice(rt.ollamaUrl.length)
        : url.slice(rt.gatewayUrl.length);
      calls.push({ name: endpoint, options: value });
      if (endpoint === '/api/tags') return { models: installed };
      if (endpoint === '/api/ps') {
        options.afterPs?.();
        return { models: structuredClone(resident) };
      }
      if (endpoint === '/api/generate') {
        if (options.releaseError) throw new Error('Synthetic unload failure');
        const body = JSON.parse(value.body);
        resident = resident.filter((model) => model.name !== body.model);
        return options.releaseResponse ?? { done: true };
      }
      if (endpoint === '/api/embed') return { embeddings: [[0]] };
      if (endpoint === '/api/chat') {
        if (options.warmupFails) throw new Error('Synthetic model warmup timeout');
        return { message: { content: 'Ready' } };
      }
      assert.fail('Unexpected request: ' + endpoint);
    },
  };
  globalThis[key] = state;
  const prefix = `const f = globalThis[${JSON.stringify(key)}];\n`;
  const functions = (...names) =>
    names.map((name) => `export const ${name} = (...args) => f.${name}(...args);`).join('\n');
  const modules = new Map([
    ['../config/settings.mjs', 'export const settings = f.settings;'],
    ['../context.mjs', 'export const runtime = () => f.rt; export const headers = () => ({});'],
    ['./services.mjs', functions('startLlama', 'startGateway', 'stopManaged')],
    ['../http.mjs', functions('request')],
    ['../host/processes.mjs', functions('managedProcess')],
    ['../client.mjs', functions('runCli')],
    ['../host/paths.mjs', 'export const root = "C:/capri-isolated-no-files";'],
    ['node:fs', functions('readFileSync', 'writeFileSync')],
    ['./native-model.mjs', functions('ensureNativeLanguageModel')],
    ['./embedding-model.mjs', functions('ensureEmbeddingModel')],
    [
      '../hardware/responsiveness.mjs',
      'export const responsiveness = () => ({agentWarmupTimeoutMs: 100});',
    ],
  ]);
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL !== coreUrl.href) return next(specifier, context);
      if (modules.has(specifier))
        return {
          url:
            'data:text/javascript;base64,' +
            Buffer.from(prefix + modules.get(specifier)).toString('base64'),
          shortCircuit: true,
        };
      assert.ok(
        ['node:path', 'node:crypto', './runner-policy.mjs'].includes(specifier),
        'Unmocked provider import: ' + specifier,
      );
      return next(specifier, context);
    },
  });
  try {
    let core;
    try {
      core = await import(coreUrl.href);
    } finally {
      hook.deregister();
    }
    await verify({ core, rt, settings, calls, names: () => calls.map((call) => call.name) });
  } finally {
    hook.deregister();
    delete globalThis[key];
  }
}

function noLanguageOrAgent(calls) {
  assert.equal(
    calls.some((call) =>
      ['ensureNativeLanguageModel', 'managedProcess', '/api/chat', '/v1/chat/completions'].includes(
        call.name,
      ),
    ),
    false,
  );
}

test('default and enabled API skip starts core without local language preparation or agent priming', async () => {
  for (const skipLocalModelOnApi of [undefined, true]) {
    await fixture(
      { remote: { skipLocalModelOnApi } },
      async ({ core, rt, settings, calls, names }) => {
        const stages = [];
        assert.deepEqual(await core.startCore(rt, { onStage: (...stage) => stages.push(stage) }), {
          version: 'fixture',
        });
        assert.deepEqual(names(), [
          'startLlama',
          '/api/ps',
          '/api/tags',
          'ensureEmbeddingModel',
          'startGateway',
          '/api/ps',
          '/api/embed',
        ]);
        noLanguageOrAgent(calls);
        assert.equal(calls.filter((call) => call.name === '/api/generate').length, 0);
        const embedding = JSON.parse(calls.find((call) => call.name === '/api/embed').options.body);
        assert.equal(embedding.model, settings.embeddingModel);
        assert.deepEqual(embedding.options, { num_gpu: 0 });
        assert.deepEqual(stages, [
          ['core', 'running'],
          ['core', 'ready'],
          ['models', 'running'],
          ['models', 'ready'],
        ]);
      },
    );
  }
});

test('API skip releases only the exact resident configured language model even without preload', async () => {
  for (const preload of [false, true]) {
    await fixture(
      {
        resident: [
          { name: 'fixture-language:latest' },
          { name: 'fixture-language:other' },
          { name: 'fixture-memory:latest', size_vram: 0 },
          { name: 'unrelated:latest' },
        ],
      },
      async ({ core, rt, settings, calls, names }) => {
        await core.startCore(rt, { preload });
        const releases = calls.filter((call) => call.name === '/api/generate');
        assert.equal(releases.length, 1);
        assert.deepEqual(JSON.parse(releases[0].options.body), {
          model: settings.model,
          keep_alive: 0,
          stream: false,
        });
        assert.equal(releases[0].options.timeout, 30000);
        assert.equal(releases[0].options.method, 'POST');
        assert.ok(names().indexOf('/api/generate') < names().indexOf('ensureEmbeddingModel'));
        noLanguageOrAgent(calls);
        if (!preload)
          assert.deepEqual(names(), [
            'startLlama',
            '/api/ps',
            '/api/generate',
            '/api/tags',
            'ensureEmbeddingModel',
            'startGateway',
          ]);
      },
    );
  }
});

test('API skip does not unload memory, similar aliases or unrelated resident models', async () => {
  for (const sameModel of [false, true]) {
    await fixture(
      {
        settings: sameModel ? { model: 'fixture-memory:latest' } : {},
        resident: [
          { name: 'fixture-language:other' },
          { name: 'fixture-memory:latest', size_vram: 0 },
          { name: 'unrelated:latest' },
        ],
      },
      async ({ core, rt, calls }) => {
        await core.startCore(rt, { preload: false });
        noLanguageOrAgent(calls);
        assert.equal(
          calls.some((call) => call.name === '/api/generate'),
          false,
        );
      },
    );
  }
});

test('failed or unconfirmed release aborts startup before gateway and warmups', async () => {
  for (const failure of [
    { releaseError: true },
    { releaseResponse: {} },
    { releaseResponse: { done: true, error: 'Synthetic failure' } },
  ]) {
    await fixture(
      { ...failure, resident: [{ name: 'fixture-language:latest' }] },
      async ({ core, rt, calls, names }) => {
        await assert.rejects(core.startCore(rt), /Synthetic unload failure|could not be unloaded/);
        assert.deepEqual(names(), ['startLlama', '/api/ps', '/api/generate']);
        noLanguageOrAgent(calls);
      },
    );
  }
});

test('API opt-out warms only an installed local model and never imports or downloads it', async () => {
  for (const installed of [false, true]) {
    await fixture(
      {
        remote: { skipLocalModelOnApi: false },
        installed: ['fixture-memory:latest', ...(installed ? ['fixture-language:latest'] : [])],
      },
      async ({ core, rt, calls, names }) => {
        await core.startCore(rt);
        assert.equal(
          calls.some((call) => call.name === 'ensureNativeLanguageModel'),
          false,
        );
        assert.equal(
          calls.some((call) => call.name === 'managedProcess'),
          false,
        );
        assert.equal(
          calls.some((call) => call.name === '/api/generate'),
          false,
        );
        assert.equal(calls.filter((call) => call.name === '/api/chat').length, installed ? 1 : 0);
        assert.equal(
          calls.filter((call) => call.name === '/api/tags').length,
          1,
          'startCore passes its verified inventory to warmup',
        );
        assert.ok(names().includes('startGateway'));
        assert.ok(names().includes('/api/embed'));
      },
    );
  }
});

test('direct warmup queries installation only for API opt-out and never primes an API agent', async () => {
  for (const skipLocalModelOnApi of [undefined, true, false]) {
    await fixture(
      {
        remote: { skipLocalModelOnApi },
        installed: ['fixture-memory:latest', 'fixture-language:latest'],
      },
      async ({ core, rt, calls }) => {
        await core.prewarmAgentRuntime(rt);
        assert.deepEqual(calls, []);
        await core.prewarmModels(rt);
        assert.equal(
          calls.filter((call) => call.name === '/api/tags').length,
          skipLocalModelOnApi === false ? 1 : 0,
        );
        assert.equal(
          calls.filter((call) => call.name === '/api/chat').length,
          skipLocalModelOnApi === false ? 1 : 0,
        );
        assert.equal(
          calls.some((call) => call.name === 'ensureNativeLanguageModel'),
          false,
        );
      },
    );
  }
});

test('preload false prevents API opt-out chat and embedding warmup', async () => {
  await fixture(
    {
      remote: { skipLocalModelOnApi: false },
      installed: ['fixture-memory:latest', 'fixture-language:latest'],
    },
    async ({ core, rt, names }) => {
      await core.startCore(rt, { preload: false });
      assert.deepEqual(names(), [
        'startLlama',
        '/api/tags',
        'ensureEmbeddingModel',
        'startGateway',
      ]);
    },
  );
});

test('local startup retains language preparation, required inventory and CPU warmup', async () => {
  for (const installed of [false, true]) {
    await fixture(
      {
        remote: { enabled: false, skipLocalModelOnApi: true },
        installed: ['fixture-memory:latest', ...(installed ? ['fixture-language:latest'] : [])],
      },
      async ({ core, rt, calls, names }) => {
        if (!installed) {
          await assert.rejects(core.startCore(rt), { code: 'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING' });
          assert.deepEqual(names(), [
            'startLlama',
            'ensureNativeLanguageModel',
            '/api/tags',
            'ensureEmbeddingModel',
          ]);
          return;
        }
        await core.startCore(rt);
        assert.equal(calls.filter((call) => call.name === 'ensureNativeLanguageModel').length, 1);
        assert.equal(calls.filter((call) => call.name === 'managedProcess').length, 1);
        assert.equal(
          calls.some((call) => call.name === '/api/generate'),
          false,
        );
        assert.deepEqual(
          JSON.parse(calls.find((call) => call.name === '/api/chat').options.body).options,
          { num_ctx: 8192, num_predict: 1, num_gpu: 0 },
        );
        assert.deepEqual(
          JSON.parse(calls.find((call) => call.name === '/api/embed').options.body).options,
          { num_gpu: 0 },
        );
      },
    );
  }
});

test('a failed optional warmup does not take an already verified local core offline', async () => {
  await fixture(
    {
      remote: { enabled: false },
      installed: ['fixture-memory:latest', 'fixture-language:latest'],
      warmupFails: true,
    },
    async ({ core, rt }) => {
      const stages = [];
      assert.deepEqual(await core.startCore(rt, { onStage: (...stage) => stages.push(stage) }), {
        version: 'fixture',
      });
      assert.deepEqual(stages, [
        ['core', 'running'],
        ['core', 'ready'],
        ['models', 'running'],
        ['models', 'failed'],
      ]);
    },
  );
});

test('aborted startup and direct warmup perform no service or network work', async () => {
  await fixture({}, async ({ core, rt, calls }) => {
    const controller = new AbortController();
    controller.abort(new Error('Synthetic startup cancelled'));
    for (const operation of [core.startCore, core.prewarmModels, core.prewarmAgentRuntime])
      await assert.rejects(
        operation(rt, { signal: controller.signal }),
        /Synthetic startup cancelled/,
      );
    assert.deepEqual(calls, []);
  });
  const controller = new AbortController();
  await fixture(
    { afterOllama: () => controller.abort(new Error('Synthetic startup cancelled')) },
    async ({ core, rt, names }) => {
      await assert.rejects(
        core.startCore(rt, { signal: controller.signal }),
        /Synthetic startup cancelled/,
      );
      assert.deepEqual(names(), ['startLlama']);
    },
  );
  const duringWarmup = new AbortController();
  await fixture(
    {
      remote: { skipLocalModelOnApi: false },
      installed: ['fixture-memory:latest', 'fixture-language:latest'],
      afterPs: () => duringWarmup.abort(new Error('Synthetic warmup cancelled')),
    },
    async ({ core, rt, names }) => {
      await assert.rejects(
        core.prewarmModels(rt, { signal: duringWarmup.signal }),
        /Synthetic warmup cancelled/,
      );
      assert.deepEqual(names(), ['/api/tags', '/api/ps']);
    },
  );
});
