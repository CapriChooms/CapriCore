// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  lstatSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempDisposableSync,
  renameSync,
  unlinkSync,
  constants,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { noLinks, readJson } from './policy.mjs';
import russian from '../../../config/qwen-ru-voice.json' with { type: 'json' };

const voiceExports = 'data/voices/capri/en/exports/';
const bundledRevisions = 'data/speech/voice-pack-revisions/';
const bundledVoiceId = 'capri-en-v1';
export const BUNDLED_VOICE_PROFILE = voiceExports + bundledVoiceId;
export const BUNDLED_VOICE_LOCATIONS = [
  BUNDLED_VOICE_PROFILE,
  'data/speech/bundled-voice',
  '.runtime/installer/bundled-voice',
  '.bundled-voice',
];

export function validateRussianVoicePack(source) {
  noLinks(source);
  for (const entry of russian.pack.files) {
    const file = path.join(source, entry.file);
    noLinks(file);
    if (
      !existsSync(file) ||
      !lstatSync(file).isFile() ||
      lstatSync(file).size !== entry.bytes ||
      createHash('sha256').update(readFileSync(file)).digest('hex') !== entry.sha256
    )
      throw new Error('The included Russian voice pack is missing or failed verification.');
  }
}

/** Copy only the two pinned Russian inference artifacts, with no dataset files. */
export function copyRussianVoicePack(source, destination) {
  validateRussianVoicePack(source);
  noLinks(destination);
  mkdirSync(destination, { recursive: true });
  for (const { file } of russian.pack.files) {
    const sourceFile = path.join(source, file);
    const target = path.join(destination, file);
    noLinks(target);
    if (existsSync(target) && sameVoiceFile(sourceFile, target)) continue;
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      copyFileSync(sourceFile, temporary, constants.COPYFILE_EXCL);
      noLinks(target);
      renameSync(temporary, target);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}

export function validateVoicePack(folder, expectedModel) {
  noLinks(folder);
  const fail = (code, message) => Object.assign(new Error(message), { code });
  if (!existsSync(folder) || !lstatSync(folder).isDirectory())
    throw fail(
      'VOICE_PACK_FOLDER_MISSING',
      'Choose an existing exported voice-pack folder, or turn off voice import.',
    );
  const profileFile = path.join(folder, 'voice-profile.json');
  noLinks(profileFile);
  if (!existsSync(profileFile) || !lstatSync(profileFile).isFile())
    throw fail(
      'VOICE_PACK_PROFILE_MISSING',
      'The selected folder has no voice-profile.json. Choose an exported voice pack, or turn off voice import to continue with text replies.',
    );
  let profile;
  try {
    profile = readJson(profileFile);
  } catch {
    throw fail(
      'VOICE_PACK_PROFILE_INVALID',
      'The selected voice-profile.json is not a valid voice-pack manifest.',
    );
  }
  if (
    profile.schemaVersion !== 1 ||
    profile.engine !== 'chatterbox-turbo' ||
    profile.language !== 'en' ||
    !/^[a-z0-9-]{1,64}$/.test(profile.id ?? '') ||
    !isDeepStrictEqual(profile.baseModel, expectedModel)
  )
    throw fail(
      'VOICE_PACK_PROFILE_INVALID',
      'This voice pack is incompatible with the pinned English voice runtime',
    );
  if (profile.adapter !== 'adapter.safetensors' || profile.adapterConfig !== 'adapter.json')
    throw new Error('Invalid voice adapter filenames');
  const entries = [
    { file: 'voice-profile.json' },
    { file: profile.adapter, hash: profile.adapterSha256 },
    { file: profile.adapterConfig },
  ];
  const references = Object.values(profile.references ?? {});
  if (!references.length || references.length > 8) throw new Error('Invalid voice references');
  entries.push(...references.map((value) => ({ file: value.file, hash: value.sha256 })));
  const seen = new Set();
  for (const entry of entries) {
    if (
      typeof entry.file !== 'string' ||
      !/^(?:voice-profile\.json|adapter\.safetensors|adapter\.json|references\/[a-z0-9_-]+\.wav)$/.test(
        entry.file,
      ) ||
      seen.has(entry.file)
    )
      throw new Error('Invalid voice pack filename');
    seen.add(entry.file);
    if ((entry.file.endsWith('.wav') || entry.file.endsWith('.safetensors')) && !entry.hash)
      throw new Error('Missing voice checksum');
    const file = path.join(folder, entry.file);
    noLinks(file);
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).size > 200 * 1024 ** 2)
      throw new Error('Voice pack file is missing or too large');
    if (
      entry.hash &&
      (!/^[a-f0-9]{64}$/.test(entry.hash) ||
        createHash('sha256').update(readFileSync(file)).digest('hex') !== entry.hash)
    )
      throw new Error('Voice pack checksum mismatch');
  }
  readJson(path.join(folder, profile.adapterConfig));
  return { profile, entries };
}
export const voiceModelPins = (upstream) =>
  Object.fromEntries(Object.entries(upstream ?? {}).filter(([key]) => key !== 'bundledPack'));

