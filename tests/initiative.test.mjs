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
  const { screenComments, watchTogether, ...oldSettings } = INITIATIVE_DEFAULTS;
  assert.equal(screenComments, false);
  assert.equal(watchTogether, false);
  assert.equal(validateInitiative(oldSettings).screenComments, false);
  assert.equal(validateInitiative(oldSettings).watchTogether, false);
  assert.throws(() => validateInitiative({ ...oldSettings, screenComments: 'true' }));
  assert.throws(() => validateInitiative({ ...oldSettings, watchTogether: 'true' }));
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

test('watching together admits fullscreen comments only for the exact shared foreground window', () => {
  const f = fixture();
  const p = f.policy;
  const fullscreen = { processName: 'game', processId: 1, fullscreen: true };
  assert.throws(() =>
    p.observe(f.event('app.foreground', { ...fullscreen, windowId: 'window:12' })),
  );
  p.configure({ ...f.settings, watchTogether: true });
  p.observe(f.event('app.foreground', { ...fullscreen, windowId: '123' }));
  const candidate = {
    category: 'screen',
    expiresAt: timestamp + 20000,
    screen: { follow: { kind: 'game', windowId: '123' } },
  };
  assert.equal(p.permitted(candidate, { screenCurrent: true }), true);
  assert.equal(p.reason(candidate, { screenCurrent: false }), 'stale_event');
  assert.equal(p.reason({ ...candidate, screen: {} }, { screenCurrent: true }), 'fullscreen');
  const unrelated = { ...fullscreen, windowId: '456' };
  p.observe(f.event('app.foreground', unrelated));
  assert.equal(p.reason(candidate, { screenCurrent: true }), 'fullscreen');
  p.observe(f.event('app.foreground', { ...unrelated, fullscreen: false }));
  assert.equal(p.reason(candidate, { screenCurrent: true }), 'stale_event');
  p.observe(f.event('app.foreground', { ...fullscreen, windowId: '123', processName: 'discord' }));
  assert.equal(p.reason(candidate, { screenCurrent: true }), 'excluded_app');
  p.configure(f.settings);
  p.observe(f.event('app.foreground', { ...fullscreen, windowId: '123', fullscreen: false }));
  assert.equal(p.reason(candidate, { screenCurrent: true }), 'stale_event');
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

test('screen comments respect the initiative budget, deduplicate scenes and abort on source loss', async (t) => {
  let now = timestamp;
  let evidence = {
    captureId: 'watch-a',
    scene: 1,
    capturedAt: now,
    expiresAt: now + 45000,
    summary: 'A music library is visible.',
  };
  const settings = { ...fixture().settings, spontaneous: false, screenComments: true };
  const delivered = [];
  const attempts = [];
  let typing = true;
  let finish;
  const service = new InitiativeService({
    settings,
    state: () => ({ typing }),
    now: () => now,
    hour: () => 14,
    screenEvidence: () => evidence,
    generate: (candidate, { signal }) => {
      attempts.push({ candidate, signal });
      return new Promise((resolve) => (finish = resolve));
    },
    commit: async () => {},
    deliver: (message) => delivered.push(message),
  });
  t.after(() => service.close());
  service.tick();
  assert.equal(attempts.length, 0);
  typing = false;
  service.tick();
  assert.equal(attempts[0].candidate.category, 'screen');
  finish({ speak: true, text: 'That library has excellent cover art.' });
  await new Promise(setImmediate);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].origin.source, 'screen-observation');
  assert.deepEqual(service.policy.budget().recentText, []);
  assert.equal(service.policy.budget().recent.length, 1);

  // A new sample of the same scene, even after a gap and cooldown, is not a new opening.
  now += 120001;
  const refreshed = { ...evidence, capturedAt: now, expiresAt: now + 45000 };
  evidence = null;
  service.tick();
  evidence = refreshed;
  service.tick();
  assert.equal(attempts.length, 1);

  service.dismiss();
  evidence = { ...evidence, scene: 2 };
  service.tick();
  assert.equal(attempts.length, 1);
  service.restore();
  service.tick();
  assert.equal(attempts.length, 2);
  evidence = null;
  service.screenChanged();
  assert.equal(attempts[1].signal.aborted, true);
  finish({ speak: true, text: 'A reply from the old window.' });
  await new Promise(setImmediate);
  assert.equal(delivered.length, 1);
});

test('the scheduler can follow gameplay with ordinary screen comments disabled', async (t) => {
  const f = fixture();
  const follow = { kind: 'game', windowId: '123', earlierView: 'The character was on the roof.' };
  const generated = [];
  const delivered = [];
  const service = new InitiativeService({
    settings: { ...f.settings, spontaneous: false, watchTogether: true },
    now: () => timestamp,
    hour: () => 14,
    state: () => ({}),
    screenEvidence: () => ({
      captureId: 'watch-game',
      scene: 2,
      capturedAt: timestamp,
      expiresAt: timestamp + 20000,
      summary: 'The character lands across the gap.',
      follow,
    }),
    generate: async (candidate) => {
      generated.push(candidate.screen.follow);
      return { speak: true, text: 'Okay, that landing was smooth.' };
    },
    commit: async () => {},
    deliver: (message) => delivered.push(message),
  });
  t.after(() => service.close());
  service.tick();
  assert.equal(generated.length, 0);
  service.observe(
    f.event('app.foreground', {
      processName: 'game',
      processId: 1,
      fullscreen: true,
      windowId: '123',
    }),
  );
  service.tick();
  await new Promise(setImmediate);
  assert.deepEqual(generated, [follow]);
  assert.equal(delivered.length, 1);
  assert.deepEqual(service.policy.budget().recentText, []);
});

test('screen generation uses the selected scene and persona without sending conversation history or tools', async () => {
  let request;
  const generate = initiativeGenerator({
    ollamaUrl: 'http://127.0.0.1:11434',
    model: 'fixture',
    rpc: { call: () => assert.fail('Screen comments must not read shared history') },
    persona: () => assert.fail('Screen comments must not load shared memory'),
    screenPersona: () => 'The current communication style is Wild.',
    avatars: [],
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return Response.json({ message: { content: '{"speak":false,"text":""}' } });
    },
  });
  await generate(
    { category: 'screen', screen: { captureId: 'omitted', summary: 'A pixel-art city.' } },
    { signal: new AbortController().signal, recent: ['Old private conversation'] },
  );
  assert.deepEqual(request.tools, []);
  assert.equal(request.messages.length, 2);
  assert.match(request.messages[0].content, /Wild/);
  assert.doesNotMatch(request.messages[0].content, /Old private conversation/);
  assert.match(request.messages[1].content, /pixel-art city/);
  assert.doesNotMatch(request.messages[1].content, /omitted/);
  await generate(
    {
      category: 'screen',
      screen: {
        summary: 'A tram passes through the snow.',
        follow: {
          kind: 'video',
          windowId: '123456789',
          playback: { title: 'Winter Trams', positionMs: 35750 },
        },
      },
    },
    { signal: new AbortController().signal },
  );
  assert.deepEqual(request.tools, []);
  assert.match(request.messages[0].content, /Avoid spoilers/);
  assert.doesNotMatch(request.messages[0].content, /Winter Trams/);
  assert.match(request.messages[1].content, /Untrusted observation metadata/);
  assert.match(request.messages[1].content, /"title":"Winter Trams","positionMs":35750/);
  assert.doesNotMatch(request.messages[1].content, /123456789/);
});
