// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { ASRWorker } from '../apps/desktop/asr-worker.mjs';
import { recognitionModelsInstalled } from '../apps/desktop/language-models.mjs';
import settings from '../config/companion-asr.json' with { type: 'json' };
import candidates from '../config/multilingual-candidates.json' with { type: 'json' };
import detector from '../config/asr-vad-upstream.json' with { type: 'json' };

function fixture(t) {
  const parent = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(parent, 'capri-asr-startup-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    rmSync(root, { recursive: true, force: true });
  });
  const file = (relative, content) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  file('.runtime/asr-venv/Scripts/python.exe', 'fixture');
  const child = new EventEmitter();
  for (const channel of ['stdin', 'stdout', 'stderr']) child[channel] = new PassThrough();
  child.kill = () => {};
  const children = [child];
  const environments = [];
  let spawns = 0;
  const worker = new ASRWorker({
    root,
    spawnImpl: (_python, _args, { env }) => {
      environments.push(env);
      if (spawns) {
        const replacement = new EventEmitter();
        for (const channel of ['stdin', 'stdout', 'stderr'])
          replacement[channel] = new PassThrough();
        replacement.kill = () => {};
        children.push(replacement);
      }
      return children[spawns++];
    },
  });
  t.after(() => worker.close());
  return { root, file, worker, child, children, environments };
}

test('Russian speech recognition does not report truncated Parakeet files as installed', (t) => {
  const { root, file } = fixture(t);
  const vad = detector.files.model;
  file(path.join(settings.vad.modelDir, vad.file), Buffer.alloc(vad.bytes));
  for (const { file: name } of candidates.asr.files)
    file(path.join(candidates.asr.directory, name), 'incomplete');
  assert.equal(recognitionModelsInstalled(root, 'ru', settings), false);
});

test('the worker publishes only allowlisted startup diagnostics', async (t) => {
  const { worker, child } = fixture(t);
  const ready = worker.start();
  const failures = [];
  worker.on('failure', (error) => failures.push(error));
  child.stderr.write('private raw stderr');
  child.stdout.write('{"type":"startup-error","code":"ASR_START_MODEL","message":"private"}\n');
  child.emit('close', 1);
  await assert.rejects(ready, { code: 'ASR_START_MODEL' });
  assert.equal(failures.length, 1);
  assert.doesNotMatch(failures[0].message, /private/);
  assert.equal(worker.child, null);
});

test('a native failure before ready identifies a failed dependency without echoing process output', async (t) => {
  const { worker, child } = fixture(t);
  const ready = worker.start();
  child.emit('close', 0xc0000135 | 0);
  await assert.rejects(ready, (error) => {
    assert.equal(error.code, 'ASR_START_NATIVE_DLL');
    assert.equal(Object.hasOwn(error, 'startupStage'), false);
    return true;
  });
});

