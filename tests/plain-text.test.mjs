import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withoutEmoji,
  EmojiFreeStream,
  plainDialogueText,
  PlainTextStream,
} from '../scripts/plain-text.mjs';
import { ChatService } from '../apps/desktop/chat-service.mjs';
import { VoiceService } from '../apps/desktop/voice-service.mjs';
import { TranscriptStore } from '../apps/desktop/storage.mjs';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from '../packages/runtime/src/index.mjs';

test('emoji sequences are removed without deleting ordinary numbers or punctuation', () => {
  const text =
    'Hello 👋🏽✨! Family 👩‍👩‍👧‍👦, flag 🇬🇧, key 1️⃣. English and русский; 4070, 12 GB, #42 — "okay"...';
  assert.equal(
    withoutEmoji(text),
    'Hello ! Family , flag , key . English and русский; 4070, 12 GB, #42 — "okay"...',
  );
  for (let size = 1; size < 20; size++) {
    const filter = new EmojiFreeStream();
    let actual = '';
    for (let i = 0; i < text.length; i += size) actual += filter.push(text.slice(i, i + size));
    actual += filter.push('', true);
    assert.equal(actual, withoutEmoji(text), `UTF-16 packet size ${size}`);
  }
});

test('accidental emphasis loses delimiters, preserving every word across packet boundaries', () => {
  const raw =
    'That *really* matters. Please **do not** skip * these words *. 👩🏽‍💻 An *unfinished phrase!';
  const expected = 'That really matters. Please do not skip  these words .  An unfinished phrase!';
  assert.equal(plainDialogueText(raw), expected);
  for (let split = 0; split <= raw.length; split++) {
    const stream = new PlainTextStream();
    assert.equal(
      stream.push(raw.slice(0, split)) + stream.push(raw.slice(split)) + stream.push('', true),
      expected,
      `split ${split}`,
    );
  }
});

test('desktop deltas, persisted reply and voice input receive only the clean response', async () => {
  const parent = path.join(root, '.runtime/test-data');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'clean-dialog-'));
  const store = new TranscriptStore(path.join(folder, 'transcript.json'));
  const dialogue = 'Hey, choom. 👩🏽‍💻 You have *all* my attention. **Every** `word` matters. ✨';
  const raw = '[avatar:neutral]\n' + dialogue + ';listen';
  const stream =
    [...raw]
      .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n';
  const service = new ChatService({
    gatewayUrl: 'http://127.0.0.1:18789',
    agentId: 'capri',
    sessionKey: 'agent:capri:main',
    token: () => 'test',
    persona: () => 'Capri',
    avatarSprites: [{ id: 'neutral', pose: 'idle', expression: 'smile', description: 'Relaxed' }],
    store,
    fetchImpl: async () =>
      new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
  });
  const events = [],
    spoken = [];
  let resolveSpeech;
  const speechDone = new Promise((resolve) => {
    resolveSpeech = resolve;
  });
  const voice = new VoiceService({
    url: 'http://127.0.0.1:8101',
    headers: () => ({}),
    emit: (event) => {
      if (event.type === 'voice.generated') resolveSpeech();
    },
    fetchImpl: async (_url, options) => {
      spoken.push(JSON.parse(options.body).text);
      return new Response(Buffer.from(new Float32Array([0.1, -0.1]).buffer), {
        headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': '24000' },
      });
    },
  });
  voice.setReady(true);
  await service.send({ id: randomUUID(), text: 'Hello *there* 👋' }, (event) => {
    events.push(event);
    voice.onChat(event);
  });
  await speechDone;
  assert.equal(events.at(-1).type, 'turn.completed');
  const emitted = events
    .filter((e) => e.type === 'turn.delta')
    .map((e) => e.text)
    .join('');
  assert.equal(emitted.trim(), plainDialogueText(dialogue).trim());
  assert.equal(store.snapshot().at(-1).text, emitted);
  assert.ok(
    events.every((event) => !event.followUp),
    'Misplaced flags never rearm voice capture',
  );
  assert.equal(spoken.join(' '), 'Hey, choom. You have all my attention. Every word matters.');
  assert.equal(store.snapshot()[0].text, 'Hello *there* 👋', 'User input is not modified');
});

test('shipped profile is English and has no signature-emoji instruction', () => {
  for (const file of ['PERSONALITY.md', 'USER.md', 'MEMORY.md']) {
    const text = readFileSync(path.join(root, 'config/workspace', file), 'utf8');
    assert.ok(!/[\u0400-\u04ff]/u.test(text), file);
    assert.equal(text, withoutEmoji(text), file);
  }
  assert.match(
    readFileSync(path.join(root, 'config/workspace/PERSONALITY.md'), 'utf8'),
    /mischief, restless curiosity/,
  );
  assert.match(
    readFileSync(path.join(root, 'config/workspace/PERSONALITY.md'), 'utf8'),
    /conversation language selected by the interface/,
  );
});
