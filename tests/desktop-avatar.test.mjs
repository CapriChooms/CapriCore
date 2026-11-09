import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from '../packages/runtime/src/index.mjs';
import { loadAvatarCatalog, requireCapriAvatar } from '../apps/desktop/avatar-catalog.mjs';
import { AvatarStreamParser, avatarInstructions } from '../apps/desktop/avatar-protocol.mjs';
import { AvatarState } from '../apps/desktop/avatar-state.mjs';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';

const catalog = requireCapriAvatar(root);
const sprites = catalog.publicSprites();
const parent = path.join(root, '.runtime/test-data');
mkdirSync(parent, { recursive: true });
const temporary = () => mkdtempSync(path.join(parent, 'avatar-'));
const packet = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
function stream(chunks) {
  return new Response(chunks.map(packet).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
}
function parse(chunks) {
  const parser = new AvatarStreamParser(sprites);
  const events = chunks.flatMap((chunk) => parser.push(chunk));
  events.push(...parser.finish());
  return {
    events,
    text: events
      .filter((event) => event.type === 'text')
      .map((event) => event.text)
      .join(''),
    choices: events.filter((event) => event.type === 'avatar'),
  };
}
function client(fetchImpl) {
  return new ChatService({
    gatewayUrl: 'http://127.0.0.1:18789',
    agentId: 'capri',
    sessionKey: 'agent:capri:main',
    token: () => 'test',
    persona: () => 'Test Capri',
    store: new TranscriptStore(path.join(temporary(), 'transcript.json')),
    avatarSprites: sprites,
    defaultAvatarId: catalog.defaultId,
    fetchImpl,
  });
}

test('active runtime catalog exposes the approved expressions and poses without disk paths', () => {
  assert.equal(catalog.animated, true);
  for (const id of [
    'neutral',
    'happy',
    'annoyed',
    'attentive',
    'concerned',
    'embarrassed',
    'flirty',
    'smirk',
  ])
    assert.ok(
      sprites.some((sprite) => sprite.id === id),
      id,
    );
  assert.equal(catalog.defaultId, 'neutral');
  assert.deepEqual(catalog.canvas, { width: 1254, height: 1254 });
  for (const sprite of sprites) {
    assert.equal(sprite.file, undefined);
    assert.match(sprite.pose, /^[a-z][a-z0-9_-]{0,39}$/);
    // Expression aliases share the canonical image URL.
    assert.match(sprite.url, /^capri:\/\/desktop\/sprites\/[a-z0-9_-]+\.png$/);
    assert.ok(avatarInstructions(sprites).includes(`${sprite.id}:`));
  }
  // requireCapriAvatar verifies the current reviewed artwork manifests/digests.
});

test('catalog rejects duplicate IDs, unsupported canvases and arbitrary paths', () => {
  const folder = temporary(),
    file = path.join(folder, 'sprite-set.json');
  copyFileSync(catalog.sprites[0].file, path.join(folder, 'neutral.png'));
  const base = {
    schemaVersion: 1,
    canvas: catalog.canvas,
    sprites: [
      { id: 'neutral', pose: 'idle', expression: 'neutral_small_smile', file: 'neutral.png' },
    ],
  };
  for (const alter of [
    (value) => value.sprites.push({ ...value.sprites[0] }),
    (value) => {
      value.canvas.width = 1;
    },
    (value) => {
      value.sprites[0].file = '../neutral.png';
    },
    (value) => {
      value.sprites[0].id = '<script>';
    },
    (value) => {
      value.defaultSprite = 'missing';
    },
    (value) => {
      value.sprites[0].pose = 'x'.repeat(41);
    },
  ]) {
    const value = structuredClone(base);
    alter(value);
    writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadAvatarCatalog(file));
  }
});

