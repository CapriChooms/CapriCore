// SPDX-License-Identifier: GPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const EMPTY_OWNER_MEMORY = Object.freeze({
  'USER.md': '# User\n\nNo user preferences have been saved yet.\n',
  'MEMORY.md': '# Memory\n\nNo memories have been saved yet.\n',
});
const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
// Fingerprints only: do not embed the accidentally shipped owner's text again.
const shipped = {
  'USER.md': {
    length: 727,
    sha256: '3feed9f4b1ad247830a7db6db7d15917bdb993a92c99e86acef9c6632a95e459',
  },
  'MEMORY.md': {
    length: 1478,
    sha256: '34b13c2310959229249d8ddd1ae8348ae490bc9ef51f4ad2c164104cd277686b',
  },
};
export function removeShippedOwnerPrefix(name, input, fingerprints = shipped) {
  const text = normalize(input),
    record = fingerprints[name];
  if (!record || (text.length > record.length && !/\s/.test(text[record.length]))) return input;
  const prefix = text.slice(0, record.length);
  if (createHash('sha256').update(prefix).digest('hex') !== record.sha256) return input;
  const remaining = text.slice(record.length).trimStart();
  return EMPTY_OWNER_MEMORY[name] + (remaining ? '\n' + remaining : '');
}
export function assertEmptyOwnerTemplates(root) {
  for (const [name, expected] of Object.entries(EMPTY_OWNER_MEMORY)) {
    const file = path.join(root, 'config/workspace', name);
    if (
      lstatSync(file).isSymbolicLink() ||
      normalize(readFileSync(file, 'utf8')).trimEnd() !== expected.trimEnd()
    )
      throw new Error('Release blocked: owner memory template must be empty: ' + name);
  }
}
export function initializeOwnerMemory(workspace, { repairShippedDefaults = false } = {}) {
  mkdirSync(workspace, { recursive: true });
  for (const [name, empty] of Object.entries(EMPTY_OWNER_MEMORY)) {
    const file = path.join(workspace, name);
    try {
      writeFileSync(file, empty, { flag: 'wx' });
      continue;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!repairShippedDefaults) continue;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) continue;
    const before = readFileSync(file, 'utf8'),
      after = removeShippedOwnerPrefix(name, before);
    if (after === before) continue;
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, after, { flag: 'wx' });
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
