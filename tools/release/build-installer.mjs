// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { exportSource } from './source-export.mjs';
import { root, writeJsonAtomic } from '../../packages/runtime/src/index.mjs';
import { fileHash } from '../../packages/installer/src/download.mjs';
import { exportVoicePack } from './voice-pack-export.mjs';
import { parseVersion, REPOSITORY } from '../../packages/updater/src/releases.mjs';
import { validateInstallerCatalog } from '../localization/installer-catalog.mjs';
if (process.platform !== 'win32') throw new Error('The setup launcher is built on Windows');
validateInstallerCatalog(
  JSON.parse(readFileSync(path.join(root, 'config/installer-text.json'), 'utf8')),
  JSON.parse(readFileSync(path.join(root, 'config/interface-locales.json'), 'utf8')).locales,
);
const source = exportSource(),
  version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const release = JSON.parse(readFileSync(path.join(root, 'config/release.json'), 'utf8'));
if (release.repository !== REPOSITORY || parseVersion(release.tag).version !== version)
  throw new Error('Release tag must match the package version and repository');
const parent = path.join(root, 'release');
mkdirSync(parent, { recursive: true });
const folder = mkdtempSync(path.join(parent, 'installer-' + version + '-'));
const args = process.argv.slice(2);
if (args.some((arg) => !arg.startsWith('--voice-pack=')))
  throw new Error('Supported option: --voice-pack=<exported voice folder>');
if (args.length > 1) throw new Error('Choose only one bundled voice pack');
const voice = args.length
  ? exportVoicePack({
      source: path.resolve(args[0].slice('--voice-pack='.length)),
      destination: path.join(folder, 'voice-pack'),
    })
  : null;
const result = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'tools/release/build-installer.ps1'),
    '-Source',
    source.destination,
    '-Destination',
    folder,
    '-Version',
    version,
    ...(voice ? ['-VoicePack', voice.directory] : []),
  ],
  { encoding: 'utf8', windowsHide: true },
);
if (result.error || result.status !== 0)
  throw new Error(result.error?.message || result.stdout + '\n' + result.stderr);
const executable = path.join(folder, 'CapriSetup-' + version + '.exe');
let voiceArtifact;
if (voice) {
  const file = voice.manifest.id + '.zip';
  copyFileSync(path.join(folder, 'voice.zip'), path.join(folder, file));
  voiceArtifact = {
    id: voice.manifest.id,
    file,
    bytes: statSync(path.join(folder, file)).size,
    sha256: await fileHash(path.join(folder, file)),
    files: voice.manifest.files,
  };
}
const manifest = {
  schemaVersion: 1,
  version,
  releaseTag: release.tag,
  executable: path.basename(executable),
  sha256: await fileHash(executable),
  sourcePayloadSha256: await fileHash(path.join(folder, 'source.zip')),
  sourceFiles: source.files,
  ...(voiceArtifact ? { bundledVoice: voiceArtifact } : {}),
  signature: 'unsigned release build',
};
writeJsonAtomic(path.join(folder, 'BUILD_MANIFEST.json'), manifest);
console.log(JSON.stringify({ executable, manifest }));
