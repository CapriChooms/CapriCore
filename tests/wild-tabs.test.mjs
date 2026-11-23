import assert from 'node:assert/strict';
import test from 'node:test';
import { WildTabs, wildTabReactionGenerator } from '../apps/desktop/wild-tabs.mjs';
import { validateCompanionSettings } from '../apps/desktop/companion-settings.mjs';

const claude = { service: 'Claude', tabId: 'tab-1', token: 'page-1' };

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = {
    allowed: true,
    tab: claude,
    prompts: [],
    closes: [],
    failures: [],
    reactions: [],
  };
  const wild = new WildTabs({
    allowed: () => state.allowed,
    inspect: async (signal) => (state.inspect ? state.inspect(signal) : state.tab),
    close: async (tab, signal) => {
      state.closes.push(tab);
      return state.close ? state.close(signal) : { closed: true };
    },
    onCloseFailure: (reason) => state.failures.push(reason),
    prompt: (prompt) => state.prompts.push(prompt),
    react: async (event, signal) => {
      state.reactions.push({ event, signal });
      return true;
    },
    graceMs: 1000,
  });
  return { state, wild, tick: (ms) => t.mock.timers.tick(ms) };
}

test('the opt-in is off for existing installations and only accepts a Boolean', () => {
  assert.equal(validateCompanionSettings({}).wildCloseAiTabs, false);
  assert.equal(validateCompanionSettings({ wildCloseAiTabs: true }).wildCloseAiTabs, true);
  assert.throws(() => validateCompanionSettings({ wildCloseAiTabs: 'true' }));
});

test('keeping a tab cancels the deadline and reaction and respects that choice after navigation', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  const { id } = state.prompts[0];
  assert.equal(wild.shown(id), true);
  await Promise.resolve();
  assert.equal(wild.keep('old prompt'), false);
  assert.equal(wild.keep(id), true);
  assert.equal(wild.keep(id), false);
  state.tab = { ...claude, token: 'page-2' };
  await wild.scan();
  tick(1000);
  assert.equal(state.reactions.length, 1);
  assert.deepEqual(state.reactions[0].event, { id, service: 'Claude' });
  assert.equal(state.reactions[0].signal.aborted, true);
  assert.deepEqual(state.closes, []);
  assert.deepEqual(state.prompts, [{ id, service: 'Claude', graceMs: 1000 }, null]);
});

test('the countdown permits one close of the displayed target and rechecks permission at expiry', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  assert.equal(wild.shown(state.prompts[0].id), true);
  tick(999);
  assert.deepEqual(state.closes, []);
  tick(1);
  await Promise.resolve();
  assert.deepEqual(state.closes, [claude]);
  assert.deepEqual(state.failures, []);
  assert.equal(state.prompts.at(-1), null);
  state.tab = { service: 'Gemini', tabId: 'tab-2', token: 'page-2' };
  await wild.scan();
  assert.equal(wild.shown(state.prompts.at(-1).id), true);
  state.allowed = false;
  tick(1000);
  assert.deepEqual(state.closes, [claude]);
  assert.equal(state.prompts.at(-1), null);
});

test('a changed foreground tab invalidates the earlier countdown', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  assert.equal(wild.shown(state.prompts[0].id), true);
  tick(450);
  state.tab = null;
  await wild.scan();
  tick(1000);
  assert.deepEqual(state.closes, []);
  assert.equal(state.prompts.at(-1), null);
  assert.equal(state.reactions[0]?.signal.aborted, true);
});

test('a hidden prompt never authorizes the browser operation', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  tick(3000);
  assert.deepEqual(state.closes, []);
  assert.deepEqual(state.reactions, []);
  assert.equal(state.prompts.at(-1), null);
});

test('AI tab reactions send only the verified service and use fresh wording, language and style', async () => {
  const calls = [];
  const replies = [
    'Gemini gets the good tabs now?',
    'Oh, Claude. I see how it is.',
    'Oh, Claude. I see how it is.',
  ];
  let style = 'neutral';
  const generate = wildTabReactionGenerator({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    params: {},
    persona: () => 'Capri fixture persona',
    languages: () => ({ conversation: 'en' }),
    style: () => style,
    fetchImpl: async (url, init) => {
      calls.push({ url: url.href, request: JSON.parse(init.body) });
      return Response.json({ done: true, message: { content: replies.shift() } });
    },
  });
  const signal = new AbortController().signal;
  assert.equal(await generate('https://example.com/sensitive', signal), null);
  assert.equal((await generate('Gemini', signal)).expression, 'skeptical');
  style = 'wild';
  assert.equal((await generate('Claude', signal)).expression, 'sad');
  assert.equal(await generate('Claude', signal), null);
  assert.deepEqual(calls[0].request.tools, []);
  assert.deepEqual(calls[0].request.messages[1], {
    role: 'user',
    content: '{"service":"Gemini"}',
  });
  assert.notEqual(calls[0].request.messages[0].content, calls[1].request.messages[0].content);
});

