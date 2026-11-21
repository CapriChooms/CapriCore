// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import languages from '../apps/shared/languages.json' with { type: 'json' };
import benchmark from '../packages/runtime/src/hardware/model-language-benchmark.json' with { type: 'json' };
import corpus from '../tools/benchmarks/model-language-cases.json' with { type: 'json' };
import { MODEL_CHOICES } from '../packages/runtime/src/hardware/model-catalog.mjs';
import { recommendModelsForLanguage } from '../packages/runtime/src/hardware/model-recommendations.mjs';
import {
  benchmarkSummary,
  scoreLanguageAnswer,
} from '../tools/benchmarks/benchmark-model-languages.mjs';

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

test('each built-in conversation language has measured results or a measured base language', () => {
  const ids = languages
    .filter(({ id, modelLanguage }) => {
      if (Object.hasOwn(corpus.languages, id) || !modelLanguage) return true;
      assert.ok(Object.hasOwn(corpus.languages, modelLanguage));
      assert.ok(Object.hasOwn(benchmark.scores, modelLanguage));
      return false;
    })
    .map(({ id }) => id)
    .sort();
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

test('catalog generation accepts a measured base language and omits unmeasured variants', () => {
  const results = {
    ...benchmark,
    models: Object.fromEntries(
      benchmark.models.map((model, index) => [
        model.id,
        {
          ...model,
          bytes: index,
          languages: Object.fromEntries(
            Object.entries(corpus.languages).map(([id, cases]) => [
              id,
              Object.fromEntries(
                cases.map((sample, caseIndex) => [
                  sample.id,
                  { passed: caseIndex < benchmark.scores[id][index] },
                ]),
              ),
            ]),
          ),
        },
      ]),
    ),
  };
  const generated = benchmarkSummary(corpus, results);
  assert.deepEqual(generated.scores, benchmark.scores);
  assert.equal(Object.hasOwn(generated.scores, 'pt-BR'), false);
  assert.equal(Object.hasOwn(generated.recommendations, 'pt-BR'), false);
  assert.deepEqual(new Set(generated.recommendations.pt), new Set(benchmark.recommendations.pt));
});

test('language recommendations respect RAM and the largest dedicated card and exclude custom language', () => {
  const capable = { ramBytes: 64 * 2 ** 30, gpus: [{ memoryKind: 'dedicated', vramMiB: 24576 }] };
  const cpu = { ramBytes: capable.ramBytes, gpus: [{ memoryKind: 'shared', vramMiB: 24576 }] };
  const small = { ramBytes: 8 * 2 ** 30, gpus: [] };
  for (const { id, modelLanguage } of languages) {
    const measured = Object.hasOwn(benchmark.scores, id) ? id : modelLanguage;
    const ranked = benchmark.recommendations[measured] ?? [];
    const options = { baseLanguage: modelLanguage };
    assert.deepEqual(recommendModelsForLanguage(id, capable, options), ranked.slice(0, 2));
    assert.deepEqual(
      recommendModelsForLanguage(id, cpu, options),
      ranked.filter((profile) => ['minimal', 'balanced'].includes(profile)).slice(0, 2),
    );
    assert.deepEqual(
      recommendModelsForLanguage(id, small, options),
      ranked.filter((profile) => profile === 'minimal'),
    );
  }
  assert.deepEqual(recommendModelsForLanguage('custom', capable), []);
  assert.deepEqual(recommendModelsForLanguage('en', { ramBytes: 1 }), []);
  assert.deepEqual(
    recommendModelsForLanguage('pt-BR', capable, { baseLanguage: 'pt' }),
    recommendModelsForLanguage('pt', capable),
  );
});

test(
  'Windows Setup uses the Portuguese shortlist for pt-BR only while unmeasured',
  { skip: process.platform !== 'win32' },
  () => {
    const script = `
    $ErrorActionPreference='Stop'
    . ./packages/installer/windows/model-language-recommendations.ps1
    function Get-CapriRequiredRam { return 1 }
    function Test-CapriProfileRam { return $true }
    $catalog=Get-Content ./apps/shared/languages.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $benchmark=Get-Content ./packages/runtime/src/hardware/model-language-benchmark.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $profiles=(Get-Content ./config/installer.json -Raw -Encoding UTF8 | ConvertFrom-Json).profiles
    $hardware=@{ramGiB=64;vramGiB=24}
    $base=@(Get-CapriRecommendedLanguageProfiles 'pt' $benchmark $profiles $hardware $null $catalog)
    $variant=@(Get-CapriRecommendedLanguageProfiles 'pt-BR' $benchmark $profiles $hardware $null $catalog)
    if($base.Count -ne 2 -or ($base.id -join ',') -ne ($variant.id -join ',')){throw 'Wrong regional shortlist'}
    $benchmark.scores | Add-Member -NotePropertyName 'pt-BR' -NotePropertyValue @(0,0,0,0,0,0)
    if(@(Get-CapriRecommendedLanguageProfiles 'pt-BR' $benchmark $profiles $hardware $null $catalog).Count){throw 'Measured variant incorrectly inherited base scores'}
  `;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  },
);
