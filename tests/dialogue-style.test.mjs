import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeatedPhrasing, dialogueStyleInstruction } from '../apps/desktop/dialogue-style.mjs';
import { generationParams } from '../packages/runtime/src/index.mjs';

const reply = (text) => ({ role: 'assistant', text, status: 'complete' });
test('style statistics identify repeated openings and recycled sentences across different replies', () => {
  const repeated = 'But that does not mean I will repeat the same joke every time.';
  const messages = [
    reply(`Wait a moment. ${repeated}`),
    reply(`Wait a moment, I understood. ${repeated}`),
  ];
  const result = repeatedPhrasing(messages);
  assert.deepEqual(result.openings, [{ text: 'wait a moment', count: 2 }]);
  assert.equal(result.sentences.length, 1);
  assert.match(dialogueStyleInstruction(messages), /Style observation/);
  assert.ok(!dialogueStyleInstruction(messages).includes('wait a moment'));
});
test('style guidance excludes user messages, unfinished errors, paths and avatar metadata', () => {
  const messages = [
    reply('One specific answer.'),
    { role: 'user', status: 'complete', text: 'private user instructions' },
    { ...reply('private failed response'), status: 'error' },
    { ...reply('private streaming response'), status: 'streaming' },
    reply(
      'Read C:\\Users\\owner\\file.txt before changing any of these settings in this workspace.',
    ),
    reply(
      'Read C:\\Users\\owner\\file.txt before changing any of these settings in this workspace.',
    ),
  ];
  const guidance = dialogueStyleInstruction(messages);
  assert.ok(!guidance.includes('private'));
  assert.ok(!guidance.includes('C:\\Users'));
  assert.equal(repeatedPhrasing(messages).sentences.length, 0);
});
test('bounded recent style guidance does not mutate or replay the transcript', () => {
  const messages = Array.from({ length: 40 }, (_, i) =>
    reply(i < 28 ? 'Outdated stock phrase.' : `Different response ${i}.`),
  );
  const before = structuredClone(messages);
  assert.equal(repeatedPhrasing(messages).replies, 12);
  assert.ok(!dialogueStyleInstruction(messages).includes('outdated'));
  assert.deepEqual(messages, before);
  const huge = Array.from({ length: 30 }, () =>
    reply('An opening repeated. ' + 'word '.repeat(10000)),
  );
  assert.ok(dialogueStyleInstruction(huge).length < 2000);
});
test('generation profile validates sampling without forwarding arbitrary settings', () => {
  assert.deepEqual(generationParams({ temperature: 0.85, repeat_last_n: 512, seed: 417 }), {
    temperature: 0.85,
    repeat_last_n: 512,
  });
  for (const value of [
    null,
    {},
    { temperature: NaN, repeat_last_n: 512 },
    { temperature: 3, repeat_last_n: 512 },
    { temperature: 0.85, repeat_last_n: -1 },
    { temperature: 0.85, repeat_last_n: 512.1 },
  ])
    assert.throws(() => generationParams(value));
});
