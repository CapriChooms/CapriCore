// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { nodePath } from '../packages/runtime/src/host/executables.mjs';
import { settings } from '../packages/runtime/src/config/settings.mjs';
import {
  installNpmDependencies,
  npmNetworkFailure,
} from '../packages/installer/src/npm-install.mjs';
import { runCommand } from '../packages/installer/src/commands.mjs';

const failure = (code, warning = '') =>
  Object.assign(new Error('Component exited 1'), {
    exitCode: 1,
    outputTail: `${warning}\nnpm error code ${code}\nnpm error network request failed`,
  });

test('npm failure classification uses fatal codes and never mistakes cleanup warnings for the cause', () => {
  assert.equal(
    npmNetworkFailure(
      failure('ECONNRESET', "npm warn cleanup [Error: EPERM: rmdir 'node_modules']"),
    ),
    'ECONNRESET',
  );
  assert.equal(npmNetworkFailure(new Error('npm ERR! code EAI_AGAIN')), 'EAI_AGAIN');
  for (const code of [
    'EPERM',
    'EACCES',
    'EINTEGRITY',
    'EBADENGINE',
    'ENOSPC',
    'ERESOLVE',
    'E401',
    'E403',
    'E404',
    'ETARGET',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ])
    assert.equal(npmNetworkFailure(failure(code, 'npm warn network ECONNRESET')), null, code);
  assert.equal(
    npmNetworkFailure(failure('1', 'npm error code ECONNRESET')),
    null,
    'lifecycle failures are not automatically replayed',
  );
  assert.equal(npmNetworkFailure(new Error('unknown install failure')), null);
  assert.equal(npmNetworkFailure(Object.assign(failure('ECONNRESET'), { exitCode: 130 })), null);
});

