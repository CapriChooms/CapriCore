// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import { ContextSampler } from '../apps/desktop/context-usage.mjs';
import { conversationBudget } from '../apps/desktop/conversation-budget.mjs';

async function capture(text, extra = {}) {
  const store = {
    values: [],
    put(value) {
      const index = this.values.findIndex((item) => item.id === value.id);
      if (index < 0) this.values.push({ ...value });
      else this.values[index] = { ...value };
    },
    snapshot() {
      return this.values;
    },
  };
  let sent;
  const persona = 'Personality remains complete. '.repeat(270);
  const chat = new ChatService({
    gatewayUrl: 'http://127.0.0.1:18789',
    agentId: 'capri',
    sessionKey: 'fixture',
    token: () => '',
    persona: () => persona,
    store,
    interfaceState: () => ({ languages: { conversation: 'fr' } }),
    ...extra,
    fetchImpl: async (url, options) => {
      sent = { headers: options.headers, body: JSON.parse(options.body) };
      return new Response(
        'data: {"choices":[{"delta":{"content":"Ready."}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  await chat.send({ id: randomUUID(), text }, () => {});
  return { ...sent, persona };
}

test('memory-only conversation keeps personality and language without unrelated action manuals', async () => {
  const social = await capture('Hi'),
    unclassified = await capture('Find the missing file');
  assert.equal(social.headers['x-capri-tools-once'], 'conversation');
  const prompt = social.body.messages[0].content;
  assert(prompt.includes(social.persona));
  assert(prompt.includes('memory tools'));
  assert(prompt.includes('French'));
  assert(prompt.includes('avatar'));
  assert(!prompt.includes('filesystem_control trash'));
  assert(prompt.length < unclassified.body.messages[0].content.length * 0.6);
  assert.equal(unclassified.headers['x-capri-tools-once'], undefined);
  assert(unclassified.body.messages[0].content.includes('filesystem_control'));
});

test('cached context can budget a turn immediately while a shared metadata read is still pending', async () => {
  let finish,
    calls = 0;
  const sampler = new ContextSampler({
    model: 'fixture',
    contextTokens: 32768,
    sessionKey: 'fixture',
    rpc: {
      call() {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  });
  const pending = sampler.sample();
  assert.equal(sampler.peekSession(), null);
  assert.equal(
    conversationBudget({ model: 'fixture', contextTokens: 32768, session: sampler.peekSession() })
      .source,
    'default',
  );
  assert.equal(calls, 1);
  finish({
    session: {
      model: 'fixture',
      sessionId: 'technical-id',
      totalTokens: 18000,
      totalTokensFresh: true,
      privateText: 'MUST-NOT-CACHE',
      contextBudgetStatus: {
        model: 'fixture',
        sessionId: 'technical-id',
        estimatedPromptTokens: 22000,
        privateText: 'MUST-NOT-CACHE',
      },
    },
  });
  await pending;
  const cached = sampler.peekSession();
  assert(!JSON.stringify(cached).includes('MUST-NOT-CACHE'));
  assert.equal(
    conversationBudget({ model: 'fixture', contextTokens: 32768, session: cached }).promptTokens,
    22000,
  );
  cached.totalTokens = 0;
  assert.equal(sampler.peekSession().totalTokens, 18000);
  sampler.invalidate();
  assert.equal(sampler.peekSession(), null);
});