test('all expressions survive every possible streaming split and never enter visible text', () => {
  for (const sprite of sprites) {
    const frame = `[avatar:${sprite.pose}/${sprite.expression}]`;
    const canonical = sprites.find(
      (candidate) => candidate.pose === sprite.pose && candidate.expression === sprite.expression,
    );
    for (let cut = 0; cut <= frame.length; cut++) {
      const result = parse([frame.slice(0, cut), frame.slice(cut), '\nHello, Капри ✨']);
      assert.equal(result.text, '\nHello, Капри ✨');
      assert.deepEqual(
        result.choices.map((choice) => choice.avatar.id),
        [canonical.id],
      );
    }
    const result = parse([...`${frame}\nHello`]);
    assert.equal(result.text, '\nHello');
    assert.equal(result.choices[0].avatar.id, canonical.id);
  }
});

test('compact avatar IDs map to the same approved pose/expression across packet boundaries', () => {
  for (const sprite of sprites) {
    const frame = `[avatar:${sprite.id}]`;
    for (let cut = 0; cut <= frame.length; cut++) {
      const result = parse([frame.slice(0, cut), frame.slice(cut), '\nHello.']);
      assert.equal(result.text, '\nHello.');
      assert.equal(result.choices[0].avatar.id, sprite.id);
      assert.equal(result.choices[0].avatar.expression, sprite.expression);
    }
  }
});

test('invented closing avatar markers stay hidden across every streaming boundary', () => {
  for (const frame of [
    '[/avatar:neutral]',
    '[/avatar:neutral;listen]',
    '[/AVATAR:happy]',
    '[/аватар:neutral]',
    '[/avatar]',
    '[/аватар]',
  ]) {
    const raw = `A concise answer.${frame} Done.`;
    for (let cut = 0; cut <= raw.length; cut++) {
      const result = parse([raw.slice(0, cut), raw.slice(cut)]);
      assert.equal(result.text, 'A concise answer. Done.', `${frame}: split ${cut}`);
      assert.deepEqual(result.choices, [], 'A closing marker cannot change the avatar or mic');
    }
    assert.equal(parse([...raw]).text, 'A concise answer. Done.');
  }
  const result = parse(['[/avatar:happy;listen][avatar:neutral]\nHello.']);
  assert.equal(result.text, '\nHello.');
  assert.equal(result.choices.length, 1);
  assert.equal(result.choices[0].avatar.id, 'neutral');
  assert.equal(result.choices[0].followUp, undefined);
  for (const raw of ['A file [/avatars:one].', 'A fraction [a/b].', '[/ordinary] remains.'])
    assert.equal(parse([...raw]).text, raw);
});

test('unknown, malformed and oversized control frames are discarded with bounded buffering', () => {
  for (const frame of [
    '[avatar:idle/unknown]',
    '[avatar:../../happy]',
    '[avatar:<img src=x>]',
    `[avatar:${'x'.repeat(500)}]`,
    '[/avatar:<img src=x>]',
    `[/avatar:${'x'.repeat(500)}]`,
  ]) {
    const result = parse([...frame, '\nOrdinary [brackets] remain.']);
    assert.equal(result.text, '\nOrdinary [brackets] remain.');
    assert.equal(result.choices.length, 0);
  }
  assert.equal(parse(['[avatar:idle/hap']).text, '');
  assert.equal(parse(['[ava']).text, '');
  assert.equal(parse(['[/avatar:neut']).text, '');
  assert.equal(parse(['[/ava']).text, '');
  assert.equal(parse(['An ordinary trailing [']).text, 'An ordinary trailing [');
  assert.equal(parse(['[avatar:idle/happy\nNormal']).text, 'Normal');
  const parser = new AvatarStreamParser(sprites);
  parser.push('[avatar:' + 'x'.repeat(200));
  for (let i = 0; i < 100; i++) {
    parser.push('x'.repeat(200));
    assert.ok(parser.buffer.length < 128);
  }
  assert.equal(parser.push(']\nBack').at(-1).text, '\nBack');
});

