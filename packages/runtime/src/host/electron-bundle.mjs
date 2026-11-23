// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const ELECTRON_RUNTIME_FILES = [
  'electron.exe',
  'icudtl.dat',
  'resources.pak',
  'v8_context_snapshot.bin',
  'locales/en-US.pak',
];

/** Inspect without requiring Electron: recent versions download lazily on require(). */
export function electronBundleReady(packageDirectory, expectedVersion) {
  try {
    const version = JSON.parse(
      readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
    ).version;
    if (!version || (expectedVersion && version !== expectedVersion)) return false;
    if (
      readFileSync(path.join(packageDirectory, 'dist/version'), 'utf8').trim().replace(/^v/, '') !==
      version
    )
      return false;
    return ELECTRON_RUNTIME_FILES.every((name) => {
      const entry = statSync(path.join(packageDirectory, 'dist', name));
      return entry.isFile() && entry.size > 0;
    });
  } catch {
    return false;
  }
}