export function isBundledVoiceProfile(relative) {
  const prefix = bundledRevisions + bundledVoiceId + '-';
  return (
    relative === BUNDLED_VOICE_PROFILE ||
    (typeof relative === 'string' &&
      relative.startsWith(prefix) &&
      /^[0-9a-f]{24}(?:-[1-9]\d*)?$/.test(relative.slice(prefix.length)))
  );
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function voiceFileDigest(folder, name) {
  const file = path.join(folder, name);
  noLinks(file);
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 200 * 1024 ** 2) throw new Error('Invalid voice pack file');
  if (!name.endsWith('.json')) return sha256(readFileSync(file));
  let data = readJson(file);
  // The release archive's URL and checksum can change with identical model and voice data.
  if (name === 'adapter.json' && isObject(data?.upstream))
    data = { ...data, upstream: voiceModelPins(data.upstream) };
  return sha256(
    JSON.stringify(data, (_key, value) =>
      isObject(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
    ),
  );
}

function matchesPack(folder, files) {
  try {
    return files.every(({ file, digest }) => voiceFileDigest(folder, file) === digest);
  } catch {
    // A damaged or unreadable older export occupies its path and stays untouched.
    return false;
  }
}

/** Caller owns the installation lock. Publish only a complete, validated directory. */
export function importVoicePack(folder, root, expectedModel, { bundled = false } = {}) {
  const { entries, profile } = validateVoicePack(folder, expectedModel);
  const files = entries.map(({ file, hash }) => ({
    file,
    digest: hash ?? voiceFileDigest(folder, file),
  }));
  const base = voiceExports + profile.id;
  noLinks(path.join(root, voiceExports));
  let relative = base;
  if (lstatSync(path.join(root, relative), { throwIfNoEntry: false })) {
    if (matchesPack(path.join(root, relative), files)) return relative;
    const fingerprint = sha256(
      JSON.stringify(files.sort((a, b) => a.file.localeCompare(b.file, 'en'))),
    );
    const revision =
      (bundled && profile.id === bundledVoiceId ? bundledRevisions : voiceExports) +
      profile.id +
      '-' +
      fingerprint.slice(0, 24);
    relative = revision;
    noLinks(path.dirname(path.join(root, revision)));
    for (
      let number = 2;
      lstatSync(path.join(root, relative), { throwIfNoEntry: false });
      number++
    ) {
      if (matchesPack(path.join(root, relative), files)) return relative;
      relative = revision + '-' + number;
    }
  }
  const destination = path.join(root, relative);
  noLinks(destination);
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  using staging = mkdtempDisposableSync(path.join(parent, '.voice-import-'));
  const payload = path.join(staging.path, 'pack');
  for (const { file } of files) {
    const source = path.join(folder, file);
    const target = path.join(payload, file);
    noLinks(source);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
  }
  if (!matchesPack(payload, files)) throw new Error('The voice pack changed during import.');
  renameSync(payload, destination);
  return relative;
}

function sameVoiceFile(source, target) {
  const info = lstatSync(target);
  return (
    info.isFile() &&
    info.size === lstatSync(source).size &&
    createHash('sha256').update(readFileSync(target)).digest('hex') ===
      createHash('sha256').update(readFileSync(source)).digest('hex')
  );
}

/** Retain the installer seed outside editable exports, including in text mode. */
export function cacheBundledVoicePack(folder, root, expectedModel) {
  const pack = validateVoicePack(folder, expectedModel);
  const destination = path.join(root, 'data/speech/bundled-voice');
  noLinks(destination);
  for (const entry of pack.entries) {
    const source = path.join(folder, entry.file);
    const target = path.join(destination, entry.file);
    noLinks(target);
    if (existsSync(target) && sameVoiceFile(source, target)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      copyFileSync(source, temporary, constants.COPYFILE_EXCL);
      noLinks(target);
      renameSync(temporary, target);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  const russianSource = path.join(folder, 'russian');
  if (existsSync(russianSource))
    copyRussianVoicePack(russianSource, path.join(root, russian.pack.directory));
  return destination;
}
