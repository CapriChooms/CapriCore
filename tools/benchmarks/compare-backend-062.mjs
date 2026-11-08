// SPDX-License-Identifier: GPL-3.0-only
// Paired CPU-only comparison with the clean 0.6.1 source. No models or owner data.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { sseData } from '../../apps/desktop/chat-service.mjs';
const root = process.cwd(),
  baselineCommit = '1e4868a632d4765acd8cb297d3ed49e60b94799d';
const parent = path.join(root, '.runtime/0.6.2/benchmarks');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'paired-'));
const oldSource = (file) =>
  execFileSync('git', ['show', baselineCommit + ':' + file], {
    encoding: 'utf8',
    windowsHide: true,
  });
const catalogSource = oldSource('apps/desktop/desktop-catalog.mjs').replace(
  /(from\s+)(['"])(\.[^'"]+)\2/g,
  (_all, prefix, quote, specifier) =>
    prefix +
    quote +
    new URL(specifier, pathToFileURL(path.join(root, 'apps/desktop/desktop-catalog.mjs'))).href +
    quote,
);
writeFileSync(path.join(folder, 'catalog.mjs'), catalogSource);
const streamSource = oldSource('apps/desktop/chat-service.mjs');
const limit = streamSource.match(/const MAX_EVENT = [^;]+;/)[0];
writeFileSync(
  path.join(folder, 'stream.mjs'),
  limit +
    '\n' +
    streamSource.slice(
      streamSource.indexOf('export async function* sseData'),
      streamSource.indexOf('function publicError'),
    ),
);
const { DesktopCatalog: BaselineCatalog } = await import(
    pathToFileURL(path.join(folder, 'catalog.mjs'))
  ),
  { sseData: baselineSse } = await import(pathToFileURL(path.join(folder, 'stream.mjs')));
const apps = Array.from({ length: 40 }, (_, i) => ({
  id: String(i).padStart(8, '0') + '-0000-4000-8000-000000000000',
  name: 'Synthetic app ' + i,
  executable: 'C:\\SyntheticFixture\\app-' + i + '.exe',
  launch: i % 2 === 0,
  inspect: false,
  text: false,
}));
const instances = [BaselineCatalog, DesktopCatalog].map((Class, index) => {
  const directory = path.join(folder, 'catalog-' + index);
  const catalog = new Class({ root: directory, state: directory });
  catalog.save(apps);
  return catalog;
});
const results = [];
async function measure(name, version, work, iterations, warmup) {
  for (let i = 0; i < warmup; i++) await work();
  const samples = [],
    cpu = process.cpuUsage();
  for (let i = 0; i < iterations; i++) {
    const before = performance.now();
    await work();
    samples.push(performance.now() - before);
  }
  const used = process.cpuUsage(cpu);
  samples.sort((a, b) => a - b);
  results.push({
    name,
    version,
    iterations,
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.floor(samples.length * 0.95)],
    cpuMs: (used.user + used.system) / 1000,
  });
}
const payload = new TextEncoder().encode('data: synthetic\n'.repeat(5000) + '\n');
try {
  for (let round = 0; round < 3; round++) {
    for (const index of round % 2 ? [1, 0] : [0, 1])
      await measure(
        'catalog-40-apps',
        index ? '0.6.2' : '0.6.1',
        () => assert.equal(instances[index].apps().length, 40),
        2000,
        15,
      );
    for (const index of round % 2 ? [1, 0] : [0, 1])
      await measure(
        'sse-5000-lines',
        index ? '0.6.2' : '0.6.1',
        async () => {
          async function* body() {
            yield payload;
          }
          let count = 0;
          for await (const row of [baselineSse, sseData][index](body())) {
            count++;
            assert.equal(row.split('\n').length, 5000);
          }
          assert.equal(count, 1);
        },
        60,
        3,
      );
  }
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const comparison = ['catalog-40-apps', 'sse-5000-lines'].map((name) => {
    const before = results.filter((row) => row.name === name && row.version === '0.6.1'),
      after = results.filter((row) => row.name === name && row.version === '0.6.2');
    const summarize = (rows) => ({
      medianMs: median(rows.map((row) => row.medianMs)),
      p95Ms: median(rows.map((row) => row.p95Ms)),
      cpuMs: median(rows.map((row) => row.cpuMs)),
    });
    const old = summarize(before),
      current = summarize(after);
    return {
      name,
      before: old,
      after: current,
      speedup: old.medianMs / current.medianMs,
      cpuReductionPercent: (1 - current.cpuMs / old.cpuMs) * 100,
    };
  });
  const report = {
    baselineCommit,
    rounds: 3,
    syntheticOnly: true,
    gpuUsed: false,
    comparison,
    results,
  };
  writeFileSync(
    path.join(parent, 'paired-comparison.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify({ comparison }));
} finally {
  for (const catalog of instances) await catalog.close();
}
