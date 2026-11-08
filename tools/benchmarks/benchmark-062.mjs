// SPDX-License-Identifier: GPL-3.0-only
// Synthetic CPU-only workloads. No models, microphone, screen, network or owner files.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DesktopCatalog } from '../../apps/desktop/desktop-catalog.mjs';
import { sseData } from '../../apps/desktop/chat-service.mjs';
import { root } from '../../packages/runtime/src/host/paths.mjs';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw Error('Choose before or after.');
const parent = path.join(root, '.runtime/0.6.2/benchmarks');
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(path.join(parent, phase + '-'));
const catalog = new DesktopCatalog({ root: directory, state: directory });
const apps = Array.from({ length: 40 }, (_, i) => ({
  id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
  name: `Synthetic application ${i}`,
  executable: `C:\\SyntheticFixture\\app-${i}.exe`,
  launch: i % 2 === 0,
  inspect: false,
  text: false,
}));
catalog.save(apps);
const measurements = [];
async function measure(name, operation, iterations, warmup = 15) {
  for (let i = 0; i < warmup; i++) await operation();
  const timings = [],
    cpu = process.cpuUsage(),
    before = process.memoryUsage();
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await operation();
    timings.push(performance.now() - start);
  }
  const used = process.cpuUsage(cpu),
    after = process.memoryUsage();
  timings.sort((a, b) => a - b);
  measurements.push({
    name,
    iterations,
    medianMs: timings[Math.floor(timings.length / 2)],
    p95Ms: timings[Math.floor(timings.length * 0.95)],
    cpuMs: (used.user + used.system) / 1000,
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
  });
}
try {
  await measure('catalog-40-apps', () => assert.equal(catalog.apps().length, 40), 2000);
  const payload = new TextEncoder().encode('data: synthetic\n'.repeat(5000) + '\n');
  await measure(
    'sse-5000-lines',
    async () => {
      async function* body() {
        yield payload;
      }
      let count = 0;
      for await (const text of sseData(body())) {
        count++;
        assert.equal(text.split('\n').length, 5000);
      }
      assert.equal(count, 1);
    },
    60,
    3,
  );
  const report = { schemaVersion: 1, phase, measurements, syntheticOnly: true, gpuUsed: false };
  writeFileSync(path.join(parent, phase + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  catalog.db.close();
}
