// SPDX-License-Identifier: GPL-3.0-only
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';

function record(file, maximum) {
  for (let cursor = path.resolve(file); ; cursor = path.dirname(cursor)) {
    const info = lstatSync(cursor);
    if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1))
      throw new Error('Linked update metadata');
    if (cursor === path.dirname(cursor)) break;
  }
  const descriptor = openSync(file, 'r');
  try {
    if (fstatSync(descriptor).size > maximum) throw new Error('Update metadata exceeds its limit');
    return JSON.parse(readFileSync(descriptor, 'utf8').replace(/^\uFEFF/, ''));
  } finally {
    closeSync(descriptor);
  }
}

// A terminal journal is committed only after installation or rollback, including
// dependency repair. Never infer success from age, version or a dead worker alone.
// This check is read-only: the updater owns receipt cleanup under its own lock.
export function updateBlocksStartup(root) {
  const active = path.join(root, '.runtime/updates/active.json');
  if (!existsSync(active)) return false;
  try {
    const pending = record(active, 65536);
    if (pending.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(pending.id ?? '')) return true;
    const journal = record(
      path.join(root, '.runtime/updates/backups', pending.id, 'journal.json'),
      2 * 1024 ** 2,
    );
    if (
      journal.schemaVersion !== 1 ||
      journal.id !== pending.id ||
      !['complete', 'rolled-back'].includes(journal.phase)
    )
      return true;
    const lock = path.join(root, '.runtime/installer/install.lock.json');
    if (!existsSync(lock)) return false;
    const { pid } = record(lock, 65536);
    if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  } catch {
    return true;
  }
}
