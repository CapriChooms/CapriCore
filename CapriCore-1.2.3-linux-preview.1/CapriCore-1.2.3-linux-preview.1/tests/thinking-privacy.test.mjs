// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { VisibleAnswerStream } from '../apps/desktop/thinking-mode.mjs';

function visible(chunks) {
  const stream = new VisibleAnswerStream();
  return chunks.map((chunk) => stream.push(chunk)).join('') + stream.push('', true);
}

const nested = [
  '<analysis>HIDDEN_A<think>HIDDEN_B</think>HIDDEN_C</analysis>Public answer.',
  '<think>HIDDEN_A<analysis>HIDDEN_B</analysis>HIDDEN_C</think>Public answer.',
  '<think>HIDDEN_A<think>HIDDEN_B</think>HIDDEN_C</think>Public answer.',
  '<ANALYSIS>HIDDEN_A<ThInK>HIDDEN_B</tHiNk>HIDDEN_C</aNaLySiS>Public answer.',
];

test('nested mixed and repeated private tags never expose a tail after an inner closer', () => {
  for (const text of nested) assert.equal(visible([text]), 'Public answer.');
});

test('every two-chunk boundary and character-sized chunks preserve nested privacy', () => {
  for (const text of nested) {
    for (let split = 0; split <= text.length; split++)
      assert.equal(visible([text.slice(0, split), text.slice(split)]), 'Public answer.');
    assert.equal(visible([...text]), 'Public answer.');
  }
});

test('visible avatar markers and final explanation survive while separate private sections disappear', () => {
  const text =
    '[avatar:neutral]\n' +
    '<analysis>HIDDEN_A<think>HIDDEN_B</think>HIDDEN_C</analysis>' +
    'The checked answer is 42. ' +
    '<think>HIDDEN_D</think>' +
    'Here is the useful equation: x = 42.';
  assert.equal(
    visible([...text]),
    '[avatar:neutral]\nThe checked answer is 42. Here is the useful equation: x = 42.',
  );
});

test('a mismatched closer cannot release its enclosing private scope', () => {
  const recoverable =
    '<analysis>HIDDEN_A<think>HIDDEN_B</analysis>HIDDEN_C</think>' +
    'HIDDEN_D</analysis>Public answer.';
  assert.equal(visible([...recoverable]), 'Public answer.');
  const stillUnclosed = '<analysis>HIDDEN_A<think>HIDDEN_B</analysis>HIDDEN_C</think>HIDDEN_D';
  assert.equal(visible([...stillUnclosed]), '');
  assert.equal(visible(['</think></analysis>Public answer.']), 'Public answer.');
});

test('unfinished nested sections and split closing prefixes remain hidden at EOF', () => {
  for (const suffix of ['', '</thi', '</think>', '</think>HIDDEN_C</ana']) {
    const text = 'Public prefix. <analysis>HIDDEN_A<think>HIDDEN_B' + suffix;
    assert.equal(visible([...text]), 'Public prefix. ');
  }
});

test('the bounded stack supports thirty-two scopes and fails closed on depth overflow', () => {
  const boundary = '<think>'.repeat(32) + 'HIDDEN_A' + '</think>'.repeat(32);
  assert.equal(visible([...boundary, 'Public answer.']), 'Public answer.');
  const overflow = '<think>'.repeat(33) + 'HIDDEN_A' + '</think>'.repeat(33);
  assert.equal(visible(['Public prefix. ', ...overflow, 'HIDDEN_B']), 'Public prefix. ');
  const extreme = '<analysis>'.repeat(1024) + 'HIDDEN_A' + '</analysis>'.repeat(1024);
  assert.equal(visible([extreme, 'HIDDEN_B']), '');
});

test('large private content is discarded across chunk boundaries without damaging the final answer', () => {
  const hidden = 'HIDDEN_PAYLOAD '.repeat(5000);
  assert.equal(
    visible([
      '<analysis>',
      hidden.slice(0, 12345),
      '<think>',
      hidden.slice(12345),
      '</think>',
      'HIDDEN_TAIL',
      '</analysis>',
      'Public answer.',
    ]),
    'Public answer.',
  );
});
