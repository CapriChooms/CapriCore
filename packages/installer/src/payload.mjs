// SPDX-License-Identifier: GPL-3.0-only
import { readdirSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from '../../runtime/src/host/paths.mjs';
import { readJson } from './policy.mjs';
import {
  ACTIVE_STARTUP_INTRO,
  startupIntroSourceFiles,
} from '../../../apps/desktop/startup-intro-assets.mjs';
const directories = [
  'apps',
  'packages',
  'integrations',
  'native/desktop-teleport',
  'scripts',
  'tools',
  'tests',
  'config',
  'docs',
  '.github',
  'assets/default',
  'assets/fonts',
];
const rootFiles = [
  'package.json',
  'package-lock.json',
  'pyproject.toml',
  'README.md',
  'LINUX-PREVIEW.md',
  'start-capri.sh',
  'ROADMAP.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.node-version',
  '.python-version',
  '.prettierignore',
  '.prettierrc.json',
];
export const forbiddenSource =
  /(?:^|\/)(?:node_modules|\.runtime|\.git|\.venv|__pycache__)(?:\/|$)|^(?:data|logs|vendor|archive|release)(?:\/|$)|^docs\/audit\/(?!npm-sbom\.cdx\.json$)|^(?:apps|packages|integrations)\/[^/]+\/(?:dist|build)(?:\/|$)|^native\/desktop-teleport\/target(?:\/|$)|\.local\.(?:json|ps1)$|\.pyc$|\.env(?:\.|$)/i;
export function sourceFiles(sourceRoot = root) {
  const result = [];
  function walk(directory) {
    if (!existsSync(directory)) return;
    if (lstatSync(directory).isSymbolicLink())
      throw new Error('A source export cannot follow a directory link');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name),
        name = path.relative(sourceRoot, file).split(path.sep).join('/');
      if (forbiddenSource.test(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('A source export cannot follow a link: ' + name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result.push(name);
    }
  }
  for (const name of directories) {
    let current = sourceRoot;
    for (const segment of name.split('/')) {
      current = path.join(current, segment);
      if (existsSync(current) && lstatSync(current).isSymbolicLink())
        throw new Error('A source export cannot follow a directory link: ' + name);
    }
    walk(path.join(sourceRoot, name));
  }
  // Export only reviewed runtime frames. Authoring references, rejected walking
  // frames, previous revisions and generation metadata never enter the release.
  for (const [spriteCatalog, spriteFolder] of [
    ['assets/capri/sprites/v1/runtime-sprite-set.json', 'assets/capri/sprites/v1'],
    ['assets/capri/sprites/poses-v2/runtime-poses.json', 'assets/capri/sprites/poses-v2/PNG'],
  ]) {
    const catalogFile = path.join(sourceRoot, spriteCatalog);
    if (!existsSync(catalogFile)) continue;
    if (!lstatSync(catalogFile).isFile() || lstatSync(catalogFile).isSymbolicLink())
      throw new Error('Runtime sprite catalogues must be regular files');
    let current = sourceRoot;
    for (const segment of spriteFolder.split('/')) {
      current = path.join(current, segment);
      if (lstatSync(current).isSymbolicLink())
        throw new Error('Runtime sprites cannot follow a directory link');
    }
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
    result.push(spriteCatalog);
    for (const sprite of catalog.sprites) {
      if (
        !/^[a-z0-9_-]+\.png$/i.test(sprite.file) ||
        /walk/i.test(sprite.kind ?? '') ||
        /walk/i.test(sprite.pose ?? '')
      )
        throw new Error('Unapproved runtime sprite in the release catalog');
      const name = spriteFolder + '/' + sprite.file;
      if (
        !lstatSync(path.join(sourceRoot, name)).isFile() ||
        lstatSync(path.join(sourceRoot, name)).isSymbolicLink()
      )
        throw new Error('Runtime sprites must be regular files');
      result.push(name);
    }
  }
  for (const name of [
    ...rootFiles,
    ...readdirSync(sourceRoot).filter((name) => name.endsWith('.cmd')),
  ]) {
    const file = path.join(sourceRoot, name);
    if (!existsSync(file)) continue;
    if (lstatSync(file).isSymbolicLink())
      throw new Error('A source export cannot follow a file link: ' + name);
    if (lstatSync(file).isFile()) result.push(name);
  }
  if (existsSync(path.join(sourceRoot, ACTIVE_STARTUP_INTRO)))
    result.push(...startupIntroSourceFiles(sourceRoot));
  return [...new Set(result)].sort();
}

export async function verifySetupPayload(sourceRoot, signal) {
  const names = sourceFiles(sourceRoot);
  const manifest = path.join(sourceRoot, 'SOURCE_MANIFEST.json');
  let expected;
  if (existsSync(manifest)) {
    const pinned = readJson(manifest, 2 * 1024 ** 2).files;
    expected = new Map(pinned.map(({ path: name, sha256 }) => [name, sha256]));
    const actual = new Set(names);
    const missing = [...expected.keys()].filter((name) => !actual.has(name));
    const extra = names.filter((name) => !expected.has(name));
    if (missing.length || extra.length || expected.size !== pinned.length) {
      const details = [
        ...(missing.length
          ? [`missing (${missing.length}): ${missing.slice(0, 3).join(', ')}`]
          : []),
        ...(extra.length ? [`unexpected (${extra.length}): ${extra.slice(0, 3).join(', ')}`] : []),
        ...(expected.size !== pinned.length ? ['duplicate manifest paths'] : []),
      ];
      throw new Error(`Source payload file list differs from its manifest (${details.join('. ')})`);
    }
  }

  const files = [];
  const backoff = [200, 500, 1000];
  for (const name of names) {
    const file = path.join(sourceRoot, name);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const info = lstatSync(file);
        if (!info.isFile() || info.size > 20 * 1024 ** 2)
          throw new Error('Invalid source payload file: ' + name);
        const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
        if (expected && expected.get(name) !== sha256)
          throw new Error('Source payload checksum mismatch: ' + name);
        files.push({ path: name, bytes: info.size, sha256 });
        break;
      } catch (error) {
        // A scanner can hold an extracted file briefly. Keep verification mandatory.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code))
          throw error;
        if (attempt >= backoff.length)
          throw Object.assign(
            new Error(
              `Cannot read source payload file ${name} (${error.code}). The file may be in use or blocked by Windows.`,
              { cause: error },
            ),
            { code: error.code },
          );
        await delay(backoff[attempt], undefined, { signal });
      }
    }
  }
  return files;
}
