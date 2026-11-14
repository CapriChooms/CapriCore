// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LOCAL_LOAD_DEFAULTS,
  localLoadSettings,
  LocalLoadPolicy,
} from '../apps/desktop/local-model-load-policy.mjs';
import { LocalModelLoad } from '../apps/desktop/local-model-load.mjs';
const sample = (gpuPercent, cpuPercent = 3) => ({ members: 1, cpuPercent, gpuPercent });
const on = { enabled: true, percent: 60 };
function folder(t) {
  const value = mkdtempSync(path.join(tmpdir(), 'capri-load-limit-'));
  t.after(() => rmSync(value, { recursive: true, force: true }));
  return value;
}

test('load control defaults to 85%, validates bounds, and persists independently of providers', (t) => {
  assert.deepEqual(LOCAL_LOAD_DEFAULTS, { enabled: true, percent: 85 });
  for (const value of [
    null,
    [],
    { enabled: 'yes', percent: 85 },
    { enabled: true, percent: 9 },
    { enabled: true, percent: 101 },
    { enabled: true, percent: NaN },
    { ...on, pid: 1 },
  ])
    assert.throws(() => localLoadSettings(value));
  const root = folder(t),
    store = new LocalModelLoad({ root });
  assert.equal(store.snapshot().percent, 85);
  store.set({ enabled: false, percent: 35 });
  assert.equal(new LocalModelLoad({ root }).snapshot().percent, 35);
  assert.equal(new LocalModelLoad({ root }).snapshot().enabled, false);
  writeFileSync(store.file, 'invalid');
  assert.match(new LocalModelLoad({ root }).snapshot().warning, /restored/);
  assert.equal(readFileSync(store.file, 'utf8'), 'invalid');
});
test('CPU-only and missing GPU counters enforce the CPU ceiling without claiming a GPU reading', () => {
  const policy = new LocalLoadPolicy();
  assert.equal(policy.update(on, sample(null, 99)), 6000);
  assert.equal(policy.update({ ...on, percent: 85 }, sample(null, 99)), 8500);
  assert.equal(policy.update({ ...on, enabled: false }, sample(100, 99)), 10000);
  assert.equal(policy.update(on, sample(NaN)), 6000);
});
test('GPU feedback calibrates from measured demand, avoids duplicate drift and stays within the CPU cap', () => {
  const policy = new LocalLoadPolicy();
  for (let i = 0; i < 8; i++) policy.update(on, sample(90, 3));
  assert(policy.cap < 6000 && policy.cap >= 1);
  assert(policy.cap < 200);
  const lower = policy.cap;
  for (let i = 0; i < 12; i++) policy.update(on, sample(30, 3));
  assert(policy.cap > lower && policy.cap <= 6000);
  policy.update({ ...on, enabled: false }, sample(100));
  assert.equal(policy.frames, 0);
  assert.equal(policy.cap, 10000);
});
test('GPU feedback recovers after other GPU work ends, even from the smallest CPU quota', () => {
  const policy = new LocalLoadPolicy();
  for (let i = 0; i < 12; i++) policy.update(on, sample(100, 0.001));
  assert.equal(policy.cap, 1);
  for (let i = 0; i < 24; i++) policy.update(on, sample(0, 0));
  assert(policy.cap > 50, 'a quiet GPU must not leave inference stuck at a rounded tiny quota');
  assert(policy.cap <= 6000);
});
test('only a bounded marker from this installation can select an Ollama supervisor', (t) => {
  const root = folder(t),
    control = new LocalModelLoad({ root });
  const file = path.join(root, 'data/run/ollama.json');
  mkdirSync(path.dirname(file), { recursive: true });
  const marker = {
    pid: 123,
    startedAt: '1234567',
    executable: path.join(root, 'ollama.exe'),
    projectRoot: root,
  };
  writeFileSync(file, JSON.stringify(marker));
  assert.equal(control.marker().pid, 123);
  for (const bad of [
    { ...marker, projectRoot: path.dirname(root) },
    { ...marker, pid: -1 },
    { ...marker, startedAt: 'invalid' },
    { ...marker, executable: path.join(root, 'other.exe') },
  ]) {
    writeFileSync(file, JSON.stringify(bad));
    assert.equal(control.marker(), null);
  }
});
test('heartbeats do not advance GPU feedback; stop and helper failure release the owned quota', async (t) => {
  const root = folder(t),
    commands = [],
    resets = [];
  const worker = new EventEmitter();
  worker.exitCode = null;
  worker.stdout = new EventEmitter();
  worker.stdout.setEncoding = () => {};
  worker.stdin = new EventEmitter();
  worker.stdin.destroyed = false;
  worker.stdin.write = (line) => commands.push(JSON.parse(line));
  worker.stdin.end = () => setImmediate(() => worker.emit('close', 0));
  worker.kill = () => worker.emit('close', 1);
  const control = new LocalModelLoad({
    root,
    platform: 'win32',
    spawnImpl: () => worker,
    runImpl: async (_file, args) => resets.push(args),
  });
  control.settings = on;
  control.start('fixture-helper', {
    pid: 123,
    startedAt: '123',
    executable: path.join(root, 'ollama.exe'),
  });
  worker.stdout.emit('data', '{"ready":true,"jobHandle":"44"}\n');
  for (let i = 0; i < 5; i++) worker.stdout.emit('data', JSON.stringify(sample(90, 3)) + '\n');
  const cap = control.policy.cap;
  for (let i = 0; i < 5; i++) control.send();
  assert.equal(control.policy.cap, cap);
  assert.equal(commands.at(-1).cap, cap);
  control.set({ enabled: true, percent: 35 });
  assert(
    control.policy.cap <= cap,
    'lowering the slider must not briefly increase the CPU/GPU budget',
  );
  assert.equal(control.policy.calibrated, true, 'live slider changes preserve GPU calibration');
  await control.stop();
  assert.equal(control.worker, null);
  assert(resets.some((args) => args[4] === '--reset' && args.length === 5));
  assert.equal(control.jobs.size, 1);
  await control.close();
  assert(resets.some((args) => args[4] === '--reset' && args[5] === '44'));
  assert.equal(control.jobs.size, 0);
});

