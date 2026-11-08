// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  copyFileSync,
  lstatSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { paths } from './host/paths.mjs';

export const MAX_PERSONALITY_LENGTH = 24000;
export const PERSONALITY_FILE = 'PERSONALITY.md';
export const PERSONALITY_PROMPT_HEADER = 'CAPRI PERSONALITY (PERSONALITY.md):';
const LEGACY_FILES = Object.freeze([
  'SOUL.md',
  'AGENTS.md',
  'IDENTITY.md',
  'TOOLS.md',
  'personality.json',
]);
const LEGACY_FACTORY_EXAMPLE =
  'For casual questions about your day, give a small characterful response rather than a generic speech about processing millions of words, being an AI or always being ready to help. For example: Quiet in the wires today. Your timing is pretty good, choom. This illustrates brevity, not a line to repeat. Never pass fictional activity off as a real observation of the computer.';
const FACTORY_CONVERSATION_GUIDANCE =
  "For casual questions about your day, answer the owner's actual question briefly and naturally in your own words. Let the moment inspire a small characterful detail or a playful metaphor when it fits. Keep fictional activity separate from real observations of the computer.";

function updateFactoryExample(text) {
  // Replace only an unchanged, standalone factory paragraph. Preserve all other
  // custom text, its line endings, surrounding whitespace and optional BOM.
  return text
    .split(/(\r?\n)/)
    .map((line) => (line === LEGACY_FACTORY_EXAMPLE ? FACTORY_CONVERSATION_GUIDANCE : line))
    .join('');
}

export function validatePersonality(text) {
  if (typeof text !== 'string' || text.length > MAX_PERSONALITY_LENGTH || text.includes('\0'))
    throw new Error('Personality prompt must be at most 24,000 characters.');
  return text.trim();
}

function readText(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PERSONALITY_LENGTH * 4 + 3)
    throw new Error('Personality must be a regular text file of at most 24,000 characters.');
  return validatePersonality(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

export function defaultPersonality(sourceDirectory = path.join(paths.config, 'workspace')) {
  const text = readText(path.join(sourceDirectory, PERSONALITY_FILE));
  if (!text) throw new Error("Capri's default PERSONALITY.md is empty.");
  return text;
}

/** Reads exactly one live source; retired prompt files are never fallback context. */
export function readPersonality(workspace) {
  const file = path.join(workspace, PERSONALITY_FILE);
  return existsSync(file) ? readText(file) || defaultPersonality() : defaultPersonality();
}

export function savePersonality(workspace, text) {
  const value = validatePersonality(text) || defaultPersonality();
  writePersonality(workspace, value);
  return value;
}

function writePersonality(workspace, value) {
  const file = path.join(workspace, PERSONALITY_FILE),
    temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** One-way migration. Existing PERSONALITY.md wins, and legacy sources are archived. */
export function initializePersonality(
  workspace,
  {
    backupDirectory = path.join(paths.data, 'config-backups/persona'),
    previousDefaults = [
      'f8f91991d946041b09b2a7eb0c7bf7aaf6beadb983fda88e09033416173c01ab',
      '8a6b02747e845dc989bb7f4757d55e24ded11814823bf763bd4f51760f4dfa8d',
    ],
  } = {},
) {
  mkdirSync(workspace, { recursive: true });
  const current = path.join(workspace, PERSONALITY_FILE);
  let text = existsSync(current) ? readText(current) : '';
  let source = existsSync(current) ? PERSONALITY_FILE : 'default';
  // An explicitly empty Markdown file was the old reset action, never a request
  // to resurrect an older JSON override or SOUL.
  if (!existsSync(current)) {
    const legacyJson = path.join(workspace, 'personality.json');
    if (existsSync(legacyJson)) {
      const info = lstatSync(legacyJson);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PERSONALITY_LENGTH * 4 + 256)
        throw new Error('Cannot migrate an invalid legacy personality file.');
      const saved = JSON.parse(readFileSync(legacyJson, 'utf8').replace(/^\uFEFF/, ''));
      if (saved.schemaVersion === 1) text = validatePersonality(saved.text);
      if (text) source = 'personality.json';
    }
    if (!text && existsSync(path.join(workspace, 'SOUL.md'))) {
      text = readText(path.join(workspace, 'SOUL.md'));
      if (text) source = 'SOUL.md';
    }
  }
  const legacy = LEGACY_FILES.filter((name) => existsSync(path.join(workspace, name)));
  const stockHash = createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  // v0.3.5's unedited default; custom Personality text is never overwritten.
  const refreshStock =
    previousDefaults.includes(stockHash) &&
    text.replace(/\r\n/g, '\n') !== defaultPersonality().replace(/\r\n/g, '\n');
  const original = existsSync(current) && text ? readFileSync(current, 'utf8') : null;
  const updated = original === null ? null : updateFactoryExample(original);
  const refreshExample = updated !== original;
  // Never follow a legacy symlink or archive a directory as if it were a prompt.
  for (const name of legacy) {
    const info = lstatSync(path.join(workspace, name));
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Cannot migrate linked legacy prompt: ' + name);
  }
  let backup = null;
  if (legacy.length || (existsSync(current) && (!text || refreshStock || refreshExample))) {
    backup = path.join(backupDirectory, randomUUID());
    mkdirSync(backup, { recursive: true });
    for (const name of legacy) copyFileSync(path.join(workspace, name), path.join(backup, name));
    if (existsSync(current)) copyFileSync(current, path.join(backup, PERSONALITY_FILE));
  }
  let created = !existsSync(current) || !text || refreshStock || refreshExample;
  if (created) {
    try {
      if (refreshExample && !refreshStock) writePersonality(workspace, updated);
      else savePersonality(workspace, refreshStock ? '' : text);
    } catch (error) {
      // An optional stock refresh must not prevent startup on a read-only file.
      if (!(refreshStock || refreshExample) || !['EPERM', 'EACCES'].includes(error.code))
        throw error;
      created = false;
    }
  }
  // Copies above and the canonical file are durable before retiring old sources.
  for (const name of legacy) unlinkSync(path.join(workspace, name));
  return { created, source, archived: legacy, backup };
}
