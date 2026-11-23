// SPDX-License-Identifier: GPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const stat = (file) => lstatSync(file, { throwIfNoEntry: false });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function directory(folder) {
  try {
    mkdirSync(folder, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (!lstatSync(folder).isDirectory()) throw new Error('Expected a private directory: ' + folder);
}

function atomicWrite(file, bytes) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function regular(file) {
  const info = stat(file);
  if (info && (!info.isFile() || info.nlink !== 1))
    throw new Error('Expected a regular settings file: ' + file);
  return Boolean(info);
}

// Defaults can change between releases. Preserve an owner's edited default
// and any local-only files while refreshing untouched copies.
function syncDefaults(source, support) {
  const receipt = path.join(support, '.capri-config-defaults.json');
  const previous = regular(receipt) ? JSON.parse(readFileSync(receipt, 'utf8')) : {};
  const next = {};
  function walk(subdir) {
    directory(path.join(support, subdir));
    for (const item of readdirSync(path.join(source, subdir), { withFileTypes: true })) {
      const name = path.join(subdir, item.name);
      if (item.isDirectory()) {
        walk(name);
        continue;
      }
      if (!item.isFile()) throw new Error('Invalid bundled configuration: ' + name);
      const from = path.join(source, name);
      const to = path.join(support, name);
      const bytes = readFileSync(from);
      next[name] = hash(bytes);
      if (!regular(to)) {
        try {
          copyFileSync(from, to, constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST' || !regular(to)) throw error;
        }
      } else if (
        previous[name] &&
        previous[name] !== next[name] &&
        hash(readFileSync(to)) === previous[name]
      ) {
        atomicWrite(to, bytes);
      }
    }
  }
  walk('config');
  if (JSON.stringify(next) !== JSON.stringify(previous)) atomicWrite(receipt, JSON.stringify(next));
}

const sourceNames = [
  'apps',
  'assets',
  'packages',
  'integrations',
  'node_modules',
  'scripts',
  'tools',
  'docs',
  'package.json',
  'package-lock.json',
];

export function macSupportRoot(home = homedir()) {
  const appSupport = path.join(home, 'Library', 'Application Support');
  mkdirSync(appSupport, { recursive: true });
  return path.join(realpathSync(appSupport), 'CapriCore');
}

export function macProfileRoot(support) {
  let folder = support;
  directory(folder);
  for (const name of ['data', 'desktop', 'profile']) {
    folder = path.join(folder, name);
    directory(folder);
  }
  return folder;
}

export function prepareMacRuntime(source, support) {
  directory(support);
  for (const name of ['data', 'logs', '.runtime']) directory(path.join(support, name));
  // All resource links resolve through one replaceable pointer, so moving the
  // signed application never requires modifying it or migrating owner data.
  const pointerName = '.capri-bundle';
  const pointer = path.join(support, pointerName);
  for (const name of sourceNames) {
    const file = path.join(support, name);
    const target = path.join(pointerName, name);
    try {
      symlinkSync(target, file);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!lstatSync(file).isSymbolicLink() || readlinkSync(file) !== target)
        throw new Error('Unexpected existing Capri installation entry: ' + name);
    }
  }
  syncDefaults(source, support);
  try {
    symlinkSync(source, pointer);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!lstatSync(pointer).isSymbolicLink()) throw new Error('Invalid Capri bundle reference');
    const previous = readlinkSync(pointer);
    if (previous !== source) {
      if (!path.isAbsolute(previous) || !previous.endsWith('.app/Contents/Resources/capri'))
        throw new Error('Unrecognized Capri bundle reference');
      const temp = pointer + '.' + randomUUID();
      try {
        symlinkSync(source, temp);
        renameSync(temp, pointer);
      } finally {
        rmSync(temp, { force: true });
      }
    }
  }
}
