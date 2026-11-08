// SPDX-License-Identifier: GPL-3.0-only
/** Synthetic, tool-free language coverage. Run against a dedicated Ollama instance. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import languages from '../../apps/shared/languages.json' with { type: 'json' };
import { writeJsonAtomic } from '../../packages/runtime/src/atomic-json.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';
import { MODEL_CHOICES } from '../../packages/runtime/src/hardware/model-catalog.mjs';

const suite = 'capri-dialogue-language-v1';
const options = { temperature: 0, seed: 42, num_ctx: 2048, num_predict: 48 };
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => value.normalize('NFKC').toLowerCase().trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const joinedScript =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Thai}|\p{Script=Lao}|\p{Script=Khmer}|\p{Script=Myanmar}/u;

export function scoreLanguageAnswer(answer, sample) {
  const text = normalize(answer);
  if (!text || (sample.maxWords && text.split(/\s+/u).length > sample.maxWords)) return false;
  return sample.expected.every((group) =>
    group.some((marker) => {
      const needle = normalize(marker);
      if (/^\p{Nd}+$/u.test(needle))
        return new RegExp(`(?<![\\p{N}+-])(?<!\\p{N}[.,])${needle}(?!\\p{N}|[.,]\\p{N})`, 'u').test(
          text,
        );
      if (joinedScript.test(needle)) return text.includes(needle);
      return new RegExp(
        `(?<![\\p{L}\\p{M}\\p{N}])${escape(needle)}(?![\\p{L}\\p{M}\\p{N}])`,
        'u',
      ).test(text);
    }),
  );
}

export function benchmarkSummary(corpus, results) {
  const models = MODEL_CHOICES.map(({ id, model }) => {
    const tested = results.models[id];
    assert.equal(tested?.tag, model, 'Missing benchmark model ' + id);
    assert.match(tested.digest, /^[a-f0-9]{64}$/i);
    assert.equal(typeof tested.quantization, 'string');
    return { id, tag: model, digest: tested.digest, quantization: tested.quantization };
  });
  const scores = {};
  for (const { id } of languages) {
    const cases = corpus.languages[id];
    assert.ok(cases?.length >= 2, 'Missing language cases: ' + id);
    scores[id] = models.map((model) =>
      cases.reduce((count, sample) => {
        const record = results.models[model.id].languages[id]?.[sample.id];
        assert.equal(
          typeof record?.passed,
          'boolean',
          'Missing result: ' + [model.id, id, sample.id].join('/'),
        );
        return count + Number(record.passed);
      }, 0),
    );
  }
  // Only recommend complete passes for the selected language. Use coverage
  // across the suite to break a tie between models that both passed it.
  const ranked = MODEL_CHOICES.map((choice, index) => ({
    choice,
    index,
    coverage: languages.filter(({ id }) => scores[id][index] === corpus.languages[id].length)
      .length,
  })).sort(
    (a, b) =>
      b.coverage - a.coverage ||
      a.choice.recommendedVramGiB - b.choice.recommendedVramGiB ||
      results.models[a.choice.id].bytes - results.models[b.choice.id].bytes,
  );
  const recommendations = Object.fromEntries(
    languages
      .map(({ id }) => [
        id,
        ranked
          .filter(({ index }) => scores[id][index] === corpus.languages[id].length)
          .map(({ choice }) => choice.id),
      ])
      .filter(([, choices]) => choices.length),
  );
  return {
    schemaVersion: 1,
    suite,
    ollamaVersion: results.ollamaVersion,
    corpusSha256: results.corpusSha256,
    contextTokens: options.num_ctx,
    models,
    scores,
    recommendations,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '11537' },
      corpus: { type: 'string', default: 'tools/benchmarks/model-language-cases.json' },
      report: { type: 'string', default: '.runtime/model-language-benchmark/results.json' },
      models: { type: 'string' },
      'write-catalog': { type: 'boolean' },
    },
  });
  const port = Number(values.port);
  assert.ok(Number.isInteger(port) && port > 1024 && port < 65536, 'Invalid loopback port');
  const reportFile = path.resolve(root, values.report);
  const reportRoot = path.join(root, '.runtime');
  assert.ok(
    reportFile.startsWith(reportRoot + path.sep),
    'Raw benchmark results belong in .runtime',
  );
  const corpus = readJson(path.resolve(root, values.corpus));
  const corpusSha256 = digest(JSON.stringify(corpus));
  assert.equal(corpus.schemaVersion, 1);
  assert.ok(Object.keys(corpus.languages).length);
  for (const [id, cases] of Object.entries(corpus.languages)) {
    assert.ok(
      languages.some((language) => language.id === id),
      'Unknown corpus language ' + id,
    );
    assert.ok(cases.length && new Set(cases.map((sample) => sample.id)).size === cases.length);
    for (const sample of cases) {
      assert.ok(sample.prompt?.trim() && /^[a-z0-9-]+$/.test(sample.id));
      assert.ok(
        sample.expected.length &&
          sample.expected.every((group) => group.length && group.every((marker) => marker.trim())),
      );
    }
  }
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
      ...(body && {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return response.json();
  };
  const ids = values.models?.split(',') ?? MODEL_CHOICES.map(({ id }) => id);
  assert.ok(
    ids.every((id) => MODEL_CHOICES.some((choice) => choice.id === id)),
    'Unknown profile',
  );
  const { version } = await request('version');
  const installed = (await request('tags')).models;
  const results = existsSync(reportFile)
    ? readJson(reportFile)
    : { suite, corpusSha256, ollamaVersion: version, options, models: {} };
  assert.equal(results.suite, suite);
  assert.equal(results.corpusSha256, corpusSha256, 'Use a fresh report for a different corpus');
  assert.equal(results.ollamaVersion, version, 'Use the same benchmark runtime to resume');
  mkdirSync(path.dirname(reportFile), { recursive: true });

  for (const id of ids) {
    const choice = MODEL_CHOICES.find((model) => model.id === id);
    const local = installed.find(({ name }) => name === choice.model);
    assert.ok(local, 'Pull the model before benchmarking: ' + choice.model);
    const tested = (results.models[id] ??= {
      tag: choice.model,
      digest: local.digest,
      quantization: local.details.quantization_level,
      bytes: local.size,
      languages: {},
    });
    assert.equal(tested.digest, local.digest, 'Use a fresh report for updated model weights');
    let count = 0;
    let ran = false;
    try {
      for (const [language, cases] of Object.entries(corpus.languages)) {
        const meta = languages.find((item) => item.id === language);
        const saved = (tested.languages[language] ??= {});
        for (const sample of cases) {
          if (typeof saved[sample.id]?.passed === 'boolean') continue;
          ran = true;
          const response = await request('chat', {
            model: choice.model,
            stream: false,
            think: false,
            keep_alive: '5m',
            options,
            messages: [
              {
                role: 'system',
                content: `Respond only in ${meta.name} (${meta.label}). Follow the requested format and keep the answer short.`,
              },
              { role: 'user', content: sample.prompt },
            ],
          });
          assert.equal(typeof response.message?.content, 'string', 'Missing model response');
          const answer = response.message.content.trim();
          saved[sample.id] = {
            passed: response.done_reason !== 'length' && scoreLanguageAnswer(answer, sample),
            answer,
            tokens: response.eval_count ?? 0,
            evaluationMs: Math.round((response.eval_duration ?? 0) / 1e6),
          };
          writeJsonAtomic(reportFile, results);
        }
        if (++count % 10 === 0) console.log(`${choice.model}: ${count} languages`);
      }
    } finally {
      if (ran) await request('generate', { model: choice.model, keep_alive: 0 }).catch(() => {});
    }
    console.log(`${choice.model}: completed ${count} languages`);
  }
  if (values['write-catalog'])
    writeJsonAtomic(
      path.join(root, 'packages/runtime/src/hardware/model-language-benchmark.json'),
      benchmarkSummary(corpus, results),
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
