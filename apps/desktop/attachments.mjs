// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';
import { snapshotBytes } from './visual-service.mjs';
import { attachmentName } from './attachment-history.mjs';
import {
  TEXT_ATTACHMENTS,
  OFFICE_ATTACHMENTS,
  IMAGE_ATTACHMENTS,
  FRAME_ATTACHMENTS,
} from '../../packages/skills/src/attachment-formats.mjs';

const MAX_FILES = 4;
const MAX_TEXT = 12000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL = 5 * 1024 * 1024;
const LEASE_MS = 15 * 60 * 1000;
const textFiles = new Set(TEXT_ATTACHMENTS);
const officeFiles = OFFICE_ATTACHMENTS;
const mediaFiles = new Set([...IMAGE_ATTACHMENTS, ...FRAME_ATTACHMENTS]);

function officeXml(bytes, name) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) throw new Error();
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  if (count > 4096 || start >= end) throw new Error();
  for (let index = 0, at = start; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error();
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const next = at + 46 + nameLength + extra + comment;
    if (next > end) throw new Error();
    if (bytes.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const offset = bytes.readUInt32LE(at + 42);
      const compressed = bytes.readUInt32LE(at + 20);
      const size = bytes.readUInt32LE(at + 24);
      const method = bytes.readUInt16LE(at + 10);
      if (
        size > 1024 * 1024 ||
        bytes.readUInt16LE(at + 8) & 1 ||
        offset + 30 > start ||
        bytes.readUInt32LE(offset) !== 0x04034b50
      )
        throw new Error();
      const first = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      if (first + compressed > start || ![0, 8].includes(method)) throw new Error();
      const member = bytes.subarray(first, first + compressed);
      const plain =
        method === 0 ? member : inflateRawSync(member, { maxOutputLength: 1024 * 1024 });
      if (plain.length !== size || crc32(plain) !== bytes.readUInt32LE(at + 16)) throw new Error();
      return new TextDecoder('utf-8', { fatal: true }).decode(plain);
    }
    at = next;
  }
  throw new Error();
}

export function textFromFile(bytes, extension) {
  if (textFiles.has(extension)) {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  }
  const xml = officeXml(bytes, officeFiles[extension]);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error();
  const entities = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };
  return xml
    .replace(/<\/(?:w:p|text:[ph])>/g, '\n')
    .replace(/<(?:w:tab|text:tab)\b[^>]*>/g, '\t')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|apos|quot|lt|gt);/g, (token) => entities[token.slice(1, -1)]);
}

/** In-memory drafts bound to the active companion main frame. */
export class AttachmentDrafts {
  constructor({ canSee, validImage, now = Date.now }) {
    Object.assign(this, { canSee, validImage, now });
    this.drafts = new Map();
  }
  prune() {
    for (const [id, value] of this.drafts)
      if (this.now() >= value.until) this.remove(id, value.owner);
  }
  add(value, owner) {
    this.prune();
    if (!owner || this.drafts.size >= MAX_FILES)
      return { accepted: false, message: 'Attach up to four files at once.' };
    const name = typeof value?.name === 'string' ? value.name : '';
    const extension = /\.([a-z\d]{1,8})$/i.exec(name)?.[1].toLowerCase();
    const image = mediaFiles.has(extension);
    if (image && !this.canSee())
      return { accepted: false, message: 'The active model cannot read images or video frames.' };
    if (!image && !textFiles.has(extension) && !Object.hasOwn(officeFiles, extension))
      return { accepted: false, message: 'Capri cannot read this file format yet.' };
    if (
      !(value.bytes instanceof Uint8Array) ||
      !value.bytes.byteLength ||
      value.bytes.byteLength > MAX_BYTES
    )
      return { accepted: false, message: 'This file is empty or too large.' };
    const originalBytes = value.originalBytes ?? value.bytes.byteLength;
    const originalLimit = ['mp4', 'webm'].includes(extension) ? 32 * 1024 * 1024 : MAX_BYTES;
    if (!Number.isInteger(originalBytes) || originalBytes < 1 || originalBytes > originalLimit)
      return { accepted: false, message: 'This file is empty or too large.' };
    const id = randomUUID();
    try {
      const attachment = image
        ? { png: snapshotBytes(value.bytes), animated: ['gif', 'mp4', 'webm'].includes(extension) }
        : { text: textFromFile(Buffer.from(value.bytes), extension).trim() };
      if (
        (attachment.png && !this.validImage(attachment.png)) ||
        (!attachment.png && (!attachment.text || attachment.text.includes('\0')))
      )
        throw new Error();
      if (attachment.png) {
        const bytes = [...this.drafts.values()].reduce(
          (total, value) => total + (value.attachment.png?.byteLength ?? 0),
          attachment.png.byteLength,
        );
        if (bytes > MAX_IMAGE_TOTAL)
          return { accepted: false, message: 'Attach fewer or smaller images for this message.' };
      }
      const remainingText = [...this.drafts.values()].reduce(
        (remaining, value) => remaining - (value.attachment.text?.length ?? 0),
        MAX_TEXT,
      );
      if (attachment.text && !remainingText)
        return { accepted: false, message: 'Attach fewer documents for this message.' };
      const shortened = attachment.text?.length > remainingText;
      if (shortened) attachment.text = attachment.text.slice(0, remainingText);
      const expiry = setTimeout(() => this.remove(id, owner), LEASE_MS).unref();
      this.drafts.set(id, {
        owner,
        until: this.now() + LEASE_MS,
        attachment,
        metadata: {
          name: attachmentName(name),
          kind: !image
            ? 'document'
            : ['mp4', 'webm'].includes(extension)
              ? 'video'
              : extension === 'gif'
                ? 'animation'
                : 'image',
          bytes: originalBytes,
        },
        expiry,
      });
      return {
        accepted: true,
        id,
        animated: Boolean(attachment.animated),
        shortened: Boolean(shortened),
      };
    } catch {
      return {
        accepted: false,
        message: 'Capri could not read this file. Check that it opens normally.',
      };
    }
  }
  remove(id, owner) {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== owner) return;
    clearTimeout(draft.expiry);
    this.drafts.delete(id);
  }
  take(ids, owner, { includeMetadata = false } = {}) {
    this.prune();
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > MAX_FILES ||
      new Set(ids).size !== ids.length
    )
      return null;
    const drafts = ids.map((id) => this.drafts.get(id));
    if (
      drafts.some(
        (draft) => !draft || draft.owner !== owner || (draft.attachment.png && !this.canSee()),
      )
    )
      return null;
    for (const id of ids) this.remove(id, owner);
    return drafts.map((draft) =>
      includeMetadata ? { ...draft.attachment, metadata: draft.metadata } : draft.attachment,
    );
  }
  clear() {
    for (const [id, draft] of this.drafts) this.remove(id, draft.owner);
  }
}
