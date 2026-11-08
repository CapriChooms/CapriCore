// SPDX-License-Identifier: GPL-3.0-only
import { readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';

// Update recipients must not rediscover a new release using their OLD artwork
// exporter/catalog. The archive digest authenticates the downloaded inventory;
// this stable policy limits it to application-owned source and artwork paths.
const sourceDirectories = new Set([
  'apps',
  'packages',
  'integrations',
  'scripts',
  'tools',
  'tests',
  'config',
  'docs',
  '.github',
]);
const rootFiles = new Set([
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
]);
const privatePath =
  /(?:^|\/)(?:node_modules|\.runtime|\.git|\.venv|__pycache__)(?:\/|$)|^(?:data|logs|vendor|archive|release)(?:\/|$)|^docs\/audit\/(?!npm-sbom\.cdx\.json$)|^(?:apps|packages|integrations)\/[^/]+\/(?:dist|build)(?:\/|$)|\.local\.(?:json|ps1)$|\.pyc$|(?:^|\/)\.env(?:\.|$)/i;
const device = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])[ ]*(?:\.|$)/iu;

export function installerRequired(reason = 'payload_format') {
  return Object.assign(
    new Error(
      'This update requires the full installer. Select your current Capri folder to keep your data.',
    ),
    { code: 'UPDATE_INSTALLER_REQUIRED', reason },
  );
}

export function updateSourcePath(name, { compatibleOnly = true } = {}) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 1024 ||
    name.includes('\\') ||
    name.includes(':') ||
    /[\x00-\x1f\x7f<>"|?*]/u.test(name) ||
    path.isAbsolute(name) ||
    name
      .split('/')
      .some(
        (part) =>
          !part || part === '.' || part === '..' || /[. ]$/u.test(part) || device.test(part),
      ) ||
    privatePath.test(name) ||
    /^(?:\.capri[^/]*|SOURCE_MANIFEST\.json|Capri\.exe|uninstall\.exe|Support(?:\/|$))/iu.test(name)
  )
    throw Error('Unsafe update file path');
  const parts = name.split('/');
  if (parts.length === 1 && (rootFiles.has(name) || /^[^/]+\.cmd$/iu.test(name))) return name;
  if (parts.length > 1 && sourceDirectories.has(parts[0])) return name;
  if (/^assets\/(?:default|fonts)\/.+/u.test(name)) return name;
  if (/^assets\/capri\/.+\.(?:png|json)$/iu.test(name)) return name;
  // Future layouts can be installed by an independently verified full wizard.
  // They are never executed as a validator by the installed updater.
  if (compatibleOnly) throw installerRequired('unsupported_source_path');
  return name;
}

export function updatePayloadFiles(source) {
  const files = [],
    seen = new Set();
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = path.join(directory, entry.name);
      const info = lstatSync(file);
      if (info.isSymbolicLink()) throw Error('Update source cannot contain filesystem links');
      if (info.isDirectory()) {
        // Validate every directory segment too, including empty unsafe folders.
        if (
          name.length > 1024 ||
          /[\\:\x00-\x1f\x7f<>"|?*]/u.test(name) ||
          name.split('/').some((part) => device.test(part) || /[. ]$/u.test(part)) ||
          (name.toLowerCase() !== 'docs/audit' && privatePath.test(name + '/'))
        )
          throw Error('Unsafe update file path');
        walk(file, name + '/');
      } else if (info.isFile()) {
        if (name === 'SOURCE_MANIFEST.json') continue;
        updateSourcePath(name, { compatibleOnly: false });
        const key = name.toLowerCase();
        if (seen.has(key)) throw Error('Invalid source update manifest entry');
        seen.add(key);
        files.push(name);
        if (files.length > 10000) throw Error('Update payload exceeds its file limit');
      } else throw Error('Update source must contain regular files');
    }
  }
  walk(source);
  return files;
}