test('transient npm failure retries the same locked installation with cached packages and lower concurrency', async () => {
  const calls = [],
    retries = [],
    sleeps = [];
  await installNpmDependencies({
    nodeExecutable: process.execPath,
    command: async (exe, args) => {
      calls.push({ exe, args });
      assert.equal(args[1], 'ci');
      assert.ok(args.includes('--prefer-offline'));
      assert.ok(!args.some((arg) => /strict-ssl=false|registry=|ignore-scripts|update/.test(arg)));
      if (calls.length === 1) throw failure('ECONNRESET');
    },
    onRetry: (value) => retries.push(value),
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes('--maxsockets=4'));
  assert.deepEqual(sleeps, [2000]);
  assert.deepEqual(retries, [{ attempt: 2, attempts: 3, delayMs: 2000, code: 'ECONNRESET' }]);
});

test('persistent network failure stops after three attempts and retains its actual npm cause', async () => {
  const original = failure('ETIMEDOUT');
  let calls = 0;
  const sleeps = [];
  await assert.rejects(
    installNpmDependencies({
      nodeExecutable: process.execPath,
      command: async () => {
        calls++;
        throw original;
      },
      sleep: async (ms) => sleeps.push(ms),
    }),
    (error) =>
      error.code === 'NPM_NETWORK_UNAVAILABLE' &&
      error.npmCode === 'ETIMEDOUT' &&
      error.cause === original &&
      /remain cached/.test(error.message),
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
});

test('permanent failure and user cancellation never trigger dependency replay', async () => {
  for (const original of [
    failure('EINTEGRITY'),
    failure('EPERM'),
    new Error('postinstall failed'),
  ]) {
    let calls = 0;
    await assert.rejects(
      installNpmDependencies({
        nodeExecutable: process.execPath,
        command: async () => {
          calls++;
          throw original;
        },
        sleep: () => assert.fail('wait after permanent error'),
      }),
      (error) => error === original,
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    installNpmDependencies({
      nodeExecutable: process.execPath,
      signal: controller.signal,
      command: async () => {
        calls++;
        throw failure('ECONNRESET');
      },
      onRetry: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});

function tarEntry(name, text) {
  const bytes = Buffer.from(text),
    header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257);
  header.write('00', 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
}
const npmNode = [
  process.execPath,
  nodePath,
  path.join(root, '.runtime', `node-v${settings.nodeVersion}-win-x64/node.exe`),
].find((exe) => exe && existsSync(path.join(path.dirname(exe), 'node_modules/npm/bin/npm-cli.js')));

test(
  'real npm recovers from a mid-body reset, verifies the package, then installs offline from its cache',
  { skip: !npmNode },
  async () => {
    const parent = path.join(root, '.runtime/npm-network-unit');
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(path.join(parent, 'case-'));
    const packageJson = {
      name: 'capri-network-fixture',
      version: '1.0.0',
      main: 'index.js',
      license: 'MIT',
    };
    const archive = gzipSync(
      Buffer.concat([
        tarEntry('package/package.json', JSON.stringify(packageJson)),
        tarEntry('package/index.js', 'module.exports = 7;\n'),
        Buffer.alloc(1024),
      ]),
    );
    let attempts = 0,
      requests = 0;
    const server = createServer((req, res) => {
      requests++;
      if (req.url !== '/fixture.tgz') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': archive.length,
      });
      if (attempts === 1) {
        res.flushHeaders();
        res.write(archive.subarray(0, Math.floor(archive.length / 2)));
        setTimeout(() => res.destroy(), 10);
      } else res.end(archive);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const registry = `http://127.0.0.1:${server.address().port}`;
    const base = {
      name: 'capri-install-network-fixture',
      version: '1.0.0',
      private: true,
      dependencies: { 'capri-network-fixture': '1.0.0' },
    };
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify(base));
    const lock = JSON.stringify({
      name: base.name,
      version: base.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': base,
        'node_modules/capri-network-fixture': {
          version: '1.0.0',
          resolved: registry + '/fixture.tgz',
          integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
          license: 'MIT',
        },
      },
    });
    writeFileSync(path.join(folder, 'package-lock.json'), lock);
    const userData = path.join(folder, 'data');
    mkdirSync(userData);
    writeFileSync(path.join(userData, 'canary.txt'), 'private data preserved');
    const retries = [];
    let offline = false;
    try {
      const command = async (exe, args) => {
        attempts++;
        await runCommand(
          exe,
          [
            ...args.map((arg) => (arg === '--fetch-retries=3' ? '--fetch-retries=0' : arg)),
            ...(offline ? ['--offline'] : []),
          ],
          {
            cwd: folder,
            timeoutMs: 20000,
            env: {
              ...process.env,
              npm_config_cache: path.join(folder, 'cache'),
              npm_config_registry: registry,
              npm_config_ignore_scripts: 'true',
              npm_config_update_notifier: 'false',
              npm_config_userconfig: path.join(folder, 'empty-user.npmrc'),
              npm_config_globalconfig: path.join(folder, 'empty-global.npmrc'),
              NO_PROXY: '127.0.0.1,localhost',
            },
          },
        );
      };
      await installNpmDependencies({
        nodeExecutable: npmNode,
        command,
        onRetry: (value) => retries.push(value),
        sleep: async () => {},
      });
      assert.equal(attempts, 2);
      assert.equal(retries.length, 1);
      assert.equal(retries[0].code, 'ECONNRESET');
      assert.ok(requests >= 2);
      assert.equal(
        readFileSync(path.join(folder, 'node_modules/capri-network-fixture/index.js'), 'utf8'),
        'module.exports = 7;\n',
      );
      const received = requests;
      offline = true;
      await installNpmDependencies({ nodeExecutable: npmNode, command });
      assert.equal(requests, received, 'cached installation must not contact the registry');
      assert.equal(readFileSync(path.join(folder, 'package-lock.json'), 'utf8'), lock);
      assert.equal(
        readFileSync(path.join(userData, 'canary.txt'), 'utf8'),
        'private data preserved',
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
