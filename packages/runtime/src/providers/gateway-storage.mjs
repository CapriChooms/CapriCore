// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runCli } from '../client.mjs';
import { settings } from '../config/settings.mjs';
import { openclawPath } from '../host/executables.mjs';
import { assertPrivatePath } from '../safe-file.mjs';

const migrationTarget = 27;
const pending = new Map();

function agentSchema(database) {
  const stat = lstatSync(database, { throwIfNoEntry: false });
  if (!stat) return null;
  assertPrivatePath(database);
  if (!stat.isFile() || stat.nlink !== 1)
    throw new Error('The conversation database is not a private file.');
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db.prepare('PRAGMA user_version').get().user_version;
  } finally {
    db.close();
  }
}

export async function migrateGatewayStorage(
  rt,
  { signal, run = runCli, manifest = path.join(path.dirname(openclawPath), 'package.json') } = {},
) {
  signal?.throwIfAborted();
  const database = path.join(
    rt.stateDir,
    'agents',
    settings.agentId,
    'agent/openclaw-agent.sqlite',
  );
  if (!existsSync(database)) return;
  const existing = pending.get(database);
  if (existing) return existing;

  const migrate = async () => {
    // Schema 27 changes session identities. OpenClaw requires its offline
    // migration for existing schema 25/26 databases and makes SQLite backups.
    const schema = agentSchema(database);
    if (schema !== 25 && schema !== 26) return;
    const { openclaw } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (openclaw?.schemaVersions?.agent !== migrationTarget) return;
    await run(['doctor', '--fix', '--yes', '--non-interactive'], rt, { signal });
    if (agentSchema(database) !== migrationTarget)
      throw new Error('OpenClaw did not finish the session schema migration.');
  };
  const result = migrate()
    .catch(() => {
      signal?.throwIfAborted();
      throw Object.assign(new Error("Capri couldn't upgrade its saved conversation database."), {
        code: 'CAPRI_GATEWAY_STORAGE_MIGRATION_FAILED',
      });
    })
    .finally(() => pending.delete(database));
  pending.set(database, result);
  return result;
}
