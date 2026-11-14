// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChatService, validateInput } from '../apps/desktop/chat-service.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import { VisualService } from '../apps/desktop/visual-service.mjs';
import { visionImage } from './fixtures/vision-image.mjs';
import {
  THINKING_INSTRUCTION,
  validateThinkingBriefing,
  VisibleAnswerStream,
} from '../apps/desktop/thinking-mode.mjs';
import {
  sanitizeAvatarComposerState,
  validateAvatarComposerAction,
} from '../apps/desktop/main/avatar-composer-bridge.mjs';

function fixture(options = {}) {
  const messages = [],
    events = [],
    requests = [];
  const store = {
    snapshot: () => messages,
    put(message) {
      const index = messages.findIndex((item) => item.id === message.id);
      if (index < 0) messages.push({ ...message });
      else messages[index] = { ...message };
    },
  };
  const chat = new ChatService({
    gatewayUrl: 'http://127.0.0.1:18791',
    agentId: 'capri',
    sessionKey: 'agent:capri:fixture',
    token: () => 'fixture-loopback-token',
    persona: () => 'Public synthetic fixture persona.',
    store,
    interfaceState: () => ({ languages: { conversation: 'ru' } }),
    fetchImpl: async (_url, request) => {
      requests.push(request);
      const text = 'The checked answer is 42.';
      return new Response(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: text } }] }) +
          '\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
    ...options,
  });
  return {
    chat,
    messages,
    events,
    requests,
    send: (text, thinking) =>
      chat.send(
        { id: randomUUID(), text, ...(thinking === undefined ? {} : { thinking }) },
        (event) => events.push(event),
      ),
  };
}

test('thinking is explicit, validates booleans and cannot be injected through mini metadata', () => {
  const value = { id: randomUUID(), text: 'A public problem.' };
  assert.equal(validateInput(value).thinking, undefined);
  assert.equal(validateInput({ ...value, thinking: true }).thinking, true);
  for (const thinking of [null, 1, 'on', {}])
    assert.throws(() => validateInput({ ...value, thinking }));
  assert.deepEqual(validateAvatarComposerAction({ type: 'thinking', enabled: true }), {
    type: 'thinking',
    enabled: true,
  });
  assert.throws(() => validateAvatarComposerAction({ type: 'thinking', enabled: 'yes' }));
  assert.throws(() =>
    validateAvatarComposerAction({ type: 'thinking', enabled: true, model: 'injected' }),
  );
  assert.deepEqual(
    sanitizeAvatarComposerState({
      thinking: { enabled: true, label: 'Thinking', hint: 'Check the answer', private: 'discard' },
    }).thinking,
    { enabled: true, label: 'Thinking', hint: 'Check the answer' },
  );
});

test('task-specific thinking briefing follows preparation, bypasses fast routing and stays out of history', async () => {
  const order = [];
  const f = fixture({
    prepareModel: async () => {
      order.push('prepare');
      return { conversationBudget: { firstTextTimeoutMs: 20 } };
    },
    prepareThinking: async (request) => {
      order.push('briefing');
      assert.deepEqual(Object.keys(request), ['text', 'language', 'signal']);
      assert.equal(request.text, 'Prove an equation.');
      assert.equal(request.language, 'Russian');
      assert.equal(request.signal.aborted, false);
      return {
        text: 'Проверю условия равенства.',
        approach: 'Сопоставлю условия. Проверю граничные случаи.',
      };
    },
    requestRouter: {
      classify: () => assert.fail('An explicit thinking request cannot become fast chat'),
    },
  });
  await f.chat.send({ id: randomUUID(), text: 'Prove an equation.', thinking: true }, (event) => {
    f.events.push(event);
    order.push(event.type);
  });
  assert.ok(order.indexOf('prepare') < order.indexOf('briefing'));
  assert.ok(order.indexOf('briefing') < order.indexOf('turn.preface'));
  assert.ok(order.indexOf('turn.preface') < order.indexOf('turn.approach'));
  assert.ok(order.indexOf('turn.approach') < order.indexOf('turn.delta'));
  assert.equal(f.requests[0].headers['x-capri-thinking-once'], 'medium');
  assert.equal(f.requests[0].headers['x-capri-tools-once'], 'conversation');
  assert.ok(JSON.parse(f.requests[0].body).messages[0].content.includes(THINKING_INSTRUCTION));
  assert.equal(f.events.filter((event) => event.type === 'turn.preface').length, 1);
  assert.equal(f.events.at(-1).type, 'turn.completed');
  assert.equal(f.messages.at(-1).text, 'The checked answer is 42.');
  assert.ok(!JSON.stringify(f.messages).includes('Проверю условия равенства.'));
  assert.ok(!JSON.stringify(f.messages).includes('Сопоставлю условия.'));
  await f.send('Hello.', false);
  assert.equal(f.requests[1].headers['x-capri-thinking-once'], 'off');
});

