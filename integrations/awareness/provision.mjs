import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from '../../packages/runtime/src/index.mjs';
export function ensureAwareness() {
  if (process.platform !== 'win32') throw new Error('Windows event awareness requires Windows.');
  const source = path.join(root, 'integrations/awareness/native/WindowsEvents.cs'),
    hash = (value) => createHash('sha256').update(value).digest('hex');
  const sourceSha256 = hash(readFileSync(source)),
    directory = path.join(root, '.runtime/awareness', sourceSha256.slice(0, 16));
  mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, 'Capri.WindowsEvents.exe');
  if (!existsSync(executable))
    execFileSync(
      path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
      ),
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/out:' + executable,
        '/r:System.Web.Extensions.dll',
        '/r:System.Windows.Forms.dll',
        source,
      ],
      { windowsHide: true, stdio: 'inherit' },
    );
  writeFileSync(
    path.join(root, '.runtime/awareness/build.json'),
    JSON.stringify({
      sourceSha256,
      artifact: path.relative(path.join(root, '.runtime/awareness'), executable),
      executableSha256: hash(readFileSync(executable)),
    }),
  );
  return executable;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureAwareness();
  console.log('Windows metadata observer built. Observation remains opt-in.');
}
