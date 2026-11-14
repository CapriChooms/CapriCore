// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { UpdateService } from '../apps/desktop/update-service.mjs';
import { runtimeUpgradeRequired, verifyPayload } from '../packages/updater/src/transaction.mjs';
import { installerRequired } from '../packages/updater/src/payload-policy.mjs';

const parent = path.join(root, '.runtime/update-installer-fallback');
mkdirSync(parent, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};

test('a changed local inference runtime requires the full installer', () => {
  const installRoot = mkdtempSync(path.join(parent, 'runtime-from-'));
  const sourceRoot = mkdtempSync(path.join(parent, 'runtime-to-'));
  const runtime = (dir, artifacts) => json(path.join(dir, 'config/installer.json'), { artifacts });
  runtime(installRoot, { ollama: { sha256: 'old' } });
  runtime(sourceRoot, { llama: { sha256: 'new' } });
  assert.equal(runtimeUpgradeRequired(installRoot, sourceRoot), true);
  runtime(installRoot, { llama: { sha256: 'new' } });
  assert.equal(runtimeUpgradeRequired(installRoot, sourceRoot), false);
  runtime(sourceRoot, { llama: { sha256: 'newer' } });
  assert.equal(runtimeUpgradeRequired(installRoot, sourceRoot), true);
});

function fixture({ installer = true, stage, download, launch } = {}) {
  const installRoot = mkdtempSync(path.join(parent, 'case-'));
  const privateFile = path.join(installRoot, 'data/desktop/fixture-private-state.json');
  json(privateFile, { fixture: 'synthetic conversation and model selection retained' });
  const privateBytes = readFileSync(privateFile);
  json(path.join(installRoot, 'package.json'), { name: 'capri', version: '0.4.6' });
  json(path.join(installRoot, 'config/release.json'), {
    schemaVersion: 1,
    repository: 'CapriChooms/Capri',
    tag: 'v0.4.6',
  });
  json(path.join(installRoot, '.capri-install.json'), {
    schemaVersion: 1,
    productId: 'capri.desktop',
    root: installRoot,
    version: '0.4.6',
    installId: randomUUID(),
  });
  const bytes = new Map([
    [1, Buffer.from('synthetic source archive')],
    [2, Buffer.from('synthetic installer bytes; never executed')],
  ]);
  const release = {
    tag_name: 'v0.5.1',
    prerelease: false,
    draft: false,
    assets: [
      { id: 1, name: 'Capri-0.5.1-source.zip' },
      ...(installer ? [{ id: 2, name: 'CapriSetup-0.5.1.exe' }] : []),
    ].map((asset) => ({
      ...asset,
      state: 'uploaded',
      size: bytes.get(asset.id).length,
      digest: 'sha256:' + hash(bytes.get(asset.id)),
    })),
  };
  const state = { downloads: [], launches: [], shutdowns: 0, events: [] };
  const service = new UpdateService({
    root: installRoot,
    state: path.join(installRoot, 'data/desktop'),
    node: process.execPath,
    credential: async () => null,
    releases: async () => [release],
    stage:
      stage ??
      (async () => {
        throw installerRequired('unsupported_source_path');
      }),
    download: async (asset, directory, options) => {
      state.downloads.push(asset.id);
      await download?.(asset, options, service);
      options.signal.throwIfAborted();
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, asset.sha256 + '.zip');
      writeFileSync(file, bytes.get(asset.id));
      return file;
    },
    launch: (...args) => {
      state.launches.push(args);
      if (launch) return launch(...args);
      assert.fail('No update preparation may launch an executable.');
    },
    emit: (event) => state.events.push(event),
  });
  const unchanged = () => assert.deepEqual(readFileSync(privateFile), privateBytes);
  return {
    service,
    installRoot,
    state,
    unchanged,
    shutdown: async () => {
      state.shutdowns++;
    },
  };
}

test('a compatible verified full installer is prepared after a source layout incompatibility, without closing Capri', async () => {
  const f = fixture();
  try {
    assert.equal(f.service.mode, 'managed');
    assert.equal((await f.service.check()).phase, 'available');
    const result = await f.service.prepare();
    assert.equal(result.phase, 'ready');
    assert.equal(result.installerRequired, true);
    assert.equal(result.installerReason, 'compatibility');
    assert.equal(result.error, null);
    assert.deepEqual(f.state.downloads, [1, 2]);
    assert.equal(f.state.launches.length, 0);
    assert.equal(f.state.shutdowns, 0);
    assert.equal(f.service.prepared.asset.id, 2);
    assert.equal(
      hash(readFileSync(f.service.prepared.executable)),
      f.service.prepared.asset.sha256,
    );
    f.unchanged();
  } finally {
    f.service.close();
  }
});

