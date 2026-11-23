// SPDX-License-Identifier: GPL-3.0-only
import { readdirSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../../runtime/src/host/paths.mjs';
import {
  ACTIVE_STARTUP_INTRO,
  startupIntroSourceFiles,
} from '../../../apps/desktop/startup-intro-assets.mjs';
const directories = [
  'apps',
  'packages',
  'integrations',
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
  /(?:^|\/)(?:node_modules|\.runtime|\.git|\.venv|__pycache__)(?:\/|$)|^(?:data|logs|vendor|archive|release)(?:\/|$)|^docs\/audit\/(?!npm-sbom\.cdx\.json$)|^(?:apps|packages|integrations)\/[^/]+\/(?:dist|build)(?:\/|$)|\.local\.(?:json|ps1)$|\.pyc$|\.env(?:\.|$)/i;
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
