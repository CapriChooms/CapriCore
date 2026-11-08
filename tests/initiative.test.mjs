import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIATIVE_DEFAULTS,
  validateInitiative,
  quietHour,
} from '../apps/desktop/initiative-settings.mjs';
import { InitiativePolicy, validateObservation } from '../apps/desktop/initiative-policy.mjs';
import { InitiativeService } from '../apps/desktop/initiative-service.mjs';
import { initiativeGenerator } from '../apps/desktop/initiative-generator.mjs';

const timestamp = 1800000000000;
function fixture() {
  let now = timestamp,
    hour = 14,
    index = 0;
  const settings = { ...INITIATIVE_DEFAULTS, level: 'conversational', appReactions: true };
  return {
    settings,
    policy: new InitiativePolicy({ settings, now: () => now, hour: () => hour }),
    advance: (ms) => {
      now += ms;
    },
    hour: (h) => {
      hour = h;
    },
    event: (kind, extra = {}) => ({
      schemaVersion: 1,
      id: String(++index),
      source: 'windows-events',
      confidence: 1,
      timestamp: now,
      kind,
      ...extra,
    }),
  };
}
test('initiative starts off, validates settings and rejects invented/stale observation sources', () => {
  assert.equal(INITIATIVE_DEFAULTS.level, 'off');
  assert.throws(() => validateInitiative({ ...INITIATIVE_DEFAULTS, quietStart: 25 }));
  for (const value of [
    { source: 'web-page' },
    { timestamp: timestamp - 60000 },
    { kind: 'video-content' },
    { confidence: 0.5 },
  ])
    assert.throws(() =>
      validateObservation(
        {
          schemaVersion: 1,
          id: 'a',
          source: 'windows-events',
          confidence: 1,
          timestamp,
          kind: 'user.return',
          ...value,
        },
        { now: timestamp },
      ),
    );
  assert.equal(quietHour(INITIATIVE_DEFAULTS, 0), true);
  assert.equal(quietHour(INITIATIVE_DEFAULTS, 14), false);
  assert.equal(quietHour({ ...INITIATIVE_DEFAULTS, quietStart: 9, quietEnd: 9 }, 12), false);
});
test('foreground, lock, fullscreen, exclusions, user speech and quiet hours suppress comments', () => {
  const f = fixture(),
    p = f.policy;
  let candidate = p.observe(f.event('user.return'));
  assert.equal(p.permitted(candidate), true);
  for (const key of ['busy', 'speaking', 'userSpeech', 'typing', 'quiet', 'offline', 'hidden'])
    assert.equal(p.permitted(candidate, { [key]: true }), false, key);
  f.hour(23);
  assert.equal(p.permitted(candidate), false);
  f.hour(14);
  p.observe(f.event('session.lock'));
  assert.equal(p.permitted(candidate), false);
  p.observe(f.event('session.unlock'));
  p.observe(f.event('app.foreground', { processName: 'game', processId: 1, fullscreen: true }));
  assert.equal(p.permitted(candidate), false);
  p.observe(f.event('app.foreground', { processName: 'discord', processId: 2, fullscreen: false }));
  assert.equal(p.permitted(candidate), false);
  p.observe(f.event('app.foreground', { processName: 'notepad', processId: 3, fullscreen: false }));
  assert.equal(p.permitted(candidate), true);
  p.observe(f.event('power.suspend'));
  assert.equal(p.permitted(candidate), false);
  p.observe(f.event('power.resume'));
  assert.equal(p.permitted(candidate), true);
});
test('events expire, never queue catch-up comments and cannot cause shutdown generation', () => {
  const f = fixture(),
    p = f.policy;
  const event = f.event('app.foreground', { processName: 'vlc', processId: 1, fullscreen: false }),
    candidate = p.observe(event);
  assert.equal(p.permitted(candidate), true);
  assert.equal(p.observe(event), null);
  p.observe(f.event('app.foreground', { processName: 'notepad', processId: 2, fullscreen: false }));
  assert.equal(p.permitted(candidate), false);
  const next = p.observe(f.event('user.return'));
  f.advance(21000);
  assert.equal(p.permitted(next), false);
  assert.equal(p.observe(f.event('session.ending')), null);
});
test('cooldowns, attempt limits, hourly budget and dismissal are independent of conversation history', () => {
  const f = fixture(),
    p = f.policy;
  const candidate = () => p.observe(f.event('user.return'));
  let c = candidate();
  p.attempted();
  p.spoken(c, 'Back already?');
  assert.equal(p.permitted(candidate()), false);
  f.advance(120001);
  c = candidate();
  assert.equal(p.permitted(c), true);
  p.dismiss('return');
  assert.equal(p.permitted(c), false);
  assert.deepEqual(p.recentText, ['Back already?']);
  p.restore();
  assert.equal(p.permitted(c), true);
  p.recent = Array(30).fill(timestamp);
  assert.equal(p.permitted(c), false);
  f.advance(3600001);
  assert.equal(p.permitted(candidate()), true);
});

