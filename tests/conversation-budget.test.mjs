// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationBudget,
  readConversationBudget,
} from '../apps/desktop/conversation-budget.mjs';
const base = { model: 'capri-qwen3.5:9b', contextTokens: 32768 };
const session = {
  model: base.model,
  sessionId: 'existing',
  totalTokens: 21664,
  totalTokensFresh: true,
  contextBudgetStatus: { model: base.model, sessionId: 'existing', estimatedPromptTokens: 30460 },
};

test('observed CPU fallback gets a CPU prefill allowance even in automatic acceleration mode', () => {
  assert.equal(
    conversationBudget({ ...base, residentBytes: 2 ** 30, residentGpuBytes: 0 }).firstTextTimeoutMs,
    120000,
  );
  assert.equal(
    conversationBudget({ ...base, residentBytes: 2 ** 30, residentGpuBytes: 2 ** 29 })
      .firstTextTimeoutMs,
    30000,
  );
  for (const residentBytes of [undefined, 0, NaN])
    assert.equal(
      conversationBudget({ ...base, residentBytes, residentGpuBytes: 0 }).firstTextTimeoutMs,
      30000,
    );
  assert.equal(
    conversationBudget({ ...base, residentBytes: 2 ** 30, residentGpuBytes: 0, timeoutMs: 60000 })
      .firstTextTimeoutMs,
    60000,
  );
});

test('a large existing conversation gets bounded prefill time even when Qwen is already resident', () => {
  assert.deepEqual(conversationBudget({ ...base, session }), {
    firstTextTimeoutMs: 150000,
    promptTokens: 30460,
    source: 'gateway-estimate',
  });
  assert.equal(
    conversationBudget({ ...base, session, timeoutMs: 90000 }).firstTextTimeoutMs,
    60000,
  );
  assert.equal(
    conversationBudget({ ...base, session, firstTextTimeoutMs: 180000, timeoutMs: 300000 })
      .firstTextTimeoutMs,
    180000,
  );
  assert.equal(
    conversationBudget({ ...base, session: { ...session, totalTokens: 1e12 } }).promptTokens,
    32768,
  );
});

test('small, foreign and invalid context metadata cannot change the ordinary deadline', () => {
  for (const value of [
    undefined,
    { model: 'other', totalTokens: 30000 },
    {
      ...session,
      totalTokensFresh: false,
      contextBudgetStatus: { ...session.contextBudgetStatus, sessionId: 'old' },
    },
    { model: base.model, totalTokens: NaN },
    { model: base.model, totalTokens: 3000 },
  ])
    assert.equal(conversationBudget({ ...base, session: value }).firstTextTimeoutMs, 30000);
  assert.equal(conversationBudget({ ...base, historyCharacters: 18206 }).source, 'local-history');
  assert.equal(
    conversationBudget({ ...base, historyCharacters: 18206 }).firstTextTimeoutMs,
    150000,
  );
});

test('optional session metadata reads only the requested session and failure preserves the conversation', async () => {
  const result = await readConversationBudget({
    ...base,
    sessionKey: 'agent:capri:main',
    rpc: {
      call: async (method, args) => {
        assert.equal(method, 'sessions.describe');
        assert.deepEqual(args, { key: 'agent:capri:main' });
        return { session };
      },
    },
  });
  assert.equal(result.firstTextTimeoutMs, 150000);
  assert.equal(
    (
      await readConversationBudget({
        ...base,
        historyCharacters: 18206,
        rpc: {
          call: async () => {
            throw Error('Metadata unavailable');
          },
        },
      })
    ).source,
    'local-history',
  );
  const controller = new AbortController();
  controller.abort(new Error('Owner cancelled'));
  await assert.rejects(
    readConversationBudget({
      ...base,
      signal: controller.signal,
      rpc: {
        call: () => assert.fail('Cancelled metadata read'),
      },
    }),
    /Owner cancelled/,
  );
});
