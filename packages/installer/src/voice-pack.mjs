// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  lstatSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  constants,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { noLinks, readJson } from './policy.mjs';

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
export function importVoicePack(folder, root, expectedModel) {
  const pack = validateVoicePack(folder, expectedModel);
  const relative = 'data/voices/capri/en/exports/' + pack.profile.id;
  for (const entry of pack.entries) {
    const source = path.join(folder, entry.file);
    const target = path.join(root, relative, entry.file);
    noLinks(target);
    if (existsSync(target)) {
      if (!sameVoiceFile(source, target))
        throw new Error(
          'A different voice pack already uses this ID. Existing voice data was preserved.',
        );
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
  }
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
  return destination;
}