test('initiative frequency and dismissals survive a restart without retaining raw observed events', () => {
  const f = fixture(),
    c = f.policy.observe(f.event('user.return'));
  f.policy.attempted();
  f.policy.spoken(c, 'Back already.');
  f.policy.dismiss('return');
  const budget = f.policy.budget(),
    next = new InitiativePolicy({ settings: f.settings, now: () => timestamp, hour: () => 14 });
  next.restoreBudget(budget);
  assert.equal(next.permitted(next.observe(f.event('user.return'))), false);
  assert.deepEqual(next.recentText, ['Back already.']);
  assert.equal(Object.hasOwn(budget, 'foreground'), false);
});

test('a late optional generation loses to user input and never commits or speaks', async () => {
  const f = fixture();
  let resolve,
    calls = 0;
  const service = new InitiativeService({
    settings: f.settings,
    now: () => timestamp,
    hour: () => 14,
    state: () => ({}),
    generate: () =>
      new Promise((r) => {
        resolve = r;
      }),
    commit: async () => {
      calls++;
    },
    deliver: () => {
      calls++;
    },
  });
  const candidate = service.policy.observe(f.event('user.return'));
  const task = service.run(candidate);
  service.activity();
  resolve({ speak: true, text: 'There you are.' });
  await task;
  assert.equal(calls, 0);
  service.close();
});

test('an unfinished typed draft keeps initiative suppressed after keystroke cooldown', () => {
  const f = fixture(),
    service = new InitiativeService({
      settings: f.settings,
      state: () => ({ typing: true }),
      generate: async () => {},
      commit: async () => {},
      deliver: () => {},
      now: () => timestamp,
      hour: () => 14,
    });
  assert.equal(service.currentState().typing, true);
  assert.equal(
    service.policy.permitted(
      service.policy.observe(f.event('user.return')),
      service.currentState(),
    ),
    false,
  );
  service.close();
});
test('an admitted comment commits once, preserves provenance and cannot repeat itself', async () => {
  const f = fixture();
  let commits = 0,
    delivered;
  const service = new InitiativeService({
    settings: f.settings,
    now: () => timestamp,
    hour: () => 14,
    state: () => ({}),
    generate: async () => ({ speak: true, text: 'There *you* are. ✨' }),
    commit: async () => {
      commits++;
    },
    deliver: (m) => {
      delivered = m;
    },
  });
  await service.run(service.policy.observe(f.event('user.return')));
  assert.equal(commits, 1);
  assert.equal(delivered.text, 'There you are.');
  assert.equal(delivered.origin.source, 'windows-events');
  assert.equal(delivered.role, 'assistant');
  assert.equal(delivered.origin.category, 'return');
  service.close();
});
test('the optional generator reads shared history and exposes no action tools or owner command', async () => {
  let request;
  const avatar = { id: 'neutral', pose: 'standing', expression: 'neutral' };
  const generate = initiativeGenerator({
    ollamaUrl: 'http://127.0.0.1:11434',
    model: 'fixture',
    params: { num_ctx: 16384 },
    sessionKey: 'agent:capri:main',
    rpc: {
      call: async (method, params) => {
        assert.equal(method, 'chat.history');
        assert.equal(params.sessionKey, 'agent:capri:main');
        return {
          messages: [
            { role: 'user', content: 'My favourite colour is teal.' },
            { role: 'assistant', content: [{ type: 'text', text: 'I remember.' }] },
          ],
        };
      },
    },
    persona: () => "Capri's persona",
    avatars: [avatar],
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({ speak: true, text: 'Back in the glow.', avatar: 'neutral' }),
          },
        }),
      );
    },
  });
  const f = fixture(),
    result = await generate(f.policy.observe(f.event('user.return')), {
      signal: new AbortController().signal,
      recent: [],
    });
  assert.deepEqual(request.tools, []);
  assert.equal(request.think, false);
  assert.match(request.messages[1].content, /teal/);
  assert.match(request.messages.at(-1).content, /not an owner request/);
  assert.equal(result.avatar.id, 'neutral');
});
