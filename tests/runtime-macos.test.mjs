// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { electronBundleReady } from '../packages/runtime/src/host/electron-bundle.mjs';
import { resourceRoot, runtimeRoot } from '../packages/runtime/src/host/paths.mjs';
import { processStartedAt } from '../packages/runtime/src/host/processes.mjs';
import { applyDependencySecurityPatches } from '../packages/runtime/src/providers/dependency-security.mjs';
import { applyOpenClawCompatibility } from '../packages/runtime/src/providers/openclaw-compat.mjs';

function temporary(t) {
  const directory = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-mac-runtime-'));
  t.after(() => directory.remove());
  return directory.path;
}

function write(root, name, contents) {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

test('the macOS bootstrap selects a separate absolute runtime root', () => {
  const env = { CAPRI_MACOS_RUNTIME_ROOT: path.join(realpathSync(tmpdir()), 'CapriCore') };
  assert.equal(runtimeRoot('/source', { env, platform: 'darwin' }), env.CAPRI_MACOS_RUNTIME_ROOT);
  for (const platform of ['linux', 'win32'])
    assert.equal(runtimeRoot('/source', { env, platform }), '/source');
  assert.equal(runtimeRoot('/source', { env: {}, platform: 'darwin' }), '/source');
  assert.throws(
    () =>
      runtimeRoot('/source', { env: { CAPRI_MACOS_RUNTIME_ROOT: 'relative' }, platform: 'darwin' }),
    /absolute/,
  );
});

test(
  'the packaged runtime initializes secrets, logs and workspace in Application Support',
  {
    skip: process.platform !== 'darwin',
  },
  (t) => {
    const support = temporary(t);
    mkdirSync(path.join(support, 'config'));
    for (const name of ['core.json', 'workspace'])
      cpSync(path.join(resourceRoot, 'config', name), path.join(support, 'config', name), {
        recursive: true,
      });
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import { initialize, paths, resourceRoot, root } from './packages/runtime/src/index.mjs';
    const rt = initialize();
    console.log(JSON.stringify({ root, resourceRoot, configPath: rt.configPath, logs: paths.logs }));
  `,
      ],
      {
        cwd: resourceRoot,
        env: {
          ...process.env,
          CAPRI_MACOS_RUNTIME_ROOT: support,
          CAPRI_NODE_PATH: process.execPath,
        },
        encoding: 'utf8',
      },
    );
    const locations = JSON.parse(result);
    assert.equal(locations.resourceRoot, resourceRoot);
    assert.equal(locations.root, support);
    assert.equal(locations.logs, path.join(support, 'logs'));
    assert.equal(locations.configPath, path.join(support, 'data/openclaw/openclaw.json'));
    for (const file of [
      'data/openclaw/gateway-token',
      'data/workspace/PERSONALITY.md',
      '.runtime/tmp',
      'logs',
    ])
      assert.ok(existsSync(path.join(support, file)), file);
  },
);

test(
  'Darwin process markers identify a particular live process generation',
  {
    skip: process.platform !== 'darwin',
  },
  async () => {
    const stamp = processStartedAt(process.pid);
    assert.match(stamp, /^\d+$/);
    assert.equal(processStartedAt(process.pid), stamp);
    assert.equal(processStartedAt(0x7fffffff), null);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], {
      stdio: 'ignore',
    });
    try {
      await once(child, 'spawn');
      const childStamp = processStartedAt(child.pid);
      assert.match(childStamp, /^\d+$/);
      assert.notEqual(childStamp, stamp);
    } finally {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    assert.equal(processStartedAt(child.pid), null);
  },
);

test(
  'the packaged macOS gateway child disables LAN discovery on existing profiles',
  {
    skip: process.platform !== 'darwin',
  },
  (t) => {
    const support = temporary(t);
    write(support, 'packages/runtime/bin/response-timing-preload.mjs', '');
    write(
      support,
      'node_modules/openclaw/openclaw.mjs',
      'console.log(process.env.OPENCLAW_DISABLE_BONJOUR)',
    );
    const flag = execFileSync(
      process.execPath,
      [path.join(resourceRoot, 'packages/runtime/bin/gateway-host.mjs'), 'fixture'],
      {
        env: {
          ...process.env,
          CAPRI_MACOS_RUNTIME_ROOT: support,
          OPENCLAW_DISABLE_BONJOUR: '0',
          CAPRI_GATEWAY_PORT: '18789',
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(flag.trim(), '1');
  },
);

test('the macOS source launcher recognizes a complete arm64 Electron framework', (t) => {
  const root = temporary(t);
  const framework = 'dist/Electron.app/Contents/Frameworks/Electron Framework.framework/';
  for (const name of ['Electron Framework', 'Resources/icudtl.dat', 'Resources/resources.pak'])
    write(root, framework + name, 'fixture');
  write(root, 'dist/Electron.app/Contents/Info.plist', 'fixture');
  write(root, 'dist/Electron.app/Contents/MacOS/Electron', 'fixture');
  write(root, 'package.json', '{"version":"45.3.1"}');
  write(root, 'dist/version', '45.3.1\n');
  assert.equal(electronBundleReady(root, '45.3.1', 'darwin'), false);
  write(root, framework + 'Resources/v8_context_snapshot.arm64.bin', 'fixture');
  assert.equal(electronBundleReady(root, '45.3.1', 'darwin'), true);
  assert.equal(electronBundleReady(root, '45.3.1', 'win32'), false);
});

test('a packaged installation checks both patch sets without modifying bundle contents', (t) => {
  const root = temporary(t);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const patch = {
    beforeSha256: hash('old'),
    afterSha256: hash('new'),
    edits: [{ before: 'old', after: 'new' }],
  };
  const target = {
    ...patch,
    package: 'glob',
    version: '1.0.0',
    file: 'node_modules/glob/fixture.js',
    packageFile: 'node_modules/glob/package.json',
  };
  const manifest = { schemaVersion: 1, targets: [target] };
  write(root, target.packageFile, JSON.stringify({ name: 'glob', version: target.version }));
  write(root, target.file, 'old');
  write(root, 'node_modules/openclaw/package.json', '{"version":"1.0.0"}');
  write(root, 'node_modules/openclaw/fixture.js', 'old');
  write(
    root,
    'integrations/openclaw-compat/patches.json',
    JSON.stringify({
      version: '1.0.0',
      patches: [{ ...patch, file: 'fixture.js' }],
    }),
  );
  assert.throws(
    () => applyDependencySecurityPatches(root, { manifest, verifyOnly: true }),
    /Rebuild Capri/,
  );
  assert.throws(() => applyOpenClawCompatibility(root, { verifyOnly: true }), /Rebuild Capri/);
  assert.equal(readFileSync(path.join(root, target.file), 'utf8'), 'old');
  assert.equal(readFileSync(path.join(root, 'node_modules/openclaw/fixture.js'), 'utf8'), 'old');
  applyDependencySecurityPatches(root, { manifest });
  applyOpenClawCompatibility(root);
  assert.equal(applyDependencySecurityPatches(root, { manifest, verifyOnly: true }).changed, 0);
  assert.equal(applyOpenClawCompatibility(root, { verifyOnly: true }), false);
});
