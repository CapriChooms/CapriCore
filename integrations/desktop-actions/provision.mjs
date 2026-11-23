import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// OpenClaw imports a captured module graph before register() provides the real root.
// Do not load installation configuration/executables from that temporary graph.
import { root as defaultRoot } from '../../packages/runtime/src/host/paths.mjs';
export function ensureDesktopActions(root = defaultRoot, { rebuild = false } = {}) {
  if (process.platform !== 'win32') throw new Error('Desktop application actions require Windows.');
  const source = path.join(root, 'integrations/desktop-actions/native/DesktopActions.cs');
  const sourceSha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
  const directory = path.join(root, '.runtime/desktop-actions', sourceSha256.slice(0, 16));
  mkdirSync(directory, { recursive: true });
  const framework = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319',
  );
  const executable = path.join(directory, 'Capri.DesktopActions.exe');
  if (rebuild || !existsSync(executable))
    execFileSync(
      path.join(framework, 'csc.exe'),
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/out:' + executable,
        '/r:System.Web.Extensions.dll',
        '/r:Microsoft.CSharp.dll',
        ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
          (n) => '/r:' + path.join(framework, 'WPF', n + '.dll'),
        ),
        source,
      ],
      { windowsHide: true, stdio: 'inherit', timeout: 20000 },
    );
  writeFileSync(
    path.join(root, '.runtime/desktop-actions/build.json'),
    JSON.stringify({
      sourceSha256,
      artifact: path.relative(path.join(root, '.runtime/desktop-actions'), executable),
      executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
    }),
  );
  return executable;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureDesktopActions();
  console.log(
    'Fixed Windows application bridge built. Application permissions remain off by default.',
  );
}
