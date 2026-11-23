// SPDX-License-Identifier: GPL-3.0-only
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { runCommand } from '../../installer/src/commands.mjs';
import { noLinks } from '../../installer/src/policy.mjs';
import { fileHash } from '../../installer/src/download.mjs';
import { verifyPayload } from './transaction.mjs';
export async function stageUpdate({ root, archive, asset, tag }, { execute = runCommand } = {}) {
  noLinks(archive);
  if ((await fileHash(archive)) !== asset.sha256)
    throw new Error('Update archive checksum verification failed');
  const parent = path.join(root, '.runtime/updates/staged');
  noLinks(parent);
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'release-'));
  // The existing extractor rejects traversal, duplicate entries and filesystem links.
  await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'packages/installer/windows/archive.ps1'),
      '-Archive',
      archive,
      '-Destination',
      folder,
      '-MaximumBytes',
      String(512 * 1024 ** 2),
    ],
    { cwd: root, env: process.env, timeoutMs: 120000 },
  );
  verifyPayload(folder, tag);
  return folder;
}