test('a future manifest schema takes the separately verified installer route', async () => {
  const source = mkdtempSync(path.join(parent, 'future-source-'));
  json(path.join(source, 'SOURCE_MANIFEST.json'), { schemaVersion: 2, files: [] });
  const f = fixture({ stage: async () => verifyPayload(source, 'v0.5.1') });
  try {
    await f.service.check();
    const result = await f.service.prepare();
    assert.equal(result.phase, 'ready');
    assert.equal(result.installerReason, 'compatibility');
    assert.deepEqual(f.state.downloads, [1, 2]);
    f.unchanged();
  } finally {
    f.service.close();
  }
});

test('source incompatibility without a verified installer stays an error and does not close Capri', async () => {
  const f = fixture({ installer: false });
  try {
    await f.service.check();
    const result = await f.service.prepare();
    assert.equal(result.phase, 'error');
    assert.match(result.error, /no verified installer/i);
    assert.equal(f.service.prepared, null);
    assert.deepEqual(f.state.downloads, [1]);
    assert.equal(f.state.launches.length, 0);
    assert.equal(f.state.shutdowns, 0);
    f.unchanged();
  } finally {
    f.service.close();
  }
});

test('checksum, unsafe path and malformed manifest failures cannot silently become installer downloads', async () => {
  for (const message of [
    'Update source checksum verification failed',
    'Unsafe update file path',
    'Invalid source update manifest entry',
    'Invalid source update manifest',
  ]) {
    const f = fixture({
      stage: async () => {
        throw Error(message);
      },
    });
    try {
      await f.service.check();
      const result = await f.service.prepare();
      assert.equal(result.phase, 'error');
      assert.equal(result.error, message);
      assert.deepEqual(f.state.downloads, [1]);
      assert.equal(f.service.prepared, null);
      assert.equal(f.state.launches.length, 0);
      assert.equal(f.state.shutdowns, 0);
      f.unchanged();
    } finally {
      f.service.close();
    }
  }
});

test('cancellation during staging or installer fallback cannot leave a prepared update or close Capri', async () => {
  for (const phase of ['stage', 'fallback-download']) {
    let reached, resume;
    const started = new Promise((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise((resolve) => {
      resume = resolve;
    });
    const f = fixture({
      stage: async () => {
        if (phase === 'stage') {
          reached();
          await proceed;
        }
        throw installerRequired('payload_format');
      },
      download: async (asset) => {
        if (phase === 'fallback-download' && asset.id === 2) {
          reached();
          await proceed;
        }
      },
    });
    try {
      await f.service.check();
      const work = f.service.prepare();
      await started;
      f.service.cancel();
      resume();
      const result = await work;
      assert.equal(result.phase, 'available');
      assert.equal(result.error, null);
      assert.equal(f.service.prepared, null);
      assert.equal(f.service.busy(), false);
      assert.deepEqual(f.state.downloads, phase === 'stage' ? [1] : [1, 2]);
      assert.equal(f.state.launches.length, 0);
      assert.equal(f.state.shutdowns, 0);
      f.unchanged();
    } finally {
      f.service.close();
    }
  }
});

test('an installer spawn failure leaves Capri running and the verified fallback ready to retry', async () => {
  const f = fixture({
    launch: () => {
      const child = Object.assign(new EventEmitter(), {
        unref() {
          assert.fail('Failed child must not detach');
        },
      });
      setImmediate(() => child.emit('error', Error('Fixture installer launch failed')));
      return child;
    },
  });
  try {
    await f.service.check();
    await f.service.prepare();
    const before = f.service.prepared;
    await assert.rejects(
      f.service.install({ parentPid: process.pid, language: 'en', shutdown: f.shutdown }),
      /Fixture installer launch failed/,
    );
    assert.equal(f.service.snapshot().phase, 'ready');
    assert.equal(f.service.busy(), false);
    assert.equal(f.service.handoff, false);
    assert.equal(f.service.prepared, before);
    assert.equal(f.state.shutdowns, 0);
    assert.equal(f.state.launches.length, 1);
    assert.equal(f.state.launches[0][2].windowsHide, true);
    f.unchanged();
  } finally {
    f.service.close();
  }
});
