// SPDX-License-Identifier: GPL-3.0-only
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

/** Keep disposable test installations together and clean up even after failed assertions. */
export function temporaryFolders(prefix, base = tmpdir()) {
  mkdirSync(base, { recursive: true });
  const parent = realpathSync.native(base);
  let directory;
  after(() => {
    if (!directory) return;
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (!info) return;
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      path.dirname(directory) !== parent ||
      realpathSync.native(directory) !== directory
    )
      throw new Error('Refusing to clean a replaced test directory: ' + directory);
    rmSync(directory, { recursive: true, maxRetries: 5 });
  });
  return () => {
    directory ??= mkdtempSync(path.join(parent, prefix));
    return mkdtempSync(path.join(directory, 'case-'));
  };
}
