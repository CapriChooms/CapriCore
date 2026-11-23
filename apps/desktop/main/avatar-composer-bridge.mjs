// SPDX-License-Identifier: GPL-3.0-only
import { open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

const maximumDraft = 8000;
const maximumFiles = 4;
const ordinaryFileLimit = 8 * 1024 * 1024;
const videoFileLimit = 32 * 1024 * 1024;
const supportedFiles = new Set([
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'log',
  'docx',
  'odt',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp4',
  'webm',
]);
const videoFiles = new Set(['mp4', 'webm']);
const labelKeys = [
  'message',
  'placeholder',
  'attach',
  'attachments',
  'microphone',
  'send',
  'sendHint',
  'remove',
  'working',
  'microphoneLoading',
  'actionFailed',
  'unavailable',
  'keyboard',
  'menu',
];
const themeKeys = ['cyan', 'pink', 'theme-panel', 'theme-background', 'theme-border', 'theme-text'];
const isRecord = (value) =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const field = (value, key) =>
  isRecord(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const text = (value, maximum) =>
  typeof value === 'string'
    ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, maximum)
    : '';
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const fileName = (value) => text(basename(value.replace(/\\/g, '/')), 160);
const typedArrayBytes = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
).get;
const copyBytes = Uint8Array.prototype.set;

function pastedFiles(value, invalid) {
  if (!Array.isArray(value) || value.length > maximumFiles) return invalid();
  const expected = ['length', ...Array.from({ length: value.length }, (_, index) => String(index))];
  if (
    Reflect.ownKeys(value).length !== expected.length ||
    Reflect.ownKeys(value).some((key) => !expected.includes(key))
  )
    return invalid();
  const files = [];
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index))?.value;
    if (!isRecord(item)) return invalid();
    const keys = Reflect.ownKeys(item);
    if (
      keys.length !== 2 ||
      keys.some((key) => !['name', 'bytes'].includes(key)) ||
      keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value'))
    )
      return invalid();
    const name = field(item, 'name');
    const bytes = field(item, 'bytes');
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 160 ||
      name === '.' ||
      name === '..' ||
      /[\\/:\x00-\x1f\x7f]/.test(name) ||
      !ArrayBuffer.isView(bytes) ||
      !(bytes instanceof Uint8Array)
    )
      return invalid();
    const extension = /\.([a-z\d]{1,8})$/i.exec(name)?.[1].toLowerCase();
    const limit = videoFiles.has(extension) ? videoFileLimit : ordinaryFileLimit;
    let copy;
    try {
      const length = typedArrayBytes.call(bytes);
      if (length > limit) return invalid();
      copy = new Uint8Array(length);
      copyBytes.call(copy, bytes);
    } catch {
      return invalid();
    }
    files.push({ name, bytes: copy });
  }
  return files;
}

/** Return only the intent shape understood by the owner; never accept arbitrary commands. */
export function validateAvatarComposerAction(value) {
  const invalid = () => {
    throw new Error('Invalid composer action.');
  };
  if (!isRecord(value)) return invalid();
  const type = field(value, 'type');
  const keys = {
    edit: ['type', 'draft', 'revision'],
    submit: ['type'],
    attach: ['type'],
    remove: ['type', 'id'],
    microphone: ['type'],
    keyboard: ['type'],
    menu: ['type'],
    thinking: ['type', 'enabled'],
    internet: ['type', 'enabled'],
    'paste-files': ['type', 'files', 'overflow'],
  };
  if (typeof type !== 'string' || !Object.hasOwn(keys, type)) return invalid();
  const expected = keys[type];
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key)) ||
    actual.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  )
    return invalid();
  if (type === 'paste-files') {
    const overflow = field(value, 'overflow');
    if (typeof overflow !== 'boolean') return invalid();
    return { type, files: pastedFiles(field(value, 'files'), invalid), overflow };
  }
  if (type === 'edit') {
    const draft = field(value, 'draft');
    const version = field(value, 'revision');
    if (typeof draft !== 'string' || draft.length > maximumDraft || !revision(version))
      return invalid();
    return { type, draft, revision: version };
  }
  if (type === 'remove') {
    const id = field(value, 'id');
    if (!validId(id)) return invalid();
    return { type, id };
  }
  if (type === 'thinking' || type === 'internet') {
    const enabled = field(value, 'enabled');
    if (typeof enabled !== 'boolean') return invalid();
    return { type, enabled };
  }
  return { type };
}

