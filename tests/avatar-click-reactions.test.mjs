// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import languages from '../apps/shared/languages.json' with { type: 'json' };
import {
  AvatarClickReactions,
  avatarClickCue,
  avatarClickGenerator,
} from '../apps/desktop/avatar-click-reactions.mjs';
import { spritePressKind } from '../apps/desktop/geometry.mjs';
import {
  avatarBodyPartAt,
  avatarSeatHinge,
  avatarSeatSwing,
} from '../apps/desktop/avatar-body-regions.mjs';

test('loaded voice cues cover all speech languages and respond to mood without using the model', () => {
  for (const { id } of languages.filter(({ speech }) => speech)) {
    const tones = ['affectionate', 'curious', 'neutral', 'boundary'];
    assert.equal(new Set(tones.map((tone) => avatarClickCue(tone, 'happy', id))).size, 4);
    assert.ok(tones.every((tone) => avatarClickCue(tone, 'happy', id)));
    assert.notEqual(
      avatarClickCue('affectionate', 'happy', id),
      avatarClickCue('affectionate', 'annoyed', id),
    );
  }
  assert.equal(avatarClickCue('boundary', 'happy', 'off'), '');
});

test('body hits follow the actual sprite coordinates across scale, crop and seated poses', () => {
  const opaque = { alpha: new Uint8Array([255]), imageSize: { width: 1, height: 1 } };
  const full = { x: 10, y: 20, width: 300, height: 300 };
  const samples = [
    [0.52, 0.25, 'head'],
    [0.25, 0.27, 'hair'],
    [0.51, 0.43, 'torso'],
    [0.422, 0.55, 'right-arm'],
    [0.584, 0.55, 'left-arm'],
    [0.414, 0.63, 'right-hand'],
    [0.6, 0.63, 'left-hand'],
    [0.47, 0.72, 'right-leg'],
    [0.58, 0.72, 'left-leg'],
    [0.49, 0.89, 'right-foot'],
    [0.64, 0.89, 'left-foot'],
  ];
  for (const [u, v, part] of samples) {
    const point = { x: full.x + u * full.width, y: full.y + v * full.height };
    assert.equal(spritePressKind(point, full, opaque), part);
  }
  const cropped = {
    x: 20,
    y: 30,
    width: 160,
    height: 150,
    source: { x: 0.4, y: 0.5, width: 0.4, height: 0.4 },
  };
  assert.equal(spritePressKind({ x: 48, y: 112.5 }, cropped, opaque), 'right-leg');
  const seated = { dock: 'seat', reducedMotion: true };
  assert.equal(spritePressKind({ x: 166, y: 146 }, full, opaque, true, seated), 'head');
  assert.equal(spritePressKind({ x: 136, y: 211 }, full, opaque, true, seated), 'right-hand');
  assert.equal(spritePressKind({ x: 210, y: 211 }, full, opaque, true, seated), 'left-hand');
  assert.equal(spritePressKind({ x: 166, y: 153.5 }, full, opaque, false), 'body');
  assert.equal(spritePressKind({ x: 166, y: 153.5 }, full, { ...opaque, alpha: [0] }), null);
});

test('seated lower-leg picking follows the animated pixels and the reduced-motion pose', () => {
  const now = 2400;
  const x = 0.63;
  const y = 0.93;
  const opaque = (u, v) => Math.hypot(u - x, v - y) <= 0.002;
  const angle = (avatarSeatSwing(now) * Math.PI) / 180;
  const [pivotX, pivotY] = avatarSeatHinge;
  const dx = x - pivotX;
  const dy = y - pivotY;
  const swungX = pivotX + dx * Math.cos(angle) - dy * Math.sin(angle);
  const swungY = pivotY + dx * Math.sin(angle) + dy * Math.cos(angle);
  const seated = { dock: 'seat', now };
  assert.equal(avatarBodyPartAt(swungX, swungY, opaque, seated), 'left-foot');
  assert.equal(avatarBodyPartAt(x, y, opaque, seated), null);
  assert.equal(avatarBodyPartAt(x, y, opaque, { ...seated, reducedMotion: true }), 'left-foot');
  assert.equal(avatarBodyPartAt(swungX, swungY, opaque, { ...seated, reducedMotion: true }), null);
});