function lifecycle(t) {
  const root = folder(t),
    workers = [],
    resets = [];
  let clock = 0;
  const control = new LocalModelLoad({
    root,
    platform: 'win32',
    now: () => clock,
    runImpl: async (_file, args) => resets.push(args),
    spawnImpl: () => {
      const worker = new EventEmitter();
      worker.exitCode = null;
      worker.stdout = new EventEmitter();
      worker.stdout.setEncoding = () => {};
      worker.stdin = new EventEmitter();
      worker.stdin.destroyed = false;
      worker.stdin.write = () => {};
      worker.stdin.end = () =>
        setImmediate(() => {
          worker.exitCode = 0;
          worker.emit('close', 0);
        });
      worker.kill = () => {
        worker.exitCode = 1;
        worker.emit('close', 1);
      };
      workers.push(worker);
      const handle = String(40 + workers.length * 4);
      setImmediate(() =>
        worker.stdout.emit('data', JSON.stringify({ ready: true, jobHandle: handle }) + '\n'),
      );
      return worker;
    },
  });
  control.marker = () => ({
    pid: 123,
    startedAt: '123',
    executable: path.join(root, 'ollama.exe'),
  });
  control.prepare = async () => 'fixture-helper';
  t.after(() => control.close());
  return {
    control,
    workers,
    resets,
    advance: () => {
      clock += 10000;
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('idle/API work never starts a helper; rapid off/on and resuming local work recover without duplicate jobs', async (t) => {
  const { control, workers, resets, advance } = lifecycle(t);
  control.synchronize(false);
  assert.equal(workers.length, 0);
  control.synchronize(true);
  await control.syncing;
  await settle();
  assert.equal(workers.length, 1);
  control.set({ enabled: false, percent: 35 });
  control.set({ enabled: true, percent: 35 });
  await control.stopping;
  advance();
  control.synchronize(true);
  await control.syncing;
  await settle();
  assert.equal(workers.length, 2);
  assert.equal(control.jobs.size, 1);
  assert.equal(control.snapshot().percent, 35);
  control.synchronize(false);
  await control.stopping;
  assert.equal(control.worker, null);
  for (let i = 0; i < 5; i++) control.synchronize(false);
  assert.equal(workers.length, 2);
  advance();
  control.synchronize(true);
  await control.syncing;
  await settle();
  assert.equal(workers.length, 3);
  await control.close();
  assert.equal(
    resets.filter((args) => args[5] === '44').length,
    1,
    'the retained job handle closes once',
  );
  assert(resets.some((args) => args[5] === '48'));
});

test('losing local activity or closing during compilation cannot start an orphan helper', async (t) => {
  for (const close of [false, true]) {
    const { control, workers } = lifecycle(t);
    let compiled;
    control.prepare = () =>
      new Promise((resolve) => {
        compiled = resolve;
      });
    control.synchronize(true);
    if (close) await control.close();
    else control.synchronize(false);
    compiled('fixture-helper');
    await control.syncing;
    assert.equal(workers.length, 0);
  }
});

test('invalid native telemetry stops control with a visible warning instead of forwarding unsafe quotas', async (t) => {
  const { control, workers } = lifecycle(t);
  control.synchronize(true);
  await control.syncing;
  await settle();
  workers[0].stdout.emit('data', '{"members":1,"cpuPercent":1000,"gpuPercent":85}\n');
  await settle();
  assert.equal(control.worker, null);
  assert.equal(control.snapshot().state, 'unavailable');
  assert.match(control.snapshot().warning, /unavailable/);
});
