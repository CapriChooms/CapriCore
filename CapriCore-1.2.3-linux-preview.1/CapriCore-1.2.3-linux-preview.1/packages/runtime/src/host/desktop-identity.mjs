// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { root } from './paths.mjs';
import { writeJsonAtomic } from '../atomic-json.mjs';
const execute = promisify(execFile);

export const applicationId = (directory = root) =>
  'Overyx.Capri.' +
  createHash('sha256').update(path.resolve(directory).toLowerCase()).digest('hex').slice(0, 16);

/** Private branded Electron copy; original dependency binaries stay untouched. */
export async function ensureDesktopIdentity(electronPath) {
  if (process.platform !== 'win32') return electronPath;
  if (
    !path
      .resolve(realpathSync(electronPath))
      .toLowerCase()
      .startsWith(path.resolve(realpathSync(root)).toLowerCase() + path.sep)
  )
    throw new Error('Desktop runtime must belong to this installation.');
  const receipt = path.join(root, '.runtime/desktop-identity/receipt.json');
  const source = statSync(electronPath);
  const signature = createHash('sha256');
  for (const file of [
    'package.json',
    'assets/default/app.ico',
    'packages/installer/windows/desktop-branding.cs',
    'tools/setup/prepare-desktop-identity.ps1',
    'packages/runtime/src/host/desktop-identity.mjs',
  ])
    signature.update(readFileSync(path.join(root, file)));
  signature.update(`${source.size}:${source.mtimeMs}`);
  const expected = signature.digest('hex');
  const executable = path.join(path.dirname(electronPath), 'Capri.exe');
  try {
    if (existsSync(executable) && JSON.parse(readFileSync(receipt, 'utf8')).signature === expected)
      return executable;
  } catch {
    /* A dependency update or missing receipt requires a new private copy. */
  }
  await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'tools/setup/prepare-desktop-identity.ps1'),
      '-InstallRoot',
      root,
      '-ElectronPath',
      electronPath,
      '-OutputPath',
      executable,
      '-Signature',
      expected,
    ],
    { windowsHide: true, timeout: 60000, maxBuffer: 65536 },
  );
  writeJsonAtomic(receipt, { schemaVersion: 1, signature: expected });
  return executable;
}
