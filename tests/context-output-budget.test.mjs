// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  localTurnOutputBudget,
  modelForLocalTurn,
} from '../packages/runtime/src/config/context-policy.mjs';
import { applyOpenClawCompatibility } from '../scripts/openclaw-compat.mjs';
import { root } from '../packages/runtime/src/index.mjs';

applyOpenClawCompatibility(root);
const { r: applySettings } = await import(
  '../node_modules/openclaw/dist/agent-settings-CZ8x5-4D.mjs'
);
const { p: precheck } = await import(
  '../node_modules/openclaw/dist/context-engine-lifecycle-CV3kXMrz.mjs'
);
const { createOllamaStreamFn } = await import(
  '../node_modules/openclaw/dist/stream.runtime-DVVOeOOt.mjs'
);

const aliases = [
  'capri-qwen3.5:0.8b',
  'capri-qwen3.5:2b',
  'capri-qwen3.5:4b',
  'capri-qwen3.5:9b',
  'gemma4:e2b',
  'ministral-3:3b',
  'capri-hf-0123456789abcdef01234567:latest',
];
const model = (id = 'gemma4:e2b') => ({
  id,
  name: 'Synthetic local fixture',
  provider: 'ollama',
  api: 'ollama',
  input: ['text'],
  reasoning: id !== 'ministral-3:3b',
  maxTokens: 8192,
  contextWindow: 32768,
  params: { num_ctx: 32768, temperature: 0.4 },
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const mode = (thinkingLevel = 'off') => ({ agentId: 'capri', thinkingLevel });

test('each shipped local family reserves 2K for an ordinary turn and 8K for Thinking', () => {
  for (const id of aliases) {
    const original = model(id),
      snapshot = structuredClone(original);
    assert.equal(localTurnOutputBudget(original, mode()), 2048, id);
    assert.equal(localTurnOutputBudget(original, mode('medium')), 8192, id);
    assert.equal(modelForLocalTurn(original, mode()).maxTokens, 2048, id);
    assert.equal(modelForLocalTurn(original, mode('medium')).maxTokens, 8192, id);
    assert.deepEqual(original, snapshot, 'The stored model and generation options stay intact.');
  }
});

test('turn budgets preserve explicit smaller model, generation and context limits', () => {
  assert.equal(localTurnOutputBudget({ ...model(), maxTokens: 768 }, mode('medium')), 768);
  assert.equal(
    localTurnOutputBudget({ ...model(), params: { num_ctx: 65536, num_predict: 512 } }, mode()),
    512,
  );
  assert.equal(localTurnOutputBudget({ ...model(), contextWindow: 8192 }, mode('medium')), 4096);
  assert.equal(
    localTurnOutputBudget({ ...model(), params: { num_ctx: 8192 } }, mode('medium')),
    4096,
  );
  for (const context of [8192, 16384, 32768, 65536, 131072]) {
    const original = { ...model(), contextWindow: context, params: { num_ctx: context } };
    const next = modelForLocalTurn(original, mode());
    assert.equal(next.contextWindow, context);
    assert.deepEqual(next.params, { num_ctx: context, num_predict: 2048 });
    assert.deepEqual(original.params, { num_ctx: context });
  }
});

test('custom providers, other agents and unknown local profiles retain their budgets', () => {
  for (const [original, options] of [
    [model(), { agentId: 'other', thinkingLevel: 'off' }],
    [{ ...model(), provider: 'capri-api' }, mode()],
    [{ ...model(), provider: 'custom' }, mode()],
    [model('custom-local:latest'), mode()],
    [{ ...model(), maxTokens: undefined }, mode()],
  ]) {
    assert.equal(localTurnOutputBudget(original, options), undefined);
    assert.equal(modelForLocalTurn(original, options), original);
  }
});

const reserveFor = (original, thinkingLevel) => {
  let reserve = 20000;
  const cfg = {
    agents: {
      defaults: { model: { primary: 'ollama/' + original.id } },
      entries: { capri: {} },
    },
    models: { providers: { ollama: { models: [original] } } },
  };
  const snapshot = structuredClone(cfg);
  applySettings({
    cfg,
    model: modelForLocalTurn(original, mode(thinkingLevel)),
    agentId: 'capri',
    thinkLevel: thinkingLevel,
    contextTokenBudget: original.contextWindow,
    settingsManager: {
      getCompactionReserveTokens: () => reserve,
      getCompactionKeepRecentTokens: () => 2048,
      getCompactionEnabled: () => true,
      applyOverrides: (value) => {
        reserve = value.compaction.reserveTokens ?? reserve;
      },
    },
  });
  assert.deepEqual(cfg, snapshot);
  return reserve;
};

test('native preflight no longer compacts a fitting ordinary Gemma/Ministral prompt for unused output', () => {
  for (const id of aliases) {
    const original = model(id),
      ordinaryReserve = reserveFor(original, 'off'),
      thinkingReserve = reserveFor(original, 'medium');
    assert.equal(ordinaryReserve, 2048, id);
    assert.equal(thinkingReserve, 8192, id);
    const check = (reserveTokens) =>
      precheck({
        messages: [],
        prompt: '',
        contextTokenBudget: 32768,
        reserveTokens,
        llmBoundaryTokenPressure: {
          estimatedPromptTokens: 25452,
          source: 'synthetic_fixed_boundary',
        },
      });
    assert.equal(check(8192).promptBudgetBeforeReserve, 24576);
    assert.equal(check(8192).route, 'compact_only');
    assert.equal(check(ordinaryReserve).promptBudgetBeforeReserve, 30720);
    assert.equal(check(ordinaryReserve).route, 'fits');
    assert.equal(check(thinkingReserve).route, 'compact_only');
  }
});

test('the pinned foreground dispatcher and settings path carry the same transient budget', () => {
  const runner = readFileSync(
    new URL('../node_modules/openclaw/dist/embedded-agent-CPls2oXD.mjs', import.meta.url),
    'utf8',
  );
  const start = runner.indexOf(
    '\t\tconst effectiveModel = attachModelProviderRuntimePluginHandle(',
  );
  const end = runner.indexOf('\n\t\tparams.assertModelInput', start);
  assert(start > 0 && end > start);
  const original = model();
  const effective = vm.runInNewContext(runner.slice(start, end) + '\neffectiveModel', {
    modelForLocalTurn,
    attachModelProviderRuntimePluginHandle: (value) => value,
    runtime: { effectiveModel: original, thinkLevel: 'off' },
    workspaceResolution: { agentId: 'capri' },
  });
  assert.equal(effective.maxTokens, 2048);
  assert.equal(original.maxTokens, 8192);
  for (const [file, source] of [
    [
      'builtin-openclaw-CcrkVuBH.mjs',
      'model: attempt.model, agentId: attempt.agentId, thinkLevel: attempt.thinkLevel',
    ],
    [
      'attempt-system-prompt-prepare-BIe9Jay8.mjs',
      'model: params.model, agentId: params.agentId, thinkLevel: params.thinkLevel',
    ],
  ])
    assert(
      readFileSync(
        new URL('../node_modules/openclaw/dist/' + file, import.meta.url),
        'utf8',
      ).includes(source),
    );
});

test('real Ollama requests respect ordinary, Thinking and smaller explicit budgets across local families', async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    requests.push(JSON.parse(text));
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ message: { role: 'assistant', content: 'Synthetic answer.' }, done: true }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const stream = createOllamaStreamFn(`http://127.0.0.1:${server.address().port}`);
  const messages = {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic request.' }] }],
  };
  for (const id of ['capri-qwen3.5:2b', 'gemma4:e2b', 'ministral-3:3b']) {
    for (const [thinkingLevel, explicit, expected] of [
      ['off', undefined, 2048],
      ['medium', undefined, 8192],
      ['medium', 6144, 6144],
    ]) {
      const selected = modelForLocalTurn(model(id), mode(thinkingLevel));
      const options = {
        ...(id === 'ministral-3:3b' && thinkingLevel === 'off' ? {} : { reasoning: thinkingLevel }),
        ...(explicit ? { maxTokens: explicit } : {}),
      };
      for await (const _event of stream(selected, messages, options)) {
        /* Drain the actual transport. */
      }
      assert.equal(requests.at(-1).options.num_predict, expected, id);
      assert.equal(requests.at(-1).options.num_ctx, 32768, id);
    }
  }
});
