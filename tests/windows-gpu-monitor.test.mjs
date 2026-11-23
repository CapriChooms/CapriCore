// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  parseWindowsGpuSample,
  WindowsGpuSampler,
} from '../packages/runtime/src/hardware/windows-gpu.mjs';
import { mergeGpuReadings, MemorySampler } from '../packages/runtime/src/hardware/memory.mjs';

const GiB = 2 ** 30;
const luid = '0x00000000_0x0000B6E6';
const adapter = (extra = {}) => ({
  name: 'AMD Radeon RX 6400',
  vendor: 'amd',
  memoryKind: 'dedicated',
  vramMiB: 4096,
  luid,
  ...extra,
});
const counter = (bytes, node = 0, id = luid) => ({ name: `luid_${id}_phys_${node}`, value: bytes });
const engine = (pid, index, value, id = luid) => ({
  name: `pid_${pid}_luid_${id}_phys_0_eng_${index}_engtype_Compute`,
  value,
});

test('AMD dedicated VRAM is matched by LUID; busiest engine combines processes without summing parallel engines', () => {
  const [gpu] = parseWindowsGpuSample({
    adapters: [adapter()],
    memory: [counter(GiB)],
    engines: [engine(1, 0, 20), engine(2, 0, 30), engine(1, 1, 45), engine(1, 2, 15)],
  });
  assert.equal(gpu.totalBytes, 4 * GiB);
  assert.equal(gpu.usedBytes, GiB);
  assert.equal(gpu.freeBytes, 3 * GiB);
  assert.equal(gpu.percent, 25);
  assert.equal(gpu.utilization, 50);
  assert.equal(gpu.temperatureCelsius, null);
});

test('missing/ambiguous counters retain capacity but never manufacture usage, shared VRAM, temperatures or utilization', () => {
  for (const memory of [
    null,
    [],
    [counter(5 * GiB)],
    [counter(-1)],
    [counter(true)],
    [counter(GiB), counter(GiB, 1)],
    [counter(GiB), counter(GiB)],
  ]) {
    const [gpu] = parseWindowsGpuSample({ adapters: [adapter()], memory, engines: null });
    assert.equal(gpu.totalBytes, 4 * GiB);
    assert.equal(gpu.usedBytes, null);
    assert.equal(gpu.freeBytes, null);
    assert.equal(gpu.utilization, null);
  }
  const [uma] = parseWindowsGpuSample({
    adapters: [adapter({ memoryKind: 'shared', vramMiB: 32768 })],
    memory: [counter(GiB)],
  });
  assert.equal(uma.totalBytes, null);
  assert.equal(uma.usedBytes, null);
  const [invalid] = parseWindowsGpuSample({ adapters: [adapter({ vramMiB: 1e100 })] });
  assert.equal(invalid.totalBytes, null);
});

test('different and duplicate adapters, malformed driver values and vendor readings never contaminate another GPU', () => {
  const second = '0x00000000_0x0000B6E7';
  const rows = parseWindowsGpuSample({
    adapters: [adapter(), adapter(), adapter({ luid: second, name: 'Intel GPU', vendor: 'intel' })],
    memory: [counter(2 * GiB, 0, second)],
    engines: [engine(1, 0, 70, second), engine(1, 1, NaN), engine(1, 2, 101)],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].usedBytes, null);
  assert.equal(rows[0].utilization, null);
  assert.equal(rows[1].usedBytes, 2 * GiB);
  const nvidia = [{ id: 'GPU-driver', vendor: 'nvidia', temperatureCelsius: 40 }];
  assert.deepEqual(mergeGpuReadings(nvidia, [...rows, { vendor: 'nvidia' }]), [...nvidia, ...rows]);
  assert.throws(() => parseWindowsGpuSample({ adapters: Array(65).fill(adapter()) }));
});

function childFixture(reply) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.kills = 0;
  child.kill = () => {
    child.kills++;
    child.emit('close', 1);
  };
  child.stdin.on('data', () => {
    if (reply) queueMicrotask(() => child.stdout.write(reply));
  });
  return child;
}

test('native monitoring shares overlapping requests and one worker; stop cancels pending and never returns an old reading', async () => {
  const child = childFixture(
    JSON.stringify({ adapters: [adapter()], memory: [counter(GiB)] }) + '\n',
  );
  let starts = 0;
  const sampler = new WindowsGpuSampler({
    spawnImpl: () => {
      starts++;
      return child;
    },
  });
  sampler.prepare = async () => 'synthetic-collector';
  const first = sampler.sample(),
    second = sampler.sample();
  assert.equal(first, second);
  assert.equal((await first)[0].usedBytes, GiB);
  assert.equal((await sampler.sample())[0].usedBytes, GiB);
  assert.equal(starts, 1);
  sampler.stop();
  assert.equal(child.kills, 1);
  const waiting = childFixture();
  sampler.spawnImpl = () => waiting;
  const pending = sampler.sample();
  await new Promise((resolve) => setImmediate(resolve));
  sampler.stop();
  await assert.rejects(pending, /stopped/);
  assert.equal(waiting.kills, 1);
});

test('timeout, malformed and oversized output kill only the owned worker and back off instead of leaking children', async () => {
  for (const reply of [null, 'not-json\n', 'x'.repeat(1024 * 1024 + 1)]) {
    const child = childFixture(reply);
    let starts = 0;
    const sampler = new WindowsGpuSampler({
      spawnImpl: () => {
        starts++;
        return child;
      },
      timeoutMs: 20,
      now: () => 100,
    });
    sampler.prepare = async () => 'synthetic-collector';
    await assert.rejects(sampler.sample());
    assert.equal(child.kills, 1);
    await assert.rejects(sampler.sample(), /unavailable/);
    assert.equal(starts, 1);
  }
});

test('fresh monitoring replaces stale AMD memory readings with genuinely unknown counters', async () => {
  let reads = 0;
  const sampler = new MemorySampler({
    readGpu: async () =>
      parseWindowsGpuSample({
        adapters: [adapter()],
        memory: ++reads === 1 ? [counter(GiB)] : null,
      }),
  });
  assert.equal((await sampler.sample()).gpus[0].usedBytes, GiB);
  const fresh = await sampler.sample({ fresh: true });
  assert.equal(fresh.gpus[0].usedBytes, null);
  assert.equal(fresh.gpus[0].totalBytes, 4 * GiB);
});

test('idle collectors stop and stopping during preparation cannot spawn a late worker', async () => {
  const child = childFixture(JSON.stringify({ adapters: [adapter()], memory: null }) + '\n');
  const sampler = new WindowsGpuSampler({ spawnImpl: () => child, idleMs: 10 });
  sampler.prepare = async () => 'synthetic-collector';
  await sampler.sample();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sampler.worker, null);
  assert.equal(child.kills, 1);
  let finish;
  const preparing = new WindowsGpuSampler({ spawnImpl: () => assert.fail('late spawn') });
  preparing.prepare = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = preparing.sample();
  await Promise.resolve();
  preparing.stop();
  finish('synthetic-collector');
  await assert.rejects(pending, /stopped/);
});
