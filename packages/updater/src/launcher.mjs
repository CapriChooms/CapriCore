// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { noLinks } from '../../installer/src/policy.mjs';
import { runCommand } from '../../installer/src/commands.mjs';

// A windowed host has no inherited console that Windows can close with Capri.
// It also owns the PowerShell pipes for the complete lifetime of the update UI.
export async function prepareUpdateHost(root) {
  if (process.platform !== 'win32') throw Error('The update window requires Windows.');
  const source = fileURLToPath(new URL('../windows/update-host.cs', import.meta.url));
  const hash = createHash('sha256').update(readFileSync(source)).digest('hex');
  const folder = path.join(root, '.runtime/updates/host', hash.slice(0, 16));
  const executable = path.join(folder, 'Capri.Update.exe');
  noLinks(executable);
  if (!existsSync(executable)) {
    mkdirSync(folder, { recursive: true });
    await runCommand(
      path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
      ),
      ['/nologo', '/target:winexe', '/optimize+', '/out:' + executable, source],
      { cwd: folder, windowsHide: true, timeoutMs: 30000 },
    );
  }
  return executable;
}
