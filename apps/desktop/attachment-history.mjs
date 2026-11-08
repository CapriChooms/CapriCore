// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from '../../packages/installer/src/policy.mjs';
import { PRIVATE_STORAGE_OVERHEAD, isLegacySealed } from './legacy-private-storage.mjs';

export const ATTACHMENT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FILE = /^([a-f0-9-]{36})\.(thumb|preview)\.png(?:\.([a-f0-9-]{36})\.tmp)?$/;
const MAX_PREVIEW = 3 * 1024 * 1024;
const MAX_THUMB = 512 * 1024;
const MAX_ARCHIVE = 128 * 1024 * 1024;
const kinds = new Set(['image', 'document', 'video', 'animation']);

export function attachmentName(value) {
  if (typeof value !== 'string') return 'Attachment';
  return (
    value
      .replace(/\\/g, '/')
      .split('/')
      .at(-1)
      .normalize('NFC')
      .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim()
      .slice(-160) || 'Attachment'
  );
}

/** Canonical display metadata only. Never retain extra paths, URLs or document content. */
export function historyAttachments(values) {
  if (!Array.isArray(values) || values.length > 4) return [];
  const ids = new Set();
  return values.flatMap((value) => {
    if (
      !value ||
      typeof value.id !== 'string' ||
      !ATTACHMENT_ID.test(value.id) ||
      ids.has(value.id) ||
      typeof value.name !== 'string' ||
      !kinds.has(value.kind) ||
      !Number.isInteger(value.bytes) ||
      value.bytes < 1 ||
      value.bytes > 32 * 1024 * 1024 ||
      typeof value.preview !== 'boolean'
    )
      return [];
    ids.add(value.id);
    const dimensions =
      Number.isInteger(value.width) &&
      Number.isInteger(value.height) &&
      value.width > 0 &&
      value.width <= 1280 &&
      value.height > 0 &&
      value.height <= 720;
    return [
      {
        id: value.id,
        name: attachmentName(value.name),
        kind: value.kind,
        bytes: value.bytes,
        ...(dimensions ? { width: value.width, height: value.height } : {}),
        preview: value.kind !== 'document' && dimensions && value.preview,
      },
    ];
  });
}

function png(bytes, maximum) {
  return (
    Buffer.isBuffer(bytes) &&
    bytes.length >= 33 &&
    bytes.length <= maximum &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(16) <= 1280 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.readUInt32BE(20) <= 720
  );
}