test('grip poses pick exposed hands, separate body zones and moving feet after reflection', () => {
  const size = 1254;
  // Small synthetic source mask around the original face, where the clip and alpha must agree.
  const opaque = (u, v) => Math.hypot((u - 0.52) * 4, (v - 0.29) * 5) < 0.55;
  const pick = (dock, x, y, reducedMotion = true) =>
    avatarBodyPartAt(x / size, y / size, opaque, { dock, reducedMotion, now: 750 });
  for (const [x, y, part] of [
    [196, 416, 'right-hand'],
    [630, 375, 'head'],
    [559, 584, 'chest'],
    [575, 710, 'pelvis'],
    [340, 1038, 'right-foot'],
    [380, 260, null],
  ]) {
    assert.equal(pick('dock-left', x, y), part);
    assert.equal(pick('dock-right', size - x, y), part);
  }
  assert.equal(pick('ceiling', 443, 151), 'right-hand');
  assert.equal(pick('ceiling', 821, 152), 'left-hand');
  assert.equal(pick('ceiling', 627, 398), 'head');
  assert.equal(pick('ceiling', 627, 746), 'pelvis');
  for (const [dock, x, y, part] of [
    ['dock-left', 420, 960, 'right-foot'],
    ['dock-right', size - 420, 960, 'right-foot'],
    ['ceiling', 746, 1048, 'left-foot'],
  ]) {
    assert.equal(pick(dock, x, y, false), part);
    assert.equal(pick(dock, x, y), null);
  }
});

test('only the tenth consecutive tap on the same area starts one model response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const prompts = [],
    replies = [],
    impacts = [],
    cues = [];
  const reactions = new AvatarClickReactions({
    now: Date.now,
    allowed: () => true,
    mood: () => 'focused',
    generate: async (cue) => {
      prompts.push(cue);
      return 'Got my attention.';
    },
    deliver: (reply) => replies.push(reply),
    onPress: (event) => impacts.push(event),
    speakCue: (tone) => cues.push(tone),
  });
  reactions.press({ part: 'head' });
  t.mock.timers.tick(500);
  assert.deepEqual(cues, ['affectionate']);
  for (let i = 0; i < 9; i++) reactions.press({ part: 'left-foot' });
  assert.deepEqual(prompts, []);
  reactions.press({ part: 'left-foot' });
  reactions.press({ part: 'left-foot' });
  await Promise.resolve();
  assert.deepEqual(prompts, [
    { gesture: 'many', mood: 'reserved', variation: 0, part: 'left-foot' },
  ]);
  assert.deepEqual(impacts.at(-1), { part: 'left-foot', tone: 'curious', count: 11 });
  assert.equal(replies[0].text, 'Got my attention.');
  assert.deepEqual(replies[0].origin, { kind: 'avatar-click' });
  reactions.cancel();
});

test('clicks on a different area and gaps above the configured value reset the sequence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const prompts = [];
  const reactions = new AvatarClickReactions({
    now: Date.now,
    allowed: () => true,
    gapMs: () => 1000,
    mood: () => 'happy',
    generate: async (cue) => prompts.push(cue),
    deliver: () => {},
  });
  for (let i = 0; i < 9; i++) reactions.press({ part: 'chest' });
  t.mock.timers.tick(1001);
  reactions.press({ part: 'chest' });
  assert.deepEqual(prompts, []);
  for (let i = 0; i < 9; i++) reactions.press({ part: 'head' });
  assert.deepEqual(prompts, []);
  t.mock.timers.tick(1000);
  reactions.press({ part: 'head' });
  await Promise.resolve();
  assert.deepEqual(prompts, [{ gesture: 'many', headpat: true, mood: 'welcoming', variation: 0 }]);
  reactions.cancel();
});