test('thinking can use the classified dialogue scope without enabling tools or losing its reasoning setting', async () => {
  const f = fixture({ computerIntent: async () => ({ intent: 'chat', usesPrevious: false }) });
  await f.send('Prove an equation.', true);
  assert.equal(f.requests[0].headers['x-capri-thinking-once'], 'medium');
  assert.equal(f.requests[0].headers['x-capri-tools-once'], 'dialogue');
  assert(f.requests[0].body.includes(THINKING_INSTRUCTION));
  assert.equal(f.events.at(-1).type, 'turn.completed');
});

test('default thinking generates one final reply and voices only that answer without a briefing', async () => {
  const spoken = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:18101',
    headers: () => ({}),
    emit: () => {},
    fetchImpl: async (_url, options) => {
      spoken.push(JSON.parse(options.body).text);
      return new Response(Buffer.from(new Float32Array([0.1, -0.1]).buffer), {
        headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000' },
      });
    },
  });
  voice.setReady(true);
  try {
    const f = fixture();
    assert.equal(f.chat.prepareThinking, null);
    await f.chat.send(
      { id: randomUUID(), text: 'Check this equation.', thinking: true },
      (event) => {
        f.events.push(event);
        voice.onChat(event);
      },
    );
    for (let i = 0; i < 100 && !spoken.length; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].headers['x-capri-thinking-once'], 'medium');
    assert.equal(
      f.events.some((event) => ['turn.preface', 'turn.approach'].includes(event.type)),
      false,
    );
    assert.equal(f.events.at(-1).type, 'turn.completed');
    assert.deepEqual(spoken, ['The checked answer is 42.']);
  } finally {
    voice.close();
  }
});

test('default visual thinking keeps its reasoning request without generating an introduction', async () => {
  const requests = [],
    events = [];
  const service = new VisualService({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    modelCapabilities: ['thinking'],
    params: { num_ctx: 16384 },
    persona: () => 'Public fixture.',
    avatars: [],
    rpc: { call: async () => ({ messages: [] }) },
    fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      requests.push(payload);
      return new Response(
        JSON.stringify({
          message: { content: 'The result is 42.' },
          done: true,
          done_reason: 'stop',
        }) + '\n',
      );
    },
  });
  assert.equal(service.prepareThinking, null);
  const result = await service.generate({
    text: 'Check this diagram.',
    png: visionImage(),
    thinking: true,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].think, true);
  assert.equal(
    events.some((event) => ['preface', 'approach'].includes(event.type)),
    false,
  );
  assert.equal(result.text, 'The result is 42.');
});