test('an empty or failed inspection retains the original countdown through one bounded retry', async (t) => {
  for (const failed of [false, true]) {
    await t.test(failed ? 'transient bridge failure' : 'transient empty inspection', async (t) => {
      const { state, wild, tick } = fixture(t);
      await wild.scan();
      const { id } = state.prompts[0];
      assert.equal(wild.shown(id), true);
      state.inspect = () => {
        if (failed) throw new Error('UIA unavailable');
        return null;
      };
      wild.refresh();
      tick(250);
      await Promise.resolve();
      assert.equal(state.prompts.length, 1);
      state.inspect = null;
      tick(650);
      await Promise.resolve();
      assert.equal(state.prompts.length, 1);
      tick(100);
      await Promise.resolve();
      assert.deepEqual(state.closes, [claude]);
      assert.equal(state.prompts.at(-1), null);
    });
  }
});

test('the prompt is invalidated when the bounded retry still finds no matching tab', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  assert.equal(wild.shown(state.prompts[0].id), true);
  state.tab = null;
  wild.refresh();
  tick(250);
  await Promise.resolve();
  assert.equal(state.prompts.length, 1);
  tick(650);
  await Promise.resolve();
  assert.equal(state.prompts.at(-1), null);
  tick(100);
  assert.deepEqual(state.closes, []);
});

test('browser observation cannot abort a close in flight, and events merge into one follow-up inspection', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  const { id } = state.prompts[0];
  assert.equal(wild.shown(id), true);
  const stale = Promise.withResolvers();
  let inspectionSignal;
  state.inspect = (signal) => {
    inspectionSignal = signal;
    return stale.promise;
  };
  const inspection = wild.scan();
  const close = Promise.withResolvers();
  let closeSignal;
  state.close = (signal) => {
    closeSignal = signal;
    return close.promise;
  };
  tick(1000);
  assert.equal(inspectionSignal.aborted, true);
  assert.equal(closeSignal.aborted, false);
  assert.equal(wild.keep(id), false);
  assert.deepEqual(state.prompts, [{ id, service: 'Claude', graceMs: 1000 }, null]);
  stale.resolve(null);
  await inspection;
  for (let i = 0; i < 3; i++) wild.refresh();
  await wild.scan();
  let inspected = 0;
  state.inspect = () => {
    inspected++;
    return { service: 'Gemini', tabId: 'tab-2', token: 'page-2' };
  };
  tick(250);
  assert.equal(inspected, 0);
  assert.equal(closeSignal.aborted, false);
  close.resolve({ closed: true });
  await new Promise(setImmediate);
  assert.equal(state.prompts.length, 2);
  tick(250);
  await Promise.resolve();
  assert.equal(inspected, 1);
  assert.equal(state.prompts.at(-1).service, 'Gemini');
  assert.notEqual(state.prompts.at(-1).id, id);
  tick(1000);
  assert.deepEqual(state.closes, [claude]);
  assert.deepEqual(state.failures, []);
});

test('unconfirmed close receipts and transport failures report only bounded reasons', async (t) => {
  const { state, wild, tick } = fixture(t);
  const results = [
    { closed: false, reason: 'close_control_unavailable' },
    { closed: false, reason: 'https://example.invalid/private' },
    new Error('private transport detail'),
    new DOMException('Action canceled', 'AbortError'),
  ];
  for (const result of results) {
    state.close = () => {
      if (result instanceof Error) throw result;
      return result;
    };
    await wild.scan();
    assert.equal(wild.shown(state.prompts.at(-1).id), true);
    tick(1000);
    await Promise.resolve();
    assert.equal(state.prompts.at(-1), null);
  }
  assert.deepEqual(state.failures, [
    'close_control_unavailable',
    'close_unverified',
    'bridge_error',
  ]);
});

test('revoking permission during close cancels the bridge and suppresses late failure receipts', async (t) => {
  const { state, wild, tick } = fixture(t);
  await wild.scan();
  const { id } = state.prompts[0];
  assert.equal(wild.shown(id), true);
  const close = Promise.withResolvers();
  let closeSignal;
  state.close = (signal) => {
    closeSignal = signal;
    return close.promise;
  };
  tick(1000);
  state.allowed = false;
  wild.refresh();
  assert.equal(closeSignal.aborted, true);
  close.resolve({ closed: false, reason: 'target_changed' });
  await new Promise(setImmediate);
  assert.deepEqual(state.prompts, [{ id, service: 'Claude', graceMs: 1000 }, null]);
  assert.ok(state.reactions.every(({ signal }) => signal.aborted));
  assert.deepEqual(state.failures, []);
});
