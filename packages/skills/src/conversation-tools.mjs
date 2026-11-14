// SPDX-License-Identifier: GPL-3.0-only
import { isRecord, noInput, SKILL_API_VERSION } from '../../skill-sdk/src/index.mjs';

const boolean = (value) => typeof value === 'boolean';
const string = (value) => typeof value === 'string';
const folderId = (value) => string(value) && value.length <= 80;
const settingsOnly = ['settings'];
const settingsAndCompanion = ['settings', 'companion'];

function skill(id, commands, ui) {
  return {
    manifest: {
      id,
      apiVersion: SKILL_API_VERSION,
      version: '1.0.0',
      requires: Object.keys(commands),
      commands,
      ...(ui ? { ui } : {}),
    },
    create({ ports }) {
      return {
        invoke(command, input) {
          return ports[command](input);
        },
      };
    },
  };
}

const initiativePreferences = (value) =>
  isRecord(value) && string(value.level) && Array.isArray(value.excludedApps);
const initiativeSnapshot = (value) =>
  isRecord(value) &&
  string(value.reason) &&
  Number.isFinite(value.nextAt) &&
  Array.isArray(value.history);

export const initiativeSkill = skill(
  'capri.initiative',
  {
    configure: { input: isRecord, output: initiativePreferences, sources: settingsAndCompanion },
    snapshot: { input: noInput, output: initiativeSnapshot, sources: ['host'] },
    test: { input: noInput, output: initiativeSnapshot, sources: settingsAndCompanion },
    dismiss: { input: noInput, output: boolean, sources: settingsAndCompanion },
    restore: { input: noInput, output: boolean, sources: settingsAndCompanion },
  },
  { sectionId: 'initiative', labelKey: 'Initiative' },
);

const brainPreferences = (value) =>
  isRecord(value) && boolean(value.enabled) && boolean(value.shareWithApi);
const brainSnapshot = (value) =>
  brainPreferences(value) &&
  boolean(value.busy) &&
  Number.isInteger(value.indexed) &&
  Number.isInteger(value.skipped);
const brainSearchResults = (value) =>
  Array.isArray(value) &&
  value.every((entry) => isRecord(entry) && string(entry.content) && string(entry.source));

export const brainSkill = skill(
  'capri.brain',
  {
    status: { input: noInput, output: brainSnapshot, sources: settingsOnly },
    open: { input: noInput, output: boolean, sources: settingsOnly },
    refresh: { input: noInput, output: brainSnapshot, sources: settingsOnly },
    search: { input: string, output: brainSearchResults, sources: settingsOnly },
    configure: { input: brainPreferences, output: brainSnapshot, sources: settingsOnly },
    context: {
      input: (value) => isRecord(value) && string(value.query) && boolean(value.remote),
      output: string,
      sources: ['chat'],
    },
  },
  { sectionId: 'knowledge', labelKey: 'Brain and private memory' },
);

const vaultSnapshot = (value) =>
  isRecord(value) &&
  boolean(value.exists) &&
  boolean(value.unlocked) &&
  Number.isInteger(value.count) &&
  boolean(value.busy);
const privateNotes = (value) =>
  Array.isArray(value) &&
  value.every((entry) => isRecord(entry) && string(entry.id) && string(entry.text));

export const privateMemorySkill = skill('capri.private-memory', {
  status: { input: noInput, output: vaultSnapshot, sources: settingsOnly },
  lock: { input: noInput, output: vaultSnapshot, sources: settingsOnly },
  create: { input: string, output: vaultSnapshot, sources: settingsOnly },
  unlock: { input: string, output: vaultSnapshot, sources: settingsOnly },
  list: { input: noInput, output: privateNotes, sources: settingsOnly },
  add: { input: string, output: privateNotes, sources: settingsOnly },
  remove: { input: string, output: privateNotes, sources: settingsOnly },
  password: {
    input: (value) => isRecord(value) && string(value.oldPassword) && string(value.password),
    output: vaultSnapshot,
    sources: settingsOnly,
  },
});

const fileAccessSnapshot = (value) =>
  isRecord(value) &&
  Array.isArray(value.scopes) &&
  (value.warning === null || string(value.warning));

export const fileAccessSkill = skill(
  'capri.file-access',
  {
    snapshot: { input: noInput, output: fileAccessSnapshot, sources: ['host'] },
    grant: { input: string, output: fileAccessSnapshot, sources: settingsAndCompanion },
    write: {
      input: (value) => isRecord(value) && folderId(value.id) && boolean(value.write),
      output: fileAccessSnapshot,
      sources: settingsAndCompanion,
    },
    revoke: { input: folderId, output: fileAccessSnapshot, sources: settingsAndCompanion },
    clear: { input: noInput, output: fileAccessSnapshot, sources: settingsAndCompanion },
  },
  { sectionId: 'files', labelKey: 'File access' },
);

export const attachmentViewerSkill = skill('capri.attachment-viewer', {
  open: { input: string, output: boolean, sources: ['companion'] },
});
