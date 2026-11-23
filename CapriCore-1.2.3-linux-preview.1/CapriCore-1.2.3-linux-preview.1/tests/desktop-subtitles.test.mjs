import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subtitleCues,
  subtitleReadingMs,
  sentenceSubtitleCues,
  locateSubtitleSpeech,
  subtitleSpeechPlan,
} from '../apps/desktop/renderer/subtitles.mjs';

test('long captions preserve all content, including Cyrillic, emoji and unbroken text', () => {
  for (const text of [
    'A quiet moment. ' + 'The city can wait; we have a little time. '.repeat(40),
    'Привет, чум! ✨ ' + 'Побудем рядом. '.repeat(40),
    '😺'.repeat(500),
    'https://example.com/' + 'x'.repeat(1000),
  ]) {
    const cues = subtitleCues(text);
    assert.ok(cues.length > 1);
    assert.equal(cues.join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''));
    for (const cue of cues) {
      assert.ok(Array.from(cue).length <= 126);
      assert.ok(cue.isWellFormed());
    }
  }
});

test('subtitle layout collapses paragraph whitespace without changing the source transcript', () => {
  const text = 'One line.\n\nA second\tline.   Third line.';
  assert.deepEqual(subtitleCues(text), ['One line. A second line. Third line.']);
  assert.equal(text, 'One line.\n\nA second\tline.   Third line.');
  assert.deepEqual(subtitleCues(' \n\t'), []);
  for (const size of [0, 10000, NaN]) assert.throws(() => subtitleCues('Text', size));
});

test('captions allow time to read; a longer passage stays longer with a bounded delay', () => {
  assert.ok(subtitleReadingMs('A short reply.') >= 3600);
  assert.ok(subtitleReadingMs('x'.repeat(126)) > subtitleReadingMs('A short reply.'));
  assert.ok(subtitleReadingMs('x'.repeat(65536)) <= 11000);
});

test('visual width limits short cues without dropping wide glyphs or long words', () => {
  const original = '🦾'.repeat(45) + ' ' + 'W'.repeat(90);
  const cues = subtitleCues(original, 126, (text) => Array.from(text).length <= 15);
  assert.ok(cues.every((cue) => Array.from(cue).length <= 15));
  assert.equal(cues.join('').replace(/\s/gu, ''), original.replace(/\s/gu, ''));
});

test('sentence pages pack whole thoughts and keep an unfinished next sentence off a spoken page', () => {
  const fits = (text) => text.length <= 40;
  assert.deepEqual(
    sentenceSubtitleCues('Hello there. Stay with me. The city can wait until tomorrow.', 40, fits),
    ['Hello there. Stay with me.', 'The city can wait until tomorrow.'],
  );
  assert.deepEqual(sentenceSubtitleCues('Hello there. A thought still arriving', 40, fits, false), [
    'Hello there.',
  ]);
  const long =
    'A complete sentence can be longer than a page and still keep every word in the correct order.';
  const pages = sentenceSubtitleCues(long, 40, fits);
  assert.ok(pages.length > 1);
  assert.equal(pages.join(' '), long);
});

test('speech page changes are scheduled within the actual PCM duration of a long sentence', () => {
  const text =
    'A complete sentence can be longer than a page and still keep every word in the correct order.';
  const cues = sentenceSubtitleCues(text, 40, (value) => value.length <= 40);
  const range = locateSubtitleSpeech(text, text);
  const steps = subtitleSpeechPlan(text, cues, { ...range, durationMs: 6000 });
  assert.equal(steps[0].atMs, 0);
  assert.equal(steps[0].index, 0);
  assert.equal(steps.length, cues.length);
  assert.ok(steps.slice(1).every((step, i) => step.atMs > steps[i].atMs && step.atMs < 6000));
  const later = subtitleSpeechPlan(text, cues, { ...range, durationMs: 12000 });
  assert.equal(later[1].atMs, steps[1].atMs * 2);
});

test('repeated spoken sentences resolve forward and resume on their own page', () => {
  const sentence = 'Stay right here with me.',
    text = sentence + ' ' + sentence;
  const cues = sentenceSubtitleCues(text, 30, (value) => value.length <= 30);
  const first = locateSubtitleSpeech(text, sentence),
    second = locateSubtitleSpeech(text, sentence, first.end);
  assert.ok(second.start > first.start);
  assert.deepEqual(subtitleSpeechPlan(text, cues, { ...first, durationMs: 2000 }), [
    { index: 0, atMs: 0 },
  ]);
  assert.deepEqual(subtitleSpeechPlan(text, cues, { ...second, durationMs: 2000 }), [
    { index: 1, atMs: 0 },
  ]);
});