test('busy, cancelled and expired click reactions cannot interrupt or emit stale text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let allowed = false;
  const pending = [],
    replies = [];
  const reactions = new AvatarClickReactions({
    now: Date.now,
    allowed: () => allowed,
    mood: () => null,
    generate: (_, { signal }) => {
      const work = Promise.withResolvers();
      pending.push({ ...work, signal });
      return work.promise;
    },
    deliver: (reply) => replies.push(reply),
    cooldownMs: 0,
    timeoutMs: 30,
  });
  const ten = () => {
    for (let i = 0; i < 10; i++) reactions.press({ part: 'left-hand' });
  };
  ten();
  assert.equal(pending.length, 0);
  reactions.cancel();
  allowed = true;
  t.mock.timers.tick(110);
  assert.equal(pending.length, 0);
  ten();
  reactions.cancel();
  assert.ok(pending[0].signal.aborted);
  pending[0].resolve('Late text from cancelled generation.');
  await Promise.resolve();
  assert.deepEqual(replies, []);
  ten();
  t.mock.timers.tick(30);
  assert.ok(pending[1].signal.aborted);
  pending[1].resolve('Late text from expired generation.');
  await Promise.resolve();
  assert.deepEqual(replies, []);
});

test('sleeping taps remain quiet and the tenth mixed-area tap wakes once before a separate reaction deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let sleeping = true;
  const waking = Promise.withResolvers();
  const generating = Promise.withResolvers();
  const wakeSignals = [],
    cues = [],
    impacts = [],
    prompts = [],
    replies = [];
  const reactions = new AvatarClickReactions({
    now: Date.now,
    sleeping: () => sleeping,
    wakeAllowed: () => true,
    allowed: () => !sleeping,
    mood: () => 'happy',
    wake: ({ signal }) => {
      wakeSignals.push(signal);
      return waking.promise.then(() => {
        sleeping = false;
      });
    },
    generate: (cue, { signal }) => {
      prompts.push({ cue, signal });
      return generating.promise;
    },
    onPress: (impact) => impacts.push(impact),
    speakCue: (...args) => cues.push(args),
    deliver: (reply) => replies.push(reply),
    wakeTimeoutMs: 1000,
    timeoutMs: 20,
  });
  const parts = ['head', 'left-hand', 'right-foot'];
  for (let i = 0; i < 9; i++) reactions.press({ part: parts[i % parts.length] });
  t.mock.timers.tick(500);
  assert.deepEqual(wakeSignals, []);
  assert.deepEqual(impacts, []);
  assert.deepEqual(cues, []);
  reactions.press({ part: 'head' });
  assert.equal(wakeSignals.length, 1);
  for (let i = 0; i < 30; i++) reactions.press({ part: parts[i % parts.length] });
  t.mock.timers.tick(100);
  assert.equal(wakeSignals.length, 1, 'Extra taps cannot start another cold model load');
  assert.equal(wakeSignals[0].aborted, false, 'Cold wake does not spend the reaction deadline');
  assert.deepEqual(prompts, []);
  assert.deepEqual(impacts, []);
  assert.deepEqual(cues, []);
  waking.resolve();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].cue, {
    gesture: 'many',
    mood: 'reserved',
    variation: 0,
    awakened: true,
  });
  assert.ok(impacts.some((impact) => impact.tone === 'boundary'));
  generating.resolve('Hey, I was sleeping. Let me rest.');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, 'Hey, I was sleeping. Let me rest.');
  assert.deepEqual(replies[0].origin, { kind: 'avatar-click', awakened: true });
  reactions.cancel();
});

