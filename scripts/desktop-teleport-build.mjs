// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const helperName = 'capri-teleport.exe';
const crate = 'native/desktop-teleport';

/**
 * Builds the Rust teleport helper and copies it to the path the desktop app
 * looks for (.runtime/desktop-teleport). Returns that destination path.
 */
export function buildDesktopTeleport(
  root,
  { run = spawnSync, copy = copyFileSync, mkdir = mkdirSync } = {},
) {
  const result = run(
    'cargo',
    ['build', '--release', '--locked', '--manifest-path', path.join(root, crate, 'Cargo.toml')],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo build failed with status ${result.status}`);
  }
  const built = path.join(root, crate, 'target', 'release', helperName);
  const destination = path.join(root, '.runtime', 'desktop-teleport', helperName);
  mkdir(path.dirname(destination), { recursive: true });
  copy(built, destination);
  return destination;
}