test('only the first valid choice changes the expression during a reply', () => {
  const result = parse([
    '[avatar:idle/missing][avatar:idle/smirk]\nHello[avatar:idle/concerned] there.',
  ]);
  assert.equal(result.text, '\nHello there.');
  assert.deepEqual(
    result.choices.map((choice) => choice.avatar.id),
    ['smirk'],
  );
});

test('avatar state commits decoded images only and rejects stale or invented acknowledgements', () => {
  const saved = [];
  const state = new AvatarState(sprites, catalog.defaultId, {
    persist: (value) => saved.push(value),
  });
  const first = state.request('happy');
  assert.equal(state.currentId, 'neutral');
  assert.equal(state.acknowledge({ ...first, id: 'missing' }), false);
  const cancelled = state.invalidatePending();
  assert.equal(state.acknowledge(first), false);
  assert.equal(state.acknowledge(cancelled), true);
  const next = state.request('concerned');
  assert.equal(state.acknowledge(next), true);
  assert.equal(state.currentId, 'concerned');
  assert.deepEqual(saved, [{ schemaVersion: 1, id: 'concerned' }]);
  assert.equal(state.request('remote-url'), null);
  assert.equal(state.request('concerned'), null);
  assert.equal(new AvatarState(sprites, 'neutral', { restoredId: 'happy' }).currentId, 'happy');
  assert.equal(new AvatarState(sprites, 'neutral', { restoredId: 'deleted' }).currentId, 'neutral');
});

test('chat emits the model selection before prose, saves clean text and uses a single inference', async () => {
  let calls = 0;
  const events = [],
    service = client(async (_url, options) => {
      calls++;
      const payload = JSON.parse(options.body);
      assert.match(payload.messages[0].content, /AVATAR CONTROL/);
      assert.equal(payload.messages.length, 2);
      return stream([
        '[ava',
        'tar:idle/',
        'happy]',
        '\nThat is wonderful!',
        '[/',
        'ava',
        'tar:neutral;listen]',
      ]);
    });
  await service.send({ id: randomUUID(), text: 'Good news!' }, (event) =>
    events.push(structuredClone(event)),
  );
  assert.equal(calls, 1);
  assert.equal(events[1].type, 'turn.avatar');
  assert.equal(events[1].source, 'model');
  const message = service.store.snapshot().at(-1);
  assert.equal(message.text, 'That is wonderful!');
  assert.equal(message.avatar.id, 'happy');
  assert.ok(!/\[\/?avatar:/u.test(readFileSync(service.store.file, 'utf8')));
  assert.ok(!/\[\/?avatar:/u.test(JSON.stringify(events)));
  assert.equal(new TranscriptStore(service.store.file).snapshot().at(-1).avatar.id, 'happy');
});

test('missing or invalid model choice has an explicit neutral fallback without text heuristics', async () => {
  for (const text of [
    'Congratulations! I am happy!',
    '[avatar:idle/unknown]\nSorry, that sounds hard.',
  ]) {
    const events = [],
      service = client(async () => stream([text]));
    await service.send({ id: randomUUID(), text: 'Context' }, (event) => events.push(event));
    const choice = events.find((event) => event.type === 'turn.avatar');
    assert.equal(choice.source, 'fallback');
    assert.equal(choice.avatar.id, 'neutral');
    assert.equal(service.store.snapshot().at(-1).status, 'complete');
  }
});

test('cancel suppresses a late model choice even if an upstream stream ignores abort', async () => {
  let release;
  const events = [],
    service = client(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(packet('Starting.')));
              release = () => {
                controller.enqueue(
                  new TextEncoder().encode(
                    packet('[avatar:idle/surprised]Too late.') + 'data: [DONE]\n\n',
                  ),
                );
                controller.close();
              };
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
  const id = randomUUID();
  const pending = service.send({ id, text: 'Wait' }, (event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  service.cancel(id);
  release();
  await pending;
  assert.ok(!events.some((event) => event.type === 'turn.avatar'));
  assert.equal(events.at(-1).type, 'turn.cancelled');
  assert.equal(service.store.snapshot().at(-1).text, 'Starting.');
});
