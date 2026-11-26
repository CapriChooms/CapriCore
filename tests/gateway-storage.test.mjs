// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempDisposableSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { settings } from '../packages/runtime/src/config/settings.mjs';
import { migrateGatewayStorage } from '../packages/runtime/src/providers/gateway-storage.mjs';

function fixture(directory, target = 27) {
  const stateDir = path.join(directory, 'openclaw');
  const database = path.join(stateDir, 'agents', settings.agentId, 'agent/openclaw-agent.sqlite');
  const manifest = path.join(directory, 'package.json');
  mkdirSync(path.dirname(database), { recursive: true });
  writeFileSync(manifest, JSON.stringify({ openclaw: { schemaVersions: { agent: target } } }));
  return { stateDir, database, manifest };
}

function writeSchema(database, version) {
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA user_version = ' + version);
  } finally {
    db.close();
  }
}

test('an existing schema 25 is migrated once for simultaneous gateway starts', async () => {
  using work = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-gateway-schema-'));
  const { stateDir, database, manifest } = fixture(work.path);
  writeSchema(database, 25);
  const rt = { stateDir };
  let runs = 0;
  const options = {
    manifest,
    async run(args, runtime) {
      assert.equal(runtime, rt);
      assert.deepEqual(args, ['doctor', '--fix', '--yes', '--non-interactive']);
      runs++;
      await Promise.resolve();
      writeSchema(database, 27);
    },
  };
  await Promise.all([migrateGatewayStorage(rt, options), migrateGatewayStorage(rt, options)]);
  await migrateGatewayStorage(rt, options);
  assert.equal(runs, 1);
});

test('startup skips repair for fresh profiles, unchanged runtimes, and newer databases', async () => {
  using work = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-gateway-schema-'));
  const { stateDir, database, manifest } = fixture(work.path, 26);
  const options = { manifest, run: () => assert.fail('Unexpected maintenance') };
  await migrateGatewayStorage({ stateDir }, options);
  writeSchema(database, 25);
  await migrateGatewayStorage({ stateDir }, options);
  fixture(work.path);
  writeSchema(database, 28);
  await migrateGatewayStorage({ stateDir }, options);
});

test('startup reports a safe error if doctor leaves the old database schema unchanged', async () => {
  using work = mkdtempDisposableSync(path.join(realpathSync(tmpdir()), 'capri-gateway-schema-'));
  const { stateDir, database, manifest } = fixture(work.path);
  writeSchema(database, 26);
  await assert.rejects(migrateGatewayStorage({ stateDir }, { manifest, run: async () => {} }), {
    code: 'CAPRI_GATEWAY_STORAGE_MIGRATION_FAILED',
  });
});
