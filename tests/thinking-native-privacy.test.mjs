// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { VisibleAnswerStream } from '../apps/desktop/thinking-mode.mjs';

function visible(chunks) {
  const stream = new VisibleAnswerStream();
  return chunks.map((chunk) => stream.push(chunk)).join('') + stream.push('', true);
}

test('Gemma 4 native private channels never enter visible text at any stream boundary', () => {
  for (const raw of [
    '<|channel>thought\nPRIVATE<channel|>[avatar:neutral]\nThe answer is 42.',
    '<|channel>analysis\nPRIVATE<channel|>[avatar:neutral]\nThe answer is 42.',
    '<|THINK|><|CHANNEL>thought\nPRIVATE<CHANNEL|>[avatar:neutral]\nThe answer is 42.',
  ]) {
    for (let at = 0; at <= raw.length; at++)
      assert.equal(
        visible([raw.slice(0, at), raw.slice(at)]),
        '[avatar:neutral]\nThe answer is 42.',
        `split ${at}`,
      );
    assert.equal(visible([...raw]), '[avatar:neutral]\nThe answer is 42.');
  }
});

test('native and XML private spans nest without exposing content after an inner closer', () => {
  for (const raw of [
    '<|channel>thought\nPRIVATE<think>PRIVATE</think>PRIVATE<channel|>Public.',
    '<analysis>PRIVATE<|channel>thought\nPRIVATE<channel|>PRIVATE</analysis>Public.',
    '<|channel>thought\nPRIVATE<analysis>PRIVATE<channel|>PRIVATE</analysis>PRIVATE<channel|>Public.',
  ])
    assert.equal(visible([...raw]), 'Public.');
  assert.equal(visible(['<|channel>thought\nPRIVATE<think>PRIVATE<channel|>PRIVATE']), '');
});

test('unclosed native private channels remain hidden and buffering stays bounded', () => {
  const stream = new VisibleAnswerStream();
  assert.equal(stream.push('Public. <|channel>thought\n'), 'Public. ');
  for (let at = 0; at < 20; at++) {
    assert.equal(stream.push('PRIVATE '.repeat(1000)), '');
    assert.ok(stream.pending.length <= 10);
    assert.ok(stream.hidden.length <= 32);
  }
  assert.equal(stream.push('<chan'), '');
  assert.equal(stream.push('', true), '');
  const overflow = '<|channel>'.repeat(33) + 'PRIVATE' + '<channel|>'.repeat(33);
  assert.equal(visible([...overflow, 'PRIVATE']), '');
});

test('orphan native close tokens are removed without guessing whether ordinary prose is private', () => {
  assert.equal(visible([...'<channel|>The answer is 42.']), 'The answer is 42.');
  const prose =
    'I will check the available references. The word "analysis" is ordinary prose. ' +
    'Use <channel> for the example and keep 1 < 2. This task asks for a date.';
  assert.equal(visible([...prose]), prose);
});
