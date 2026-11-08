// SPDX-License-Identifier: GPL-3.0-only
import {
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  existsSync,
  lstatSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hostname, userInfo } from 'node:os';
import {
  requireCapriAvatar,
  ACTIVE_AVATAR_CATALOG,
  ACTIVE_AVATAR_POSES,
} from '../../apps/desktop/avatar-catalog.mjs';
import { root, writeJsonAtomic } from '../../packages/runtime/src/index.mjs';
import { assertEmptyOwnerTemplates } from '../../packages/runtime/src/owner-memory.mjs';
import { startupIntroSourceFiles } from '../../apps/desktop/startup-intro-assets.mjs';
import { musicArtworkSourceFiles } from '../../apps/desktop/music-artwork.mjs';
import {
  sourceFiles,
  forbiddenSource as forbidden,
} from '../../packages/installer/src/payload.mjs';
export { sourceFiles };
export function hasSourceCredential(text) {
  return (
    /\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{20,}|hf_[a-zA-Z0-9]{20,}|sk-(?:or-v1-)?[a-zA-Z0-9]{30,}|AKIA[A-Z0-9]{16})\b/.test(
      text,
    ) ||
    /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/u.test(text) ||
    /https:\/\/(?:www\.)?github\.com\/[^\s"'<>]*[?&](?:amp;)?email_token=[A-Za-z0-9_-]{20,}/iu.test(
      text,
    ) ||
    /https:\/\/(?:www\.)?github\.com\/notifications\/(?:unsubscribe-auth|mobile\/(?:ios|android))\/[A-Za-z0-9_-]{20,}/iu.test(
      text,
    )
  );
}
export function assertPublicVoiceConfiguration(training, companion) {
  if (
    training?.datasetDir !== 'data/voices/capri/en' ||
    training?.modelDir !== 'data/speech/chatterbox-turbo' ||
    companion?.profileDir !== 'data/voices/capri/en/exports/capri-en-v1'
  )
    throw new Error(
      'Source release requires the public voice defaults; local imported recordings and trained profile selections must not be exported.',
    );
}
export function validateSource(files) {
  assertEmptyOwnerTemplates(root);
  assertPublicVoiceConfiguration(
    JSON.parse(readFileSync(path.join(root, 'config/voice-training.json'), 'utf8')),
    JSON.parse(readFileSync(path.join(root, 'config/companion-voice.json'), 'utf8')),
  );
  const errors = [];
  const artwork = requireCapriAvatar(root, { source: true });
  for (const name of [
    ACTIVE_AVATAR_CATALOG,
    ACTIVE_AVATAR_POSES,
    'assets/default/capri-headpat.png',
    ...artwork.frames.map((frame) => path.relative(root, frame.file).split(path.sep).join('/')),
  ])
    if (!files.includes(name)) errors.push('Missing required Capri artwork: ' + name);
  for (const name of startupIntroSourceFiles(root))
    if (!files.includes(name)) errors.push('Missing reviewed startup artwork: ' + name);
  for (const name of musicArtworkSourceFiles(root))
    if (!files.includes(name)) errors.push('Missing reviewed music artwork: ' + name);
  for (const name of [
    'README.md',
    'package.json',
    'package-lock.json',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'LICENSE',
  ])
    if (!files.includes(name)) errors.push('Missing release document: ' + name);
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  for (const command of Object.values(scripts))
    for (const match of command.matchAll(/\bnode\s+([a-zA-Z0-9_./-]+\.(?:mjs|cjs|js))\b/g))
      if (!files.includes(match[1])) errors.push('Missing command implementation: ' + match[1]);
  for (const name of files) {
    if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || forbidden.test(name)) {
      errors.push(name + ': outside the source boundary');
      continue;
    }
    const file = path.join(root, name);
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      errors.push(name + ': source must be a regular file');
      continue;
    }
    if (info.size > 20 * 1024 * 1024) {
      errors.push(name + ': exceeds source size budget');
      continue;
    }
    const bytes = readFileSync(file);
    if (
      name !== 'assets/default/screenshot-capture.mp3' &&
      /\.(?:onnx|safetensors|gguf|ckpt|pth?|bin|wav|mp3|mp4|mov|webm|flac|ogg|zip|7z|exe|dll)$/i.test(
        name,
      )
    )
      errors.push(name + ': runtime/model/media binary');
    if (/\.(?:mjs|js|cjs|py|cs|ps1|cmd|json|md|toml|ya?ml|txt)$/.test(name)) {
      const text = bytes.toString('utf8');
      const homeUser = userInfo().username.toLowerCase();
      if (
        /[A-Z]:[\\/]+AI[ _]ASSISTANT/i.test(text) ||
        text.includes(hostname()) ||
        (/[A-Z]:[\\/]+Users[\\/]+/i.test(text) && text.toLowerCase().includes(homeUser))
      )
        errors.push(name + ': private machine path/name');
      if (hasSourceCredential(text)) errors.push(name + ': credential-like content');
    }
  }
  if (
    !files.includes('LICENSE') ||
    !readFileSync(path.join(root, 'LICENSE'), 'utf8').includes('GNU GENERAL PUBLIC LICENSE')
  )
    errors.push('GPL license is missing');
  if (errors.length) throw new Error('Source release checks failed:\n' + errors.join('\n'));
  return files.map((name) => ({
    path: name,
    bytes: statSync(path.join(root, name)).size,
    sha256: createHash('sha256')
      .update(readFileSync(path.join(root, name)))
      .digest('hex'),
  }));
}
export function exportSource({ check = false } = {}) {
  const manifest = validateSource(sourceFiles());
  if (check) return { passed: true, files: manifest.length };
  const parent = path.join(root, 'release');
  mkdirSync(parent, { recursive: true });
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error('Invalid release version');
  const destination = mkdtempSync(path.join(parent, 'capri-source-' + version + '-'));
  for (const entry of manifest) {
    const target = path.join(destination, entry.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, entry.path), target);
  }
  writeJsonAtomic(path.join(destination, 'SOURCE_MANIFEST.json'), {
    schemaVersion: 1,
    license: 'GPL-3.0-only',
    files: manifest,
  });
  return { passed: true, destination, files: manifest.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  try {
    console.log(JSON.stringify(exportSource({ check: process.argv.includes('--check') })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
