// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  musicDetectorConfig,
  musicPython,
  prepareMusicDetector,
} from '../apps/desktop/music-detector-provision.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(
  readFileSync(new URL('../config/music-detector.json', import.meta.url), 'utf8'),
);
const parent = path.join(process.cwd(), '.runtime/music-detector-provision-tests');
mkdirSync(parent, { recursive: true });
function fixture() {
  const root = mkdtempSync(path.join(parent, 'case-'));
  const payloads = new Map(
    ['yamnet.onnx', 'yamnet.data', 'labels.txt', 'metadata.json'].map((name) => [
      name,
      Buffer.from('verified-fixture:' + name),
    ]),
  );
  const archive = Buffer.from('synthetic-archive-only-not-a-real-model');
  const config = {
    ...original,
    artifact: { ...original.artifact, sha256: hash(archive), bytes: archive.length },
    files: [...payloads].map(([name, data]) => ({ name, sha256: hash(data), bytes: data.length })),
  };
  const configFile = path.join(root, 'config/music-detector.json');
  mkdirSync(path.dirname(configFile), { recursive: true });
  const save = () => writeFileSync(configFile, JSON.stringify(config));
  save();
  const python = path.join(root, '.runtime/router-venv/Scripts/python.exe');
  mkdirSync(path.dirname(python), { recursive: true });
  writeFileSync(python, 'fixture-never-executed');
  let downloads = 0,
    extractions = 0;
  return {
    root,
    config,
    archive,
    configFile,
    payloads,
    save,
    downloads: () => downloads,
    extractions: () => extractions,
    async fetchImpl(url, options) {
      downloads++;
      assert.equal(url.origin, 'https://qaihub-public-assets.s3.us-west-2.amazonaws.com');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['accept-encoding'], 'identity');
      assert(!options.headers.Authorization);
      return new Response(archive, {
        status: 200,
        headers: { 'content-length': String(archive.length) },
      });
    },
    async execute(command, args, options) {
      extractions++;
      assert.equal(command, 'powershell.exe');
      assert(args.includes('-NonInteractive'));
      assert.equal(options.cwd, root);
      const destination = args[args.indexOf('-Destination') + 1];
      assert(
        path.resolve(destination).startsWith(path.join(root, '.runtime/music-detector') + path.sep),
      );
      assert.equal(path.basename(args[args.indexOf('-Archive') + 1]), hash(archive) + '.zip');
      for (const [name, data] of payloads) writeFileSync(path.join(destination, name), data);
    },
  };
}
const prepare = (f, options = {}) =>
  prepareMusicDetector(f.root, { fetchImpl: f.fetchImpl, execute: f.execute, ...options });

test('the music model accepts only four pinned fixed files with unique safe names', () => {
  for (const change of [
    (c) => {
      c.files[0].name = '../outside.onnx';
    },
    (c) => {
      c.files[1].name = c.files[0].name;
    },
    (c) => {
      c.files[0].sha256 = 'unverified';
    },
    (c) => {
      c.files[0].bytes = 21 * 1024 ** 2;
    },
    (c) => {
      c.sampleRate = 48000;
    },
  ]) {
    const f = fixture();
    change(f.config);
    f.save();
    assert.throws(() => musicDetectorConfig(f.root), /Invalid music detector package/);
  }
});

test('a checked official archive is staged, checked again and cached without subsequent network or extraction', async () => {
  const f = fixture(),
    progress = [];
  assert(
    musicPython(f.root).endsWith('router-venv' + path.sep + 'Scripts' + path.sep + 'python.exe'),
  );
  const first = await prepare(f, { progress: (value) => progress.push(value) });
  assert.equal(f.downloads(), 1);
  assert.equal(f.extractions(), 1);
  assert(
    progress.some(
      (value) => value.received === f.archive.length && value.total === f.archive.length,
    ),
  );
  for (const spec of f.config.files)
    assert.equal(hash(readFileSync(path.join(first.folder, spec.name))), spec.sha256);
  const cached = await prepare(f, {
    fetchImpl: () => assert.fail('Verified model cache must not download'),
    execute: () => assert.fail('Verified model cache must not extract'),
  });
  assert.equal(cached.folder, first.folder);
  writeFileSync(path.join(first.folder, 'yamnet.onnx'), 'tampered');
  await prepare(f, { fetchImpl: () => assert.fail('Verified archive cache must not download') });
  assert.equal(f.extractions(), 2, 'Corrupted installed model is rebuilt from the pinned archive');
  assert.equal(
    hash(readFileSync(path.join(first.folder, 'yamnet.onnx'))),
    f.config.files[0].sha256,
  );
});

test('an invalid extracted model never becomes an installed detector', async () => {
  const f = fixture();
  await assert.rejects(
    prepare(f, {
      execute: async (...args) => {
        await f.execute(...args);
        const argv = args[1],
          temporary = argv[argv.indexOf('-Destination') + 1];
        writeFileSync(path.join(temporary, 'yamnet.data'), 'corrupted-model');
      },
    }),
    /verification failed/,
  );
  assert.equal(
    existsSync(path.join(f.root, 'data/models/music-detector', f.config.id, 'yamnet.onnx')),
    false,
  );
});

test('download checksums and approved official origin block altered or redirected archives', async () => {
  const modified = fixture();
  const tampered = Buffer.from(modified.archive);
  tampered[0] ^= 1;
  await assert.rejects(
    prepare(modified, {
      fetchImpl: async () =>
        new Response(tampered, { headers: { 'content-length': String(tampered.length) } }),
    }),
    /checksum/,
  );
  assert.equal(modified.extractions(), 0);
  const foreign = fixture();
  foreign.config.artifact.urls = ['https://example.invalid/music.zip'];
  foreign.save();
  await assert.rejects(
    prepare(foreign, {
      fetchImpl: () => assert.fail('Unapproved download must never be requested'),
    }),
    /Unapproved/,
  );
  const redirect = fixture();
  await assert.rejects(
    prepare(redirect, {
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.invalid/music.zip' },
        }),
    }),
    /Unapproved/,
  );
  assert.equal(redirect.extractions(), 0);
});

test('preparation cancellation and missing local Python never publish a detector', async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(prepare(f, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.downloads(), 0);
  const empty = mkdtempSync(path.join(parent, 'missing-python-'));
  mkdirSync(path.join(empty, 'config'));
  writeFileSync(path.join(empty, 'config/music-detector.json'), JSON.stringify(f.config));
  assert.equal(musicPython(empty), null);
  await assert.rejects(prepareMusicDetector(empty), /Run Capri Setup again/);
});
