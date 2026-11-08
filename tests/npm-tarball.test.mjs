// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { nodePath } from '../packages/runtime/src/host/executables.mjs';
import { settings } from '../packages/runtime/src/config/settings.mjs';
import { runCommand } from '../packages/installer/src/commands.mjs';
import { installNpmDependencies } from '../packages/installer/src/npm-install.mjs';
import {
  downloadNpmTarball,
  recoverNpmTarball,
  npmTarballUrl,
} from '../packages/installer/src/npm-tarball.mjs';

const parent = path.join(root, '.runtime/npm-resume-unit');
mkdirSync(parent, { recursive: true });
const folder = () => mkdtempSync(path.join(parent, 'case-'));
const integrity = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const resolved =
  'https://registry.npmjs.org/capri-network-fixture/-/capri-network-fixture-1.0.0.tgz';
const node = [
  process.execPath,
  nodePath,
  path.join(root, '.runtime', `node-v${settings.nodeVersion}-win-x64/node.exe`),
].find(
  (name) => name && existsSync(path.join(path.dirname(name), 'node_modules/npm/bin/npm-cli.js')),
);
function tarEntry(name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value),
    header = Buffer.alloc(512);
  header.write(name);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(
    header
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, '0') + '\0 ',
    148,
  );
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
}

test('recovery caches every pinned failed tarball mentioned by npm, including duplicate lock entries', async () => {
  const location = folder();
  const specs = ['first', 'second'].map((name) => ({
    resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
    integrity: integrity(Buffer.from(name)),
  }));
  writeFileSync(
    path.join(location, 'package-lock.json'),
    JSON.stringify({ packages: { a: specs[0], b: specs[1], nested: specs[0] } }),
  );
  const cached = [];
  await recoverNpmTarball({
    root: location,
    error: { outputTail: specs.map((s) => s.resolved).join('\n') },
    nodeExecutable: process.execPath,
    command: async (_exe, args) => cached.push(readFileSync(args[3], 'utf8')),
    fetchImpl: async (url) => new Response(url.pathname.includes('/first/') ? 'first' : 'second'),
  });
  assert.deepEqual(cached, ['first', 'second']);
});

test(
  'a real npm install recovers its interrupted tarball by Range and SHA-512, then works offline from cache',
  { skip: !node },
  async (t) => {
    const location = folder(),
      packageJson = { name: 'capri-network-fixture', version: '1.0.0', main: 'index.js' };
    const archive = gzipSync(
      Buffer.concat([
        tarEntry('package/package.json', JSON.stringify(packageJson)),
        tarEntry('package/index.js', 'module.exports = 7;'),
        tarEntry('package/payload.bin', randomBytes(200000)),
        Buffer.alloc(1024),
      ]),
    );
    const offsets = [];
    const server = createServer((req, res) => {
      const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range)?.[1] ?? 0);
      offsets.push(start);
      res.writeHead(206, {
        'content-length': archive.length - start,
        'content-range': `bytes ${start}-${archive.length - 1}/${archive.length}`,
      });
      if (offsets.length === 1) {
        res.write(archive.subarray(0, 100000));
        setTimeout(() => res.destroy(), 30);
      } else res.end(archive.subarray(start));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const fetchImpl = (_url, options) =>
      fetch(`http://127.0.0.1:${server.address().port}`, options);
    const base = {
      name: 'capri-resume-fixture',
      version: '1.0.0',
      private: true,
      dependencies: { [packageJson.name]: '1.0.0' },
    };
    writeFileSync(path.join(location, 'package.json'), JSON.stringify(base));
    const lock = JSON.stringify({
      name: base.name,
      version: base.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': base,
        ['node_modules/' + packageJson.name]: {
          version: '1.0.0',
          resolved,
          integrity: integrity(archive),
        },
      },
    });
    writeFileSync(path.join(location, 'package-lock.json'), lock);
    mkdirSync(path.join(location, 'data'));
    writeFileSync(path.join(location, 'data/private.txt'), 'user data preserved');
    let ci = 0,
      seeded = 0;
    const command = async (executable, args) => {
      if (args[1] === 'ci' && ++ci === 1)
        throw Object.assign(
          new Error(
            'npm error code ECONNRESET\nnpm error network request to ' + resolved + ' failed',
          ),
          { exitCode: 1 },
        );
      if (args[1] === 'cache') seeded++;
      await runCommand(
        executable,
        [...args, ...(args[1] === 'ci' ? ['--offline', '--ignore-scripts'] : [])],
        {
          cwd: location,
          timeoutMs: 20000,
          env: {
            ...process.env,
            npm_config_cache: path.join(location, '.runtime/npm-cache'),
            npm_config_update_notifier: 'false',
          },
        },
      );
    };
    await installNpmDependencies({
      nodeExecutable: node,
      root: location,
      command,
      sleep: async () => {},
      recover: (options) => recoverNpmTarball({ ...options, fetchImpl }),
    });
    assert.equal(ci, 2);
    assert.equal(seeded, 1);
    assert.ok(
      offsets.some((offset) => offset > 0),
      'must reuse the bytes received before reset',
    );
    assert.equal(readFileSync(path.join(location, 'package-lock.json'), 'utf8'), lock);
    assert.equal(
      readFileSync(path.join(location, 'data/private.txt'), 'utf8'),
      'user data preserved',
    );
    assert.equal(
      readFileSync(path.join(location, 'node_modules/capri-network-fixture/index.js'), 'utf8'),
      'module.exports = 7;',
    );
  },
);

test('tarball recovery rejects unapproved hosts, bad ranges and integrity without trusting returned data', async () => {
  for (const value of [
    'http://registry.npmjs.org/a.tgz',
    'https://example.org/a.tgz',
    'https://user:secret@registry.npmjs.org/a.tgz',
  ])
    assert.throws(() => npmTarballUrl(value));
  const spec = { resolved, integrity: integrity(Buffer.from('expected archive')) };
  await assert.rejects(
    downloadNpmTarball(spec, folder(), { fetchImpl: async () => new Response('wrong archive') }),
    { code: 'NPM_INTEGRITY_MISMATCH' },
  );
  await assert.rejects(
    downloadNpmTarball(spec, folder(), {
      fetchImpl: async () =>
        new Response('wrong', { status: 206, headers: { 'content-range': 'bytes 9-13/14' } }),
    }),
    /Invalid.*range/,
  );
  let requests = 0;
  await assert.rejects(
    downloadNpmTarball(spec, folder(), {
      fetchImpl: async () => {
        requests++;
        return new Response('', { status: 403 });
      },
    }),
    /HTTP 403/,
  );
  assert.equal(requests, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    downloadNpmTarball(spec, folder(), {
      signal: controller.signal,
      fetchImpl: async () => assert.fail('request after cancel'),
    }),
  );
});