test('sleeping click sequences respect the configured gap and cannot wake through a foreground task', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let busy = true;
  let wakes = 0;
  const waking = Promise.withResolvers();
  const reactions = new AvatarClickReactions({
    now: Date.now,
    gapMs: () => 1000,
    sleeping: () => true,
    wakeAllowed: () => !busy,
    allowed: () => false,
    mood: () => 'happy',
    wake: () => {
      wakes++;
      return waking.promise;
    },
    generate: () => assert.fail('A foreground task prevents a sleeping reaction'),
    onPress: () => assert.fail('Sleeping taps cannot show ordinary click effects'),
    speakCue: () => assert.fail('Sleeping taps cannot play ordinary voice cues'),
    deliver: () => assert.fail('No reply can precede a successful wake'),
  });
  for (let i = 0; i < 10; i++) reactions.press({ part: 'head' });
  assert.equal(wakes, 0);
  reactions.cancel();
  busy = false;
  for (let i = 0; i < 9; i++) reactions.press({ part: 'left-hand' });
  t.mock.timers.tick(1001);
  reactions.press({ part: 'right-foot' });
  assert.equal(wakes, 0, 'A pause longer than the configured gap restarts the sleeping sequence');
  for (let i = 0; i < 9; i++) reactions.press({ part: i % 2 ? 'head' : 'left-hand' });
  assert.equal(wakes, 1);
  reactions.cancel();
  waking.resolve();
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

test('entering sleep suppresses an already queued voice cue and a late generated reply even when general availability stays true', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let sleeping = false;
  const cues = [],
    replies = [];
  const generating = Promise.withResolvers();
  const reactions = new AvatarClickReactions({
    now: Date.now,
    sleeping: () => sleeping,
    allowed: () => true,
    mood: () => 'happy',
    generate: () => generating.promise,
    speakCue: (...args) => cues.push(args),
    deliver: (reply) => replies.push(reply),
  });
  reactions.press({ part: 'head' });
  sleeping = true;
  t.mock.timers.tick(500);
  assert.deepEqual(cues, [], 'An awake tap cannot speak its delayed cue after sleep begins');
  reactions.cancel();
  sleeping = false;
  for (let i = 0; i < 10; i++) reactions.press({ part: 'left-hand' });
  assert.ok(reactions.active, 'The awake reaction has begun generating');
  sleeping = true;
  generating.resolve('This response was prepared before I went to sleep.');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(replies, [], 'A reaction cannot arrive after Capri returns to sleep');
  reactions.cancel();
});

test('cancelled, failed, timed-out and foreground-superseded wakes never deliver a stale complaint', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const outcome of ['cancel', 'error', 'wake-timeout', 'generation-timeout', 'busy']) {
    let sleeping = true;
    let busy = false;
    let wakeSignal;
    let generationSignal;
    const waking = Promise.withResolvers();
    const generating = Promise.withResolvers();
    const replies = [];
    const reactions = new AvatarClickReactions({
      now: Date.now,
      sleeping: () => sleeping,
      wakeAllowed: () => !busy,
      allowed: () => !sleeping && !busy,
      mood: () => 'neutral',
      wake: ({ signal }) => {
        wakeSignal = signal;
        return waking.promise.then(() => {
          sleeping = false;
        });
      },
      generate: (_, { signal }) => {
        generationSignal = signal;
        return generating.promise;
      },
      deliver: (reply) => replies.push(reply),
      timeoutMs: 20,
      wakeTimeoutMs: 100,
    });
    for (let i = 0; i < 10; i++) reactions.press({ part: 'head' });
    assert.ok(wakeSignal, outcome);
    if (outcome === 'cancel') reactions.cancel();
    else if (outcome === 'wake-timeout') t.mock.timers.tick(100);
    else if (outcome === 'error') waking.reject(new Error('Fixture model could not start'));
    else if (outcome === 'busy') busy = true;
    if (outcome !== 'error') waking.resolve();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    if (outcome === 'generation-timeout') {
      assert.ok(generationSignal);
      t.mock.timers.tick(20);
      assert.equal(generationSignal.aborted, true);
    } else assert.equal(generationSignal, undefined, outcome);
    if (['cancel', 'wake-timeout'].includes(outcome)) assert.equal(wakeSignal.aborted, true);
    generating.resolve('This obsolete complaint must never appear.');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(replies, [], outcome);
    reactions.cancel();
  }
});

