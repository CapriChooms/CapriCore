import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../packages/runtime/src/index.mjs';
import { NATIVE_SOURCES, spotifySourceHash } from './native-build.mjs';

if (process.platform !== 'win32')
  throw new Error('Spotify desktop integration requires Windows 10/11.');
const windows = process.env.SystemRoot ?? 'C:\\Windows';
const framework = path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319');
const metadata = path.join(windows, 'System32/WinMetadata');
const gac = path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL');
function facade(name) {
  const folder = path.join(gac, name);
  const file = readdirSync(folder)
    .map((version) => path.join(folder, version, name + '.dll'))
    .find(existsSync);
  if (!file) throw new Error('Windows .NET reference is missing: ' + name);
  return file;
}
const out = path.join(root, '.runtime/spotify-bridge');
const sourceSha256 = spotifySourceHash(root);
const artifact = sourceSha256.slice(0, 16) + '/Capri.Spotify.exe';
mkdirSync(path.dirname(path.join(out, artifact)), { recursive: true });
const destination = path.dirname(path.join(out, artifact));
const interop = path.join(destination, 'Interop.UIAutomationClient.dll');
if (!existsSync(interop)) {
  const exporter = path.join(destination, 'ExportAutomation.exe');
  execFileSync(
    path.join(framework, 'csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/out:' + exporter,
      path.join(root, 'integrations/spotify/native/ExportAutomation.cs'),
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
  execFileSync(exporter, [path.join(windows, 'System32/UIAutomationCore.dll'), interop], {
    cwd: destination,
    windowsHide: true,
    stdio: 'inherit',
  });
}
const references = [
  path.join(framework, 'System.Runtime.WindowsRuntime.dll'),
  facade('System.Runtime'),
  facade('System.Runtime.InteropServices.WindowsRuntime'),
  path.join(framework, 'WPF/UIAutomationClient.dll'),
  path.join(framework, 'WPF/UIAutomationTypes.dll'),
  path.join(framework, 'WPF/WindowsBase.dll'),
  ...['Windows.Foundation', 'Windows.Media', 'Windows.Storage'].map((name) =>
    path.join(metadata, name + '.winmd'),
  ),
];
if (!existsSync(path.join(out, artifact)))
  execFileSync(
    path.join(framework, 'csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/out:' + path.join(out, artifact),
      '/r:System.Web.Extensions.dll',
      '/r:' + interop,
      ...references.map((file) => '/r:' + file),
      ...NATIVE_SOURCES.map((name) => path.join(root, 'integrations/spotify/native', name)),
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
writeFileSync(path.join(out, 'build.json'), JSON.stringify({ sourceSha256, artifact }));
console.log('Spotify Windows bridge built. No Spotify credentials are required.');
