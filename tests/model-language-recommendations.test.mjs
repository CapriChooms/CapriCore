// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import languages from '../apps/shared/languages.json' with { type: 'json' };
import benchmark from '../packages/runtime/src/hardware/model-language-benchmark.json' with { type: 'json' };
import corpus from '../tools/benchmarks/model-language-cases.json' with { type: 'json' };
import { MODEL_CHOICES } from '../packages/runtime/src/hardware/model-catalog.mjs';
import { recommendModelsForLanguage } from '../packages/runtime/src/hardware/model-recommendations.mjs';
import { scoreLanguageAnswer } from '../tools/benchmarks/benchmark-model-languages.mjs';

test('scoring accepts native counters and grammar without confusing partial numbers', () => {
  const { en, ja, ko, bn } = corpus.languages;
  assert.ok(scoreLanguageAnswer('Maya has four apples.', en[1]));
  for (const answer of ['14 apples.', '-4 apples.', '4.5 apples.', '0.4 apples.', 'Maya has 4.'])
    assert.equal(scoreLanguageAnswer(answer, en[1]), false);
  assert.equal(scoreLanguageAnswer('Scold', en[0]), false);
  assert.ok(scoreLanguageAnswer('リンゴが4個あります。', ja[1]));
  assert.ok(scoreLanguageAnswer('사과가 4개 있습니다.', ko[1]));
  assert.ok(scoreLanguageAnswer('মায়ার কাছে ৪টি আপেল আছে।', bn[1]));
});

test('each built-in conversation language has real results for all selectable local models', () => {
  const ids = languages.map(({ id }) => id).sort();
  assert.deepEqual(Object.keys(corpus.languages).sort(), ids);
  assert.deepEqual(Object.keys(benchmark.scores).sort(), ids);
  assert.equal(
    benchmark.corpusSha256,
    createHash('sha256').update(JSON.stringify(corpus)).digest('hex'),
  );
  assert.deepEqual(
    benchmark.models.map(({ id, tag }) => [id, tag]),
    MODEL_CHOICES.map(({ id, model }) => [id, model]),
  );
  assert.ok(benchmark.models.every(({ digest }) => /^[a-f0-9]{64}$/.test(digest)));
  for (const id of ids) {
    const cases = corpus.languages[id];
    const scores = benchmark.scores[id];
    assert.equal(cases.length, 2);
    assert.equal(scores.length, benchmark.models.length);
    assert.ok(
      scores.every((score) => Number.isInteger(score) && score >= 0 && score <= cases.length),
    );
    assert.deepEqual(
      new Set(benchmark.recommendations[id] ?? []),
      new Set(
        benchmark.models.filter((_, index) => scores[index] === cases.length).map(({ id }) => id),
      ),
      id,
    );
  }
});

test('language recommendations respect RAM and the largest dedicated card and exclude custom language', () => {
  const capable = { ramBytes: 64 * 2 ** 30, gpus: [{ memoryKind: 'dedicated', vramMiB: 24576 }] };
  const cpu = { ramBytes: capable.ramBytes, gpus: [{ memoryKind: 'shared', vramMiB: 24576 }] };
  const small = { ramBytes: 8 * 2 ** 30, gpus: [] };
  for (const { id } of languages) {
    const ranked = benchmark.recommendations[id] ?? [];
    assert.deepEqual(recommendModelsForLanguage(id, capable), ranked.slice(0, 2));
    assert.deepEqual(
      recommendModelsForLanguage(id, cpu),
      ranked.filter((profile) => ['minimal', 'balanced'].includes(profile)).slice(0, 2),
    );
    assert.deepEqual(
      recommendModelsForLanguage(id, small),
      ranked.filter((profile) => profile === 'minimal'),
    );
  }
  assert.deepEqual(recommendModelsForLanguage('custom', capable), []);
  assert.deepEqual(recommendModelsForLanguage('en', { ramBytes: 1 }), []);
});