test('mixed sleeping taps preserve a queued wake across a briefly busy host', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let sleeping = true;
  let available = false;
  let wakes = 0;
  const replies = [];
  const reactions = new AvatarClickReactions({
    now: Date.now,
    sleeping: () => sleeping,
    wakeAllowed: () => available,
    allowed: () => !sleeping,
    mood: () => 'happy',
    wake: async () => {
      wakes++;
      sleeping = false;
    },
    generate: async () => 'Hey! I was sleeping.',
    deliver: (value) => replies.push(value),
  });
  for (let i = 0; i < 10; i++) reactions.press({ part: 'head' });
  reactions.press({ part: 'left-hand' });
  assert.equal(wakes, 0);
  available = true;
  t.mock.timers.tick(100);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(wakes, 1);
  assert.equal(replies.length, 1);
  reactions.cancel();
});

test('reaction inference sends only a bounded, tool-free click cue and safe output', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  let message = { content: '**Эй, полегче.**' };
  const generate = avatarClickGenerator({
    url: 'http://127.0.0.1:11434',
    model: 'fixture',
    params: { num_ctx: 4096, num_predict: 999 },
    languages: () => ({ conversation: 'ru' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return Response.json({ message });
    },
  });
  const cue = { gesture: 'many', mood: 'reserved', variation: 2 };
  assert.equal(await generate(cue, { signal }), 'Эй, полегче.');
  const [{ url, options, body }] = calls;
  assert.equal(url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(options.signal, signal);
  assert.equal(options.redirect, 'error');
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.options.num_predict, 72);
  assert.equal(body.options.num_ctx, 4096);
  assert.equal(body.shift, false);
  assert.equal(body.truncate, false);
  assert.equal(body.keep_alive, -1);
  assert.deepEqual(body.tools, []);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[0].content, /would like some space/);
  assert.match(body.messages[0].content, /на русском языке/);
  assert.match(body.messages[1].content, /many times/);
  assert.equal(await generate({ ...cue, part: 'left-arm' }, { signal }), 'Эй, полегче.');
  assert.equal(
    calls.at(-1).body.messages[1].content,
    'The user tapped your left arm many times in rapid succession.',
  );

  assert.equal(await generate({ ...cue, headpat: true }, { signal }), 'Эй, полегче.');
  assert.equal(
    calls.at(-1).body.messages[1].content,
    'The user patted your head many times in rapid succession.',
  );

  assert.equal(
    await generate({ ...cue, headpat: true, awakened: true }, { signal }),
    'Эй, полегче.',
  );
  const awakened = calls.at(-1).body;
  assert.deepEqual(awakened.tools, []);
  assert.equal(awakened.messages.length, 2, 'A wake reaction never receives conversation history');
  assert.match(awakened.messages[0].content, /sleep|asleep/iu);
  assert.match(awakened.messages[0].content, /annoy|irritat|grump/iu);
  assert.doesNotMatch(awakened.messages[0].content, /Favor an affectionate or playful response/iu);
  assert.match(awakened.messages[1].content, /wok|wak|awaken/iu);
  assert.match(awakened.messages[1].content, /tap|click/iu);

  message = { content: 'Hi', tool_calls: [{ function: { name: 'anything' } }] };
  assert.equal(await generate(cue, { signal }), '');
  message = { content: '[avatar:idle] Hi' };
  assert.equal(await generate(cue, { signal }), '');
  message = { content: '<think>private reasoning</think>Hi' };
  assert.equal(await generate(cue, { signal }), '');
  message = { content: 'x'.repeat(20000) };
  assert.equal(await generate(cue, { signal }), '');
  assert.throws(() => avatarClickGenerator({ url: 'https://example.com' }), /loopback/);
});
