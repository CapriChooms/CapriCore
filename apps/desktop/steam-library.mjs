// SPDX-License-Identifier: GPL-3.0-only
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

const russianSounds = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'u',
  я: 'a',
};
const normalizeTitle = (title) =>
  title.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
export const romanizeSteamTitle = (title) =>
  title.toLowerCase().replace(/[а-яё]/gu, (letter) => russianSounds[letter]);

function titleSounds(title) {
  const words = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map(
    (word) =>
      romanizeSteamTitle(word)
        .replace(/ch(?=[aeiouy])/gu, 'h')
        .replace(/ph/gu, 'f')
        .replace(/c(?=[eiy])/gu, 's')
        .replace(/c/gu, 'k')
        .replace(/[aeiouy]/gu, '') || '?',
  );
}

export function matchSteamTitle(title, games) {
  const requested = normalizeTitle(title);
  const unique = ([first, ...others]) =>
    first && others.every(({ appId }) => appId === first.appId) ? first : null;
  const exact = games.filter((game) => normalizeTitle(game.name) === requested);
  if (exact.length) return unique(exact);
  // Speech recognition can write a foreign title in Cyrillic. Only accept a
  // unique match with the same word order, consonants and numbers.
  if (!/[а-яё]/u.test(requested)) return null;
  const sounds = titleSounds(requested);
  const consonants = sounds.join('').replace(/[^a-z]/gu, '').length;
  if (consonants < 4 || (consonants < 6 && !/\d/u.test(requested))) return null;
  return unique(
    games.filter((game) => {
      const candidate = normalizeTitle(game.name);
      return (
        /[a-z]/u.test(candidate) &&
        !/[а-яё]/u.test(candidate) &&
        titleSounds(candidate).join(' ') === sounds.join(' ')
      );
    }),
  );
}

async function readVdf(file, maxBytes) {
  let handle;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead <= maxBytes ? buffer.toString('utf8', 0, bytesRead) : '';
  } catch {
    return '';
  } finally {
    await handle?.close();
  }
}

export function isSteamExecutable(file) {
  return Boolean(
    file &&
      path.isAbsolute(file) &&
      !/^[\\/]{2}/u.test(file) &&
      path.basename(file).toLowerCase() === 'steam.exe',
  );
}

export async function readSteamLibraries(steamExecutable) {
  if (!isSteamExecutable(steamExecutable)) return [];
  const steamRoot = path.normalize(path.dirname(steamExecutable));
  const libraryFile = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  const folders = await readVdf(libraryFile, 256 * 1024);
  const libraryKey = (library) => (process.platform === 'win32' ? library.toLowerCase() : library);
  const libraryRoots = new Map([[libraryKey(steamRoot), steamRoot]]);
  for (const [, value] of folders.matchAll(/^\s*"path"\s+"([^"\r\n]+)"/gmu)) {
    const library = value.replace(/\\\\/gu, '\\');
    if (path.isAbsolute(library) && !/^[\\/]{2}/u.test(library)) {
      const full = path.normalize(library);
      libraryRoots.set(libraryKey(full), full);
    }
    if (libraryRoots.size === 32) break;
  }
  return [...libraryRoots.values()];
}

export async function readSteamManifest(library, appId) {
  if (!/^\d{1,10}$/u.test(appId)) return null;
  const manifest = await readVdf(
    path.join(library, 'steamapps', `appmanifest_${appId}.acf`),
    64 * 1024,
  );
  const field = (key) =>
    manifest
      .match(new RegExp(`^\\s*"${key}"\\s+"((?:[^"\\\\\\r\\n]|\\\\.)*)"`, 'mu'))?.[1]
      ?.replace(/\\(["\\])/gu, '$1');
  if (field('appid') !== appId || !field('name')) return null;
  const folder = field('installdir');
  const installPath =
    folder && /^[^\\/:*?"<>|]+$/u.test(folder) && folder !== '.' && folder !== '..'
      ? path.join(library, 'steamapps', 'common', folder)
      : null;
  return {
    appId,
    name: field('name'),
    library,
    installPath,
    installed: Boolean(Number(field('StateFlags')) & 4),
    downloading: Number(field('BytesToDownload')) > Number(field('BytesDownloaded') ?? 0),
  };
}

export async function resolveSteamLibraryGame(steamExecutable, title, signal, libraries = null) {
  const games = [];
  for (const library of libraries ?? (await readSteamLibraries(steamExecutable))) {
    signal?.throwIfAborted();
    const steamapps = path.join(library, 'steamapps');
    const files = await readdir(steamapps, { withFileTypes: true }).catch(() => []);
    const manifests = files
      .filter((file) => file.isFile() && /^appmanifest_\d{1,10}\.acf$/u.test(file.name))
      .slice(0, 4096);
    for (let offset = 0; offset < manifests.length; offset += 32) {
      signal?.throwIfAborted();
      const batch = await Promise.all(
        manifests.slice(offset, offset + 32).map(({ name }) => {
          const appId = name.slice('appmanifest_'.length, -'.acf'.length);
          return readSteamManifest(library, appId);
        }),
      );
      games.push(...batch.filter(Boolean));
    }
  }
  signal?.throwIfAborted();
  const match = matchSteamTitle(title, games);
  if (!match) return null;
  const copies = games.filter(({ appId }) => appId === match.appId);
  return copies.find((game) => game.installed) ?? copies.find((game) => game.downloading) ?? match;
}
