// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applyDependencySecurityPatches } from '../packages/runtime/src/providers/dependency-security.mjs';

const root = path.resolve('.');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'config/dependency-security-patches.json'), 'utf8'),
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const require = createRequire(import.meta.url);

function fixture() {
  const parent = path.join(root, '.runtime/test-data/dependency-security');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'fixture-'));
  for (const target of manifest.targets) {
    const file = path.join(directory, target.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let source = fs.readFileSync(path.join(root, target.file), 'utf8');
    if (hash(source) === target.afterSha256)
      for (const edit of target.edits.slice().reverse())
        source = source.split(edit.after).join(edit.before);
    assert.equal(hash(source), target.beforeSha256);
    fs.writeFileSync(file, source);
    const packageFile = path.join(directory, target.packageFile);
    fs.mkdirSync(path.dirname(packageFile), { recursive: true });
    fs.writeFileSync(
      packageFile,
      JSON.stringify({ name: target.package, version: target.version }),
    );
  }
  return directory;
}

test('security backports preflight all vendor hashes, are idempotent, and retain truthful upstream versions', () => {
  const directory = fixture();
  const first = applyDependencySecurityPatches(directory, { manifest });
  assert.equal(first.changed, 8);
  assert.equal(first.targets.filter((item) => item.advisories.length === 2).length, 2);
  assert.equal(applyDependencySecurityPatches(directory, { manifest }).changed, 0);
  for (const target of manifest.targets) {
    assert.equal(hash(fs.readFileSync(path.join(directory, target.file))), target.afterSha256);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, target.packageFile), 'utf8')).version,
      target.version,
    );
  }
});

test('unknown source, versions and duplicate targets fail before any reviewed vendor file is overwritten', () => {
  const directory = fixture();
  const last = path.join(directory, manifest.targets.at(-1).file);
  fs.appendFileSync(last, '\n/* synthetic unknown source */');
  assert.throws(() => applyDependencySecurityPatches(directory, { manifest }), /differs/);
  for (const target of manifest.targets.slice(0, -1))
    assert.equal(hash(fs.readFileSync(path.join(directory, target.file))), target.beforeSha256);
  assert.throws(
    () =>
      applyDependencySecurityPatches(directory, { manifest: { schemaVersion: 1, targets: [] } }),
    /manifest/,
  );
  assert.throws(
    () =>
      applyDependencySecurityPatches(directory, {
        manifest: { schemaVersion: 1, targets: [manifest.targets[0], manifest.targets[0]] },
      }),
    /Duplicate/,
  );
  const changedVersion = fixture();
  fs.writeFileSync(
    path.join(changedVersion, manifest.targets.at(-1).packageFile),
    JSON.stringify({ name: 'glob', version: '999.0.0' }),
  );
  assert.throws(() => applyDependencySecurityPatches(changedVersion, { manifest }), /version/);
  for (const target of manifest.targets)
    assert.equal(
      hash(fs.readFileSync(path.join(changedVersion, target.file))),
      target.beforeSha256,
    );
  assert.throws(
    () =>
      applyDependencySecurityPatches(fixture(), {
        manifest: { ...manifest, targets: [{ ...manifest.targets[0], file: '../outside.js' }] },
      }),
    /path/,
  );
});

test('installed minimatch CJS and ESM copies bound amplification while keeping the v10 public APIs', async () => {
  for (const directory of ['node_modules/minimatch', 'node_modules/npm/node_modules/minimatch']) {
    const cjs = require(path.join(root, directory));
    const esm = await import(pathToFileURL(path.join(root, directory, 'dist/esm/index.js')).href);
    for (const api of [cjs, esm]) {
      assert.equal(typeof api.makeRe, 'function');
      assert.equal(typeof api.AST, 'function');
      const expanded = new api.Minimatch(Array(12).fill('**/../a/b').join('/'), {
        optimizationLevel: 2,
        braceExpandMax: 64,
      });
      assert.equal(expanded.set.length, 64);
      const ordinary = new api.Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
      assert.equal(ordinary.set.length, 4);
      assert.equal(ordinary.match('x/a/b/y/c/d'), true);
      assert.ok(new api.Minimatch('/usr/lib/*/foo').set[0].some((part) => part instanceof RegExp));
      const large = new api.Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
      assert.equal(large.set.length, 2000);
      assert.equal(large.match('y/999'), true);
    }
  }
});

test('glob public CJS and ESM bundles also patch their inlined minimatch copies', async () => {
  const directory = path.join(root, 'node_modules/npm/node_modules/glob');
  const cjs = require(directory);
  const esm = await import(pathToFileURL(path.join(directory, 'dist/esm/index.min.js')).href);
  for (const api of [cjs, esm]) {
    const parsed = new api.Glob(Array(12).fill('**/../a/b').join('/'), { braceExpandMax: 64 });
    assert.equal(parsed.patterns.length, 64);
  }
});

test('glob cancellation stops new filesystem reads in both public module formats', async () => {
  const parent = path.join(root, '.runtime/test-data/dependency-security');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'walk-'));
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const child = path.join(directory, String(i), String(j));
      fs.mkdirSync(child, { recursive: true });
      fs.writeFileSync(path.join(child, 'fixture.txt'), 'Public fixture');
    }
  const moduleRoot = path.join(root, 'node_modules/npm/node_modules/glob');
  for (const api of [
    require(moduleRoot),
    await import(pathToFileURL(path.join(moduleRoot, 'dist/esm/index.min.js')).href),
  ]) {
    let calls = 0;
    const controller = new AbortController();
    const fixtureFs = {
      ...fs,
      readdir(file, options, callback) {
        calls++;
        fs.readdir(file, options, (error, entries) => {
          if (!controller.signal.aborted) controller.abort(new Error('Synthetic cancellation'));
          callback(error, entries);
        });
      },
    };
    await assert.rejects(
      api.glob('**/*.txt', { cwd: directory, fs: fixtureFs, signal: controller.signal }),
      /Synthetic cancellation/,
    );
    const atReject = calls;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, atReject);
    assert.ok(calls <= 1, 'aborted traversal must not schedule child directories');
  }
});
