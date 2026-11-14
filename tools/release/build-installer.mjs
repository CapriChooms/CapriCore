// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { exportSource } from './source-export.mjs';
import { root, writeJsonAtomic } from '../../packages/runtime/src/index.mjs';
import { fileHash } from '../../packages/installer/src/download.mjs';
import { exportVoicePack } from './voice-pack-export.mjs';
import { parseVersion, REPOSITORY } from '../../packages/updater/src/releases.mjs';
import { validateInstallerCatalog } from '../localization/installer-catalog.mjs';
import { copyRussianVoicePack } from '../../packages/installer/src/voice-pack.mjs';
import russianVoice from '../../config/qwen-ru-voice.json' with { type: 'json' };
if (process.platform !== 'win32') throw new Error('The setup launcher is built on Windows');
const options = process.argv.slice(2);
const voiceOptions = options.filter((arg) => arg.startsWith('--voice-pack='));
const russianOptions = options.filter((arg) => arg.startsWith('--test-russian-voice='));
const signed = options.includes('--sign');
if (
  voiceOptions.length > 1 ||
  russianOptions.length > 1 ||
  (russianOptions.length && !voiceOptions.length) ||
  options.length !== voiceOptions.length + russianOptions.length + Number(signed)
)
  throw new Error(
    'Supported options: --sign, --voice-pack=<exported voice folder> and --test-russian-voice=<verified Russian adapter folder>.',
  );
let signingArguments = [];
if (signed) {
  const signTool = process.env.CAPRI_SIGNTOOL ?? '';
  const thumbprint = process.env.CAPRI_SIGNING_THUMBPRINT?.trim() ?? '';
  const timestamp = URL.parse(process.env.CAPRI_SIGNING_TIMESTAMP_URL ?? '');
  if (
    !path.isAbsolute(signTool) ||
    path.basename(signTool).toLowerCase() !== 'signtool.exe' ||
    !existsSync(signTool)
  )
    throw new Error('Set CAPRI_SIGNTOOL to the full path of Windows SDK signtool.exe.');
  if (!/^[a-f0-9]{40}$/iu.test(thumbprint))
    throw new Error('Set CAPRI_SIGNING_THUMBPRINT to the code-signing certificate thumbprint.');
  if (
    !timestamp ||
    !['http:', 'https:'].includes(timestamp.protocol) ||
    timestamp.username ||
    timestamp.password
  )
    throw new Error('Set CAPRI_SIGNING_TIMESTAMP_URL to your RFC 3161 timestamp server.');
  signingArguments = [
    '-SignTool',
    signTool,
    '-SigningThumbprint',
    thumbprint,
    '-TimestampUrl',
    timestamp.href,
  ];
}
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
const voice = voiceOptions.length
  ? exportVoicePack({
      source: path.resolve(voiceOptions[0].slice('--voice-pack='.length)),
      destination: path.join(folder, 'voice-pack'),
    })
  : null;
if (russianOptions.length)
  copyRussianVoicePack(
    path.resolve(russianOptions[0].slice('--test-russian-voice='.length)),
    path.join(voice.directory, 'russian'),
  );
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
    ...signingArguments,
  ],
  { encoding: 'utf8', windowsHide: true },
);
if (result.error || result.status !== 0)
  throw new Error(result.error?.message || result.stdout + '\n' + result.stderr);
const executable = path.join(folder, 'CapriSetup-' + version + '.exe');
let voiceArtifact;
if (voice) {
  const file = russianOptions.length ? 'capri-test-voices.zip' : voice.manifest.id + '.zip';
  copyFileSync(path.join(folder, 'voice.zip'), path.join(folder, file));
  voiceArtifact = {
    id: voice.manifest.id,
    file,
    bytes: statSync(path.join(folder, file)).size,
    sha256: await fileHash(path.join(folder, file)),
    files: voice.manifest.files,
    ...(russianOptions.length
      ? {
          russianTestVoice: {
            repository: russianVoice.model,
            revision: russianVoice.revision,
            files: russianVoice.pack.files.map(({ file, bytes, sha256 }) => ({
              path: 'russian/' + file,
              bytes,
              sha256,
            })),
          },
        }
      : {}),
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
  signature: signed ? 'Authenticode signed and timestamped' : 'unsigned release build',
};
writeJsonAtomic(path.join(folder, 'BUILD_MANIFEST.json'), manifest);
console.log(JSON.stringify({ executable, manifest }));