test('a repeated native startup crash preserves its native code and last confirmed stage', async (t) => {
  const { worker, child, children } = fixture(t),
    failures = [];
  worker.on('failure', (error) => failures.push(error));
  const ready = worker.start();
  child.stderr.write('private machine path and exception text');
  for (const code of [
    'ASR_START_DEPENDENCIES',
    'ASR_START_CONFIG',
    'ASR_START_DETECTOR',
    'ASR_START_MODEL',
  ])
    child.stdout.write(JSON.stringify({ type: 'startup-stage', code }) + '\n');
  child.emit('close', 0xc0000005 | 0);
  await new Promise(setImmediate);
  assert.equal(children.length, 2);
  children[1].stdout.write('{"type":"startup-stage","code":"ASR_START_MODEL"}\n');
  children[1].emit('close', 0xc0000005 | 0);
  await assert.rejects(ready, (error) => {
    assert.equal(error.code, 'ASR_START_NATIVE_CRASH');
    assert.equal(error.startupStage, 'ASR_START_MODEL');
    assert.deepEqual(Object.keys(error).sort(), ['code', 'startupStage']);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
  assert.equal(failures.length, 1);
  await new Promise(setImmediate);
  assert.equal(children.length, 2);
});

test('unknown stage codes and extra fields are rejected without exporting their contents', async (t) => {
  for (const event of [
    { type: 'startup-stage', code: 'ASR_START_PRIVATE_PATH' },
    { type: 'startup-stage', code: 'ASR_START_CONFIG', message: 'private machine path' },
    { type: 'startup-stage', code: ['ASR_START_CONFIG'] },
    { type: 'startup-stage' },
  ]) {
    const { worker, child } = fixture(t);
    const ready = worker.start();
    child.stdout.write(JSON.stringify(event) + '\n');
    await assert.rejects(ready, (error) => {
      assert.equal(error.code, 'ASR_START_PROTOCOL');
      assert.equal(Object.hasOwn(error, 'startupStage'), false);
      assert(!JSON.stringify(error).includes('private'));
      return true;
    });
  }
});

const readyMessage = {
  type: 'ready',
  protocol: 1,
  language: 'en',
  sampleRate: 16000,
  provider: 'cpu',
  engine: 'fixture',
  mode: 'utterance',
  draft: false,
};
const resetMessage = {
  type: 'recognition-reset',
  sessionId: 'capture',
  utterance: 0,
  nextUtterance: 1,
  reason: 'utterance_limit',
};

test('a model-load native crash recovers once for all startup callers without a failure event', async (t) => {
  const { worker, child, children, environments } = fixture(t),
    failures = [],
    recoveries = [];
  worker.on('failure', (error) => failures.push(error));
  worker.on('recovery', (event) => recoveries.push(event));
  const first = worker.start();
  const second = worker.start();
  child.stdout.write('{"type":"startup-stage","code":"ASR_START_MODEL"}\n');
  child.emit('close', 0xc0000005 | 0);
  await new Promise(setImmediate);
  assert.equal(children.length, 2);
  const replacement = children[1];
  assert.equal(environments[0].CAPRI_ASR_SAFE_STARTUP, undefined);
  assert.equal(environments[0].OMP_NUM_THREADS, '4');
  assert.equal(environments[1].CAPRI_ASR_SAFE_STARTUP, '1');
  assert.equal(environments[1].CAPRI_CPU_THREADS, '1');
  assert.equal(environments[1].OMP_NUM_THREADS, '1');
  assert.equal(environments[1].PYTHONNOUSERSITE, '1');
  assert.equal(environments[1].HF_HUB_OFFLINE, '1');
  child.emit('close', 0xc0000005 | 0);
  child.stdout.write('{"type":"startup-error","code":"ASR_START_MODEL"}\n');
  replacement.stdout.write(JSON.stringify(readyMessage) + '\n');
  assert.deepEqual(await Promise.all([first, second]), [readyMessage, readyMessage]);
  assert.deepEqual(recoveries, [
    { code: 'ASR_START_NATIVE_CRASH', startupStage: 'ASR_START_MODEL' },
  ]);
  assert.deepEqual(failures, []);
  assert.equal(worker.child, replacement);
  await worker.start();
  assert.equal(children.length, 2);
});

test('closing during native crash recovery never resurrects a recognition worker', async (t) => {
  for (const closeOnRecovery of [false, true]) {
    const { worker, child, children } = fixture(t);
    if (closeOnRecovery) worker.on('recovery', () => worker.close());
    const ready = worker.start();
    child.stdout.write('{"type":"startup-stage","code":"ASR_START_MODEL"}\n');
    child.emit('close', 0xc0000005 | 0);
    if (!closeOnRecovery) worker.close();
    await assert.rejects(ready, { code: 'ASR_START_NATIVE_CRASH' });
    await new Promise(setImmediate);
    assert.equal(children.length, 1);
    assert.equal(worker.child, null);
    assert.equal(worker.startupTask, null);
  }
});

test('a runtime crash or late stage record cannot inherit a completed startup stage', async (t) => {
  for (const lateStage of [false, true]) {
    const { worker, child } = fixture(t),
      failures = [];
    worker.on('failure', (error) => failures.push(error));
    const ready = worker.start();
    child.stdout.write(JSON.stringify({ type: 'startup-stage', code: 'ASR_START_MODEL' }) + '\n');
    child.stdout.write(JSON.stringify(readyMessage) + '\n');
    await ready;
    if (lateStage)
      child.stdout.write(JSON.stringify({ type: 'startup-stage', code: 'ASR_START_MODEL' }) + '\n');
    else child.emit('close', 0xc0000005 | 0);
    assert.equal(failures[0].code, lateStage ? 'ASR_WORKER_PROTOCOL' : 'ASR_WORKER_EXIT');
    assert.equal(Object.hasOwn(failures[0], 'startupStage'), false);
  }
});

test('a new worker generation starts without a stage and ignores the stale previous child', async (t) => {
  const { worker, child, children } = fixture(t);
  let ready = worker.start();
  child.stdout.write(JSON.stringify({ type: 'startup-stage', code: 'ASR_START_MODEL' }) + '\n');
  child.emit('close', 0xc000001d | 0);
  await assert.rejects(ready, {
    code: 'ASR_START_NATIVE_INSTRUCTION',
    startupStage: 'ASR_START_MODEL',
  });
  ready = worker.start();
  const replacement = children[1];
  assert.equal(worker.child, replacement);
  child.stdout.write(JSON.stringify({ type: 'startup-stage', code: 'ASR_START_MODEL' }) + '\n');
  child.emit('close', 0xc0000005 | 0);
  assert.equal(worker.child, replacement);
  replacement.emit('close', 0xc0000005 | 0);
  await assert.rejects(ready, (error) => {
    assert.equal(error.code, 'ASR_START_NATIVE_CRASH');
    assert.equal(Object.hasOwn(error, 'startupStage'), false);
    return true;
  });
});

test('a confirmed bounded turn reset is forwarded without stopping the worker or rejecting PCM', async (t) => {
  const { worker, child } = fixture(t),
    events = [],
    failures = [];
  worker.on('reset', (event) => events.push(event));
  worker.on('failure', (error) => failures.push(error));
  const ready = worker.start();
  child.stdout.write(JSON.stringify(readyMessage) + '\n');
  await ready;
  const packet = worker.send({ type: 'pcm', sessionId: 'capture', pcm: 'AAAAAA==' });
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.write(
    JSON.stringify(resetMessage) +
      '\n' +
      JSON.stringify({ type: 'ack', request: worker.requestId }) +
      '\n',
  );
  await packet;
  assert.deepEqual(events, [resetMessage]);
  assert.deepEqual(failures, []);
  assert.equal(worker.child, child);
  assert.equal(worker.pending.size, 0);
});

test('malformed reset messages remain fatal protocol failures rather than silently dropping audio', async (t) => {
  for (const changed of [
    { reason: 'arbitrary-content' },
    { utterance: -1 },
    { nextUtterance: 3 },
    { sessionId: '' },
    { sessionId: 'x'.repeat(81) },
    { nextUtterance: 0.5 },
    { privateMetadata: 'do-not-publish' },
  ]) {
    const { worker, child } = fixture(t),
      failures = [],
      resets = [];
    worker.on('failure', (error) => failures.push(error));
    worker.on('reset', (event) => resets.push(event));
    const ready = worker.start();
    child.stdout.write(JSON.stringify(readyMessage) + '\n');
    await ready;
    child.stdout.write(JSON.stringify({ ...resetMessage, ...changed }) + '\n');
    assert.equal(worker.child, null);
    assert.equal(failures[0].code, 'ASR_WORKER_PROTOCOL');
    assert.deepEqual(resets, []);
    assert(!failures[0].message.includes('do-not-publish'));
  }
});