/** Private, bounded image derivatives. The current transcript is the only index. */
export class AttachmentHistory {
  constructor({
    directory,
    references,
    normalizeImage,
    maximumBytes = MAX_ARCHIVE,
    canPrune = () => true,
    privacy,
  }) {
    this.directory = path.resolve(directory);
    this.references = references;
    this.normalizeImage = normalizeImage;
    this.canPrune = canPrune;
    this.privacy = privacy;
    this.maximumBytes =
      Number.isSafeInteger(maximumBytes) && maximumBytes >= 0
        ? Math.min(MAX_ARCHIVE, maximumBytes)
        : MAX_ARCHIVE;
  }
  root(create = false) {
    noLinks(this.directory);
    if (!existsSync(this.directory)) {
      if (!create) return false;
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    }
    const info = lstatSync(this.directory);
    const actual = realpathSync(this.directory);
    const normalized = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    if (!info.isDirectory() || normalized(actual) !== normalized(this.directory))
      throw new Error('Attachment storage is unavailable.');
    return true;
  }
  entries() {
    if (!this.root()) return [];
    return readdirSync(this.directory).flatMap((name) => {
      const match = FILE.exec(name);
      if (!match || !ATTACHMENT_ID.test(match[1]) || (match[3] && !ATTACHMENT_ID.test(match[3])))
        return [];
      const file = path.join(this.directory, name);
      const info = lstatSync(file);
      return info.isFile() && !info.isSymbolicLink()
        ? [
            {
              id: match[1],
              file,
              bytes: info.size,
              modified: info.mtimeMs,
              temporary: Boolean(match[3]),
            },
          ]
        : [];
    });
  }
  metadata(id) {
    if (typeof id !== 'string' || !ATTACHMENT_ID.test(id)) return null;
    for (const message of this.references())
      for (const value of historyAttachments(message.attachments))
        if (value.id === id) return value;
    return null;
  }
  legacyLocked(entry) {
    let descriptor;
    try {
      noLinks(entry.file);
      descriptor = openSync(entry.file, 'r');
      const header = Buffer.alloc(PRIVATE_STORAGE_OVERHEAD - 12 - 16);
      readSync(descriptor, header, 0, header.length, 0);
      if (!isLegacySealed(header)) return false;
      if (!this.privacy || entry.bytes > MAX_PREVIEW + PRIVATE_STORAGE_OVERHEAD) return true;
      const variant = entry.file.endsWith('.thumb.png') ? 'thumb' : 'preview';
      const bytes = Buffer.alloc(entry.bytes);
      if (readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) return true;
      this.privacy.open(bytes, `attachment:${entry.id}:${variant}`);
      return false;
    } catch {
      // Automatic retention must not destroy recoverable files when their old
      // journal/key is missing, or access/authentication has failed.
      return true;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  prune() {
    if (!this.canPrune()) return;
    try {
      const ids = new Set(
        this.references().flatMap((message) =>
          historyAttachments(message.attachments)
            .filter((v) => v.preview)
            .map((v) => v.id),
        ),
      );
      for (const entry of this.entries()) {
        if (entry.temporary || !ids.has(entry.id)) {
          if (this.legacyLocked(entry)) continue;
          try {
            unlinkSync(entry.file);
          } catch {
            /* Retry a locked derivative on the next pass. */
          }
        }
      }
    } catch {
      // A filesystem failure never removes the conversation or exposes its path.
    }
  }
  makeRoom(bytes) {
    const entries = this.entries().sort((a, b) => a.modified - b.modified);
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const removed = new Set();
    for (const entry of entries) {
      if (total + bytes <= this.maximumBytes) break;
      if (removed.has(entry.id)) continue;
      const members = entries.filter((value) => value.id === entry.id);
      if (members.some((member) => this.legacyLocked(member))) continue;
      removed.add(entry.id);
      for (const member of members) {
        unlinkSync(member.file);
        total -= member.bytes;
      }
    }
    if (total + bytes > this.maximumBytes) throw new Error('Attachment preview limit reached.');
  }
  write(id, variant, bytes) {
    const file = path.join(this.directory, id + '.' + variant + '.png');
    noLinks(file);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* Already renamed or never created. */
      }
    }
  }
  persist(attachments) {
    const canSave = this.canPrune();
    this.prune();
    return attachments
      .map((attachment) => {
        const metadata = {
          ...attachment.metadata,
          id: randomUUID(),
          preview: false,
        };
        if (attachment.png && canSave) {
          try {
            const encoded = this.normalizeImage(attachment.png);
            if (!png(encoded.preview, MAX_PREVIEW) || !png(encoded.thumb, MAX_THUMB))
              throw new Error();
            metadata.width = encoded.preview.readUInt32BE(16);
            metadata.height = encoded.preview.readUInt32BE(20);
            this.root(true);
            this.makeRoom(encoded.preview.length + encoded.thumb.length);
            this.write(metadata.id, 'preview', encoded.preview);
            this.write(metadata.id, 'thumb', encoded.thumb);
            metadata.preview = true;
          } catch {
            // The file card remains available even when previews cannot be saved.
            for (const variant of ['preview', 'thumb']) {
              try {
                if (this.root())
                  unlinkSync(path.join(this.directory, metadata.id + '.' + variant + '.png'));
              } catch {
                /* A startup/pruning pass can clean an orphan later. */
              }
            }
          }
        }
        return historyAttachments([metadata])[0];
      })
      .filter(Boolean);
  }
  read(id, variant) {
    const metadata = this.metadata(id);
    if (!metadata?.preview || !['thumb', 'preview'].includes(variant)) return null;
    try {
      if (!this.root()) return null;
      const file = path.join(this.directory, id + '.' + variant + '.png');
      noLinks(file);
      const info = lstatSync(file);
      const maximum = variant === 'thumb' ? MAX_THUMB : MAX_PREVIEW;
      if (!info.isFile() || info.nlink !== 1 || info.size > maximum + PRIVATE_STORAGE_OVERHEAD)
        return null;
      let bytes = readFileSync(file);
      if (isLegacySealed(bytes)) {
        if (!this.privacy) return null;
        bytes = this.privacy.open(bytes, `attachment:${id}:${variant}`);
      }
      return png(bytes, maximum) ? bytes : null;
    } catch {
      return null;
    }
  }
  clear() {
    try {
      for (const entry of this.entries()) unlinkSync(entry.file);
    } catch {
      /* No arbitrary paths. */
    }
  }
}
