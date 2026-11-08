// SPDX-License-Identifier: GPL-3.0-only
import { openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks, readJson } from './policy.mjs';
export function installationLock(cache) {
  const file = path.join(cache, 'install.lock.json');
  noLinks(file);
  const record = { pid: process.pid, id: randomUUID() };
  let descriptor;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      descriptor = openSync(file, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = readJson(file);
      if (!Number.isInteger(old.pid) || old.pid <= 0)
        throw new Error('An interrupted installer lock could not be validated');
      try {
        process.kill(old.pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          unlinkSync(file);
          continue;
        }
        throw error;
      }
      throw new Error('Another installation process is working on this folder');
    }
  }
  if (descriptor === undefined) throw new Error('Could not acquire the installation lock');
  try {
    writeFileSync(descriptor, JSON.stringify(record));
  } finally {
    closeSync(descriptor);
  }
  return () => {
    if (readJson(file).id === record.id) unlinkSync(file);
  };
}
