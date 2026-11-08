// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { ensureUv } from '../packages/installer/src/uv-runtime.mjs';
import { fetchArtifact } from '../packages/installer/src/download.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(path.join(root, 'config/installer.json'), 'utf8'));
const parent = path.join(root, '.runtime/uv-runtime-tests');
mkdirSync(parent, { recursive: true });
function fixture() {
  const folder = mkdtempSync(path.join(parent, 'case-')),
    payload = Buffer.from('pinned archive fixture');
  const spec = { ...manifest.artifacts.uv, bytes: payload.length, sha256: hash(payload) };
  mkdirSync(path.join(folder, 'config'));
  const save = () =>
    writeFileSync(
      path.join(folder, 'config/installer.json'),
      JSON.stringify({ artifacts: { uv: spec } }),
    );
  save();
  let downloads = 0,
    extractions = 0;
  const env = { FIXTURE_ENV: 'bounded' };
  const download = async (value, cache, options) => {
    downloads++;
    assert.equal(value.url, manifest.artifacts.uv.url);
    return fetchArtifact(value, cache, {
      ...options,
      fetchImpl: async (_url, request) => {
        assert.equal(request.redirect, 'manual');
        return new Response(payload);
      },
    });
  };
  const execute = async (file, args, options) => {
    extractions++;
    assert.equal(file, 'powershell.exe');
    assert.equal(options.cwd, folder);
    assert.equal(options.env, env);
    assert.equal(args[args.indexOf('-OwnerStamp') + 1], '1234');
    assert.equal(args[args.indexOf('-OwnerPid') + 1], String(process.pid));
    const decoded = JSON.parse(
      Buffer.from(args[args.indexOf('-ArgumentsBase64') + 1], 'base64').toString(),
    );
    assert.equal(decoded[decoded.indexOf('-MaximumBytes') + 1], String(128 * 1024 ** 2));
    const destination = decoded[decoded.indexOf('-Destination') + 1];
    assert.equal(destination, path.join(folder, '.runtime/uv'));
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, 'uv.exe'), 'owned verified runtime fixture');
  };
  return {
    folder,
    spec,
    save,
    payload,
    env,
    download,
    execute,
    ownerStamp: () => '1234',
    counts: () => ({ downloads, extractions }),
  };
}

const repairPhases = [
  'receipt-check',
  'archive-fetch',
  'archive-ready',
  'owner-check',
  'owner-ready',
  'extract-start',
  'extract-done',
  'verify-start',
  'ready',
];
function assertRuntimeTrace(events) {
  let previousElapsed = 0;
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['elapsedMs', 'progress', 'runtimePhase', 'stage']);
    assert.equal(event.stage, 'dependencies');
    assert.equal(event.progress, 0);
    assert.ok(repairPhases.includes(event.runtimePhase), event.runtimePhase);
    assert.ok(Number.isSafeInteger(event.elapsedMs));
    assert.ok(event.elapsedMs >= previousElapsed);
    previousElapsed = event.elapsedMs;
  }
}

test('uv runtime traces contain only bounded fixed phases and elapsed time for repair and reuse', async () => {
  const f = fixture(),
    events = [],
    options = { ...f, root: f.folder, emit: (event) => events.push(event) };
  await ensureUv(options);
  assertRuntimeTrace(events);
  assert.deepEqual(
    events.map((event) => event.runtimePhase),
    repairPhases,
  );
  const serialized = JSON.stringify(events);
  for (const privateValue of [
    f.folder,
    f.spec.url,
    f.spec.sha256,
    f.env.FIXTURE_ENV,
    f.payload.toString(),
  ])
    assert.equal(serialized.includes(privateValue), false, privateValue);
  assert.doesNotMatch(serialized, /"(?:pid|ownerPid|ownerStamp|env|args|payload|path|root|url)"/i);
  events.length = 0;
  await ensureUv(options);
  assertRuntimeTrace(events);
  assert.deepEqual(
    events.map((event) => event.runtimePhase),
    ['receipt-check', 'ready'],
  );
  assert.deepEqual(f.counts(), { downloads: 1, extractions: 1 });
});
test('uv repair needs no voice data and reuses a receipt only while the executable checksum matches', async () => {
  const f = fixture(),
    options = { ...f, root: f.folder };
  const file = await ensureUv(options);
  assert.equal(file, path.join(f.folder, '.runtime/uv/uv.exe'));
  assert.deepEqual(f.counts(), { downloads: 1, extractions: 1 });
  await ensureUv(options);
  assert.deepEqual(f.counts(), { downloads: 1, extractions: 1 });
  writeFileSync(file, 'corrupted runtime');
  await ensureUv(options);
  assert.deepEqual(f.counts(), { downloads: 2, extractions: 2 });
  assert(!existsSync(path.join(f.folder, 'data')));
});
test('uv repair rejects another source, unpinned bytes, invalid ownership and linked destinations', async () => {
  for (const field of [
    { url: 'https://github.com/unrelated/release/uv.zip' },
    { directory: '../outside' },
    { version: '../escape' },
  ]) {
    const f = fixture();
    Object.assign(f.spec, field);
    f.save();
    await assert.rejects(ensureUv({ ...f, root: f.folder }), /Invalid pinned uv/);
    assert.deepEqual(f.counts(), { downloads: 0, extractions: 0 });
  }
  const bad = fixture();
  bad.spec.sha256 = '0'.repeat(64);
  bad.save();
  await assert.rejects(ensureUv({ ...bad, root: bad.folder }), /checksum|SHA|verification/i);
  assert.equal(bad.counts().extractions, 0);
  const owner = fixture();
  await assert.rejects(
    ensureUv({ ...owner, root: owner.folder, ownerStamp: () => null }),
    /owner could not be verified/,
  );
  assert.equal(owner.counts().extractions, 0);
  const linked = fixture(),
    destination = path.join(linked.folder, 'outside');
  mkdirSync(destination);
  mkdirSync(path.join(linked.folder, '.runtime'));
  symlinkSync(
    destination,
    path.join(linked.folder, '.runtime/uv'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(ensureUv({ ...linked, root: linked.folder }), /link/i);
  assert.equal(linked.counts().downloads, 0);
});
test('cancelled or failed uv extraction cannot write an installation receipt', async () => {
  const f = fixture(),
    controller = new AbortController(),
    cancelledEvents = [];
  await assert.rejects(
    ensureUv({
      ...f,
      root: f.folder,
      signal: controller.signal,
      emit: (event) => cancelledEvents.push(event),
      download: async (...args) => {
        const file = await f.download(...args);
        controller.abort();
        return file;
      },
    }),
    /abort/i,
  );
  assert.equal(f.counts().extractions, 0);
  assert(!existsSync(path.join(f.folder, '.runtime/installer/uv.json')));
  assertRuntimeTrace(cancelledEvents);
  assert.equal(
    cancelledEvents.some((event) => event.runtimePhase === 'ready'),
    false,
  );
  const failed = fixture(),
    failedEvents = [];
  await assert.rejects(
    ensureUv({
      ...failed,
      root: failed.folder,
      emit: (event) => failedEvents.push(event),
      execute: async () => {
        throw Error('Fixture extraction failure');
      },
    }),
    /Fixture extraction failure/,
  );
  assert(!existsSync(path.join(failed.folder, '.runtime/installer/uv.json')));
  assertRuntimeTrace(failedEvents);
  assert.equal(
    failedEvents.some((event) => event.runtimePhase === 'ready'),
    false,
  );
});
