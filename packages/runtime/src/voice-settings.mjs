// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const definitions = {
  'voice-training': {
    field: 'datasetDir',
    allowed: new RegExp('^data/voices/capri/en/imports/' + uuid + '$'),
  },
  'companion-voice': {
    field: 'profileDir',
    allowed: new RegExp(
      '^data/voices/capri/en/(?:imports/' + uuid + '/)?exports/capri-trained-' + uuid + '$',
    ),
  },
};

function safePath(root, relative) {
  const base = path.resolve(root),
    file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) throw new Error('Invalid local voice path.');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('Local voice settings cannot follow filesystem links.');
    if (cursor === path.dirname(cursor)) break;
  }
  return file;
}
function json(file) {
  const bytes = readFileSync(file);
  if (bytes.length > 65536) throw new Error('Local voice settings exceed their size limit.');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
export function voiceOverridePath(root, kind) {
  if (!definitions[kind]) throw new Error('Unsupported local voice settings.');
  return safePath(root, 'config/' + kind + '.local.json');
}
function settings(root, kind, { configRoot = root } = {}) {
  const value = json(safePath(configRoot, 'config/' + kind + '.json'));
  const file = voiceOverridePath(root, kind);
  if (!existsSync(file)) return value;
  const local = json(file),
    { field, allowed } = definitions[kind];
  if (
    !local ||
    local.schemaVersion !== 1 ||
    Object.keys(local).some((key) => !['schemaVersion', field].includes(key)) ||
    typeof local[field] !== 'string' ||
    !allowed.test(local[field])
  )
    throw new Error('Invalid local voice selection.');
  safePath(root, local[field]);
  return {
    ...value,
    [field]: local[field],
    ...(kind === 'voice-training' ? { allowProvisionalTranscripts: false } : {}),
  };
}
export const readVoiceSettings = (root, options) => settings(root, 'companion-voice', options);
export const readTrainingSettings = (root, options) => settings(root, 'voice-training', options);