test('private inline traces and separate reasoning fields never enter a thinking reply or speech stream', async () => {
  const hidden = '<think>PRIVATE_SYNTHETIC_TRACE</think><analysis>OTHER_PRIVATE_TRACE</analysis>42';
  const f = fixture({
    fetchImpl: async () =>
      new Response(
        [...hidden]
          .map(
            (content) =>
              'data: ' +
              JSON.stringify({
                choices: [{ delta: { content, reasoning_content: 'PRIVATE_FIELD' } }],
              }) +
              '\n\n',
          )
          .join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
  await f.send('Solve the public logic puzzle.', true);
  assert.equal(f.messages.at(-1).text, '42');
  assert.ok(!JSON.stringify(f.events).includes('PRIVATE'));
  for (const chunks of [['<think>secret'], ['A', '<thi', 'nk>secret</thi', 'nk>', 'B']]) {
    const stream = new VisibleAnswerStream();
    const actual = chunks.map((chunk) => stream.push(chunk)).join('') + stream.push('', true);
    assert.equal(actual, chunks.length === 1 ? '' : 'AB');
  }
});

test('Escape cancellation during thinking preparation cannot dispatch a late model request', async () => {
  const f = fixture({
    prepareModel: ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  });
  const pending = f.send('Check a mathematical problem.', true);
  assert.equal(f.events.at(-1).type, 'turn.started');
  f.chat.cancel();
  await pending;
  assert.equal(f.requests.length, 0);
  assert.equal(f.events.at(-1).type, 'turn.cancelled');
  assert.equal(f.chat.active, null);
});

test('thinking cannot replace the dedicated Spotify path or grant desktop tools', async () => {
  let briefings = 0;
  const f = fixture({
    prepareThinking: () => {
      briefings++;
      return null;
    },
    interfaceState: () => ({
      spotify: { enabled: true, prepared: true },
      fullComputerAccess: true,
    }),
  });
  await f.send('Play music in Spotify.', true);
  assert.equal(f.requests[0].headers['x-capri-tools-once'], 'spotify');
  assert.equal(f.requests[0].headers['x-capri-thinking-once'], 'off');
  assert.equal(briefings, 0);
});

test('briefing errors, malformed results and absent callbacks silently preserve the answer', async () => {
  for (const prepareThinking of [
    undefined,
    async () => {
      throw new Error('private-provider-error');
    },
    async () => ({ text: 'Bad result', reasoning: 'PRIVATE_TRACE' }),
  ]) {
    const f = fixture({ prepareThinking });
    await f.send('Check the sum of this sequence.', true);
    assert.equal(f.events.at(-1).type, 'turn.completed');
    assert.equal(f.messages.at(-1).text, 'The checked answer is 42.');
    assert.equal(
      f.events.some((event) => ['turn.preface', 'turn.approach'].includes(event.type)),
      false,
    );
    assert.equal(JSON.stringify(f.events).includes('private-provider-error'), false);
  }
});

test('cancellation suppresses a late prepared briefing and never starts the answer request', async () => {
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const f = fixture({
    prepareThinking: async () => {
      entered.resolve();
      return release.promise;
    },
  });
  const pending = f.send('Check the remainder constraints.', true);
  await entered.promise;
  f.chat.cancel();
  release.resolve({ text: 'I will compare the remainders.', approach: 'Compare each congruence.' });
  await pending;
  assert.equal(f.events.at(-1).type, 'turn.cancelled');
  assert.equal(
    f.events.some((event) => ['turn.preface', 'turn.approach'].includes(event.type)),
    false,
  );
  assert.equal(f.requests.length, 0);
});

test('only bounded public briefing fields are accepted', () => {
  const value = {
    text: 'I will check the remainder conditions.',
    approach: 'Compare the congruences. Check boundary cases.',
  };
  assert.deepEqual(validateThinkingBriefing(value), value);
  for (const invalid of [
    null,
    [],
    {},
    { ...value, reasoning: 'private' },
    { ...value, text: 'x'.repeat(241) },
    { ...value, approach: 'x'.repeat(901) },
    { ...value, text: '<think>private</think>' },
    { ...value, approach: '\u0000' },
  ])
    assert.equal(validateThinkingBriefing(invalid), null);
});

test('enabled voice speaks the preface once before the answer; muted voice stays unloaded', async () => {
  const requests = [],
    events = [];
  const voice = new VoiceService({
    url: 'http://127.0.0.1:18101',
    headers: () => ({}),
    emit: (event) => events.push(event),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body).text);
      return new Response(Buffer.from(new Float32Array([0.1, -0.1]).buffer), {
        headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000' },
      });
    },
  });
  voice.setReady(true);
  voice.onChat({ type: 'turn.started', turnId: 'fixture' });
  voice.onChat({ type: 'turn.preface', turnId: 'fixture', text: 'I will check the result.' });
  voice.onChat({ type: 'turn.preface', turnId: 'fixture', text: 'Duplicate.' });
  voice.onChat({
    type: 'turn.approach',
    turnId: 'fixture',
    text: 'PUBLIC_PLAN_MUST_NOT_BE_SPOKEN',
  });
  voice.onChat({ type: 'turn.delta', turnId: 'fixture', text: 'The answer is forty two.' });
  voice.onChat({ type: 'turn.completed', turnId: 'fixture' });
  for (let i = 0; i < 100 && !events.some((event) => event.type === 'voice.generated'); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(requests, ['I will check the result.', 'The answer is forty two.']);
  voice.setEnabled(false);
  voice.onChat({ type: 'turn.started', turnId: 'muted' });
  voice.onChat({ type: 'turn.preface', turnId: 'muted', text: 'This must stay silent.' });
  assert.equal(requests.length, 2);
  assert.equal(voice.turn, null);
  voice.close();
});

test('foreground visual thinking respects model capabilities and context while keeping traces private', async () => {
  for (const [capabilities, context, expectedBudget] of [
    [['thinking'], 16384, 8192],
    [[], 8192, 4096],
  ]) {
    const events = [];
    const service = new VisualService({
      url: 'http://127.0.0.1:11434',
      model: 'fixture',
      modelCapabilities: capabilities,
      params: { num_ctx: context },
      persona: () => 'Public fixture.',
      avatars: [],
      rpc: { call: async () => ({ messages: [] }) },
      prepareThinking: async (request) => {
        assert.deepEqual(Object.keys(request), ['text', 'language', 'signal']);
        assert.equal(request.text, 'Solve the illustrated problem.');
        return {
          text: 'I will identify the constraints in this problem.',
          approach: 'Read the supplied labels. Compare the relevant relations.',
        };
      },
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        assert.equal(payload.think, capabilities.includes('thinking') ? true : undefined);
        assert.equal(payload.options.num_predict, expectedBudget);
        assert.deepEqual(payload.tools, []);
        assert.ok(payload.messages[0].content.includes(THINKING_INSTRUCTION));
        return new Response(
          JSON.stringify({
            message: { content: '<think>PRIVATE_TRACE</think>The result is 42.' },
          }) +
            '\n' +
            JSON.stringify({ done: true, done_reason: 'stop' }) +
            '\n',
        );
      },
    });
    const answer = await service.generate({
      text: 'Solve the illustrated problem.',
      png: visionImage(),
      source: { kind: 'window', label: 'Fixture' },
      thinking: true,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    });
    assert.equal(answer.text, 'The result is 42.');
    assert.deepEqual(
      events.slice(0, 2).map((event) => event.type),
      ['preface', 'approach'],
    );
    assert.ok(!JSON.stringify(events).includes('PRIVATE_TRACE'));
  }
});