function color(value) {
  if (typeof value !== 'string' || value.length > 96) return '';
  const trimmed = value.trim();
  return /^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgba?|hsla?)\([\d.,%+\-/\s]*(?:deg|rad|turn)?[\d.,%+\-/\s]*\))$/i.test(
    trimmed,
  )
    ? trimmed
    : '';
}

/** A complete small presentation snapshot, with no owner configuration or file paths. */
export function sanitizeAvatarComposerState(value) {
  const mic = field(value, 'microphone');
  const thinking = field(value, 'thinking');
  const internet = field(value, 'internet');
  const labels = field(value, 'labels');
  const theme = field(value, 'theme');
  const attachments = field(value, 'attachments');
  const draftRevision = field(value, 'draftRevision');
  const locale = field(value, 'locale');
  const result = {
    draft: text(field(value, 'draft'), maximumDraft),
    draftRevision: revision(draftRevision) ? draftRevision : 0,
    canSend: field(value, 'canSend') === true,
    canAttach: field(value, 'canAttach') === true,
    showAttach: field(value, 'showAttach') !== false,
    busy: field(value, 'busy') === true,
    attachments: [],
    microphone: {
      loading: field(mic, 'loading') === true,
      listening: field(mic, 'listening') === true,
      disabled: field(mic, 'disabled') !== false,
      label: text(field(mic, 'label'), 160),
    },
    thinking: {
      ...(field(thinking, 'visible') === false ? { visible: false } : {}),
      enabled: field(thinking, 'enabled') === true,
      label: text(field(thinking, 'label'), 160),
      hint: text(field(thinking, 'hint'), 200),
    },
    internet: {
      ...(field(internet, 'visible') === false ? { visible: false } : {}),
      enabled: field(internet, 'enabled') === true,
      label: text(field(internet, 'label'), 160),
      hint: text(field(internet, 'hint'), 400),
    },
    labels: {},
    locale:
      typeof locale === 'string' &&
      locale.length <= 64 &&
      /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(locale)
        ? locale
        : '',
    error: text(field(value, 'error'), 400),
    status: text(field(value, 'status'), 400),
    theme: {},
  };
  if (Array.isArray(attachments)) {
    const ids = new Set();
    for (const item of attachments.slice(0, maximumFiles)) {
      const id = field(item, 'id');
      const name = field(item, 'name');
      if (!validId(id) || ids.has(id) || typeof name !== 'string') continue;
      const safeName = fileName(name);
      if (!safeName || safeName === '.' || safeName === '..') continue;
      ids.add(id);
      result.attachments.push({ id, name: safeName });
    }
  }
  for (const key of labelKeys) {
    const label = text(field(labels, key), 200);
    if (label) result.labels[key] = label;
  }
  for (const key of themeKeys) {
    const safeColor = color(field(theme, key));
    if (safeColor) result.theme[key] = safeColor;
  }
  return result;
}

async function readSelectedFile(path) {
  let handle;
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error();
    handle = await open(path, 'r');
    const stat = await handle.stat();
    const name = fileName(path);
    const extension = /\.([a-z\d]{1,8})$/i.exec(name)?.[1].toLowerCase();
    const limit = videoFiles.has(extension) ? videoFileLimit : ordinaryFileLimit;
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size > limit || !name)
      throw new Error();
    if (!supportedFiles.has(extension)) return { name, bytes: new Uint8Array() };
    const chunks = [];
    let size = 0;
    // Do not use readFile: a file can grow after stat, and its allocation must stay bounded.
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw new Error();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { name, bytes: new Uint8Array(Buffer.concat(chunks, size)) };
  } catch {
    throw new Error('Could not read the selected file.');
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Only main's native-dialog paths enter here; no renderer path or fs capability is exposed. */
export async function readSelectedComposerFiles(filePaths, maxFiles = maximumFiles) {
  if (
    !Array.isArray(filePaths) ||
    !Number.isSafeInteger(maxFiles) ||
    maxFiles < 0 ||
    maxFiles > maximumFiles
  )
    throw new Error('Could not read the selected files.');
  const files = [];
  for (const path of filePaths.slice(0, maxFiles)) files.push(await readSelectedFile(path));
  return files;
}
