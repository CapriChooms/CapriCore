// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

const limits = Object.freeze({
  fileBytes: 128 * 1024,
  totalBytes: 1024 * 1024,
  entries: 4096,
  files: 128,
  depth: 6,
  items: 500,
  itemCharacters: 6000,
});
const placeholders = new Set([
  'No user preferences have been saved yet.',
  'No memories have been saved yet.',
]);
const missing = (error) => error?.code === 'ENOENT';
const sameFile = (before, after) => before.dev === after.dev && before.ino === after.ino;
const cleanText = (text) => text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}
function noteDate(value) {
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

/** This is a source viewer, not a model-generated interpretation of remembered facts. */
function memoryBlocks(content, source, append) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let block = [],
    listIndent = null,
    pendingBlank = false,
    fence = null,
    comment = false;
  const visibleLine = (line) => {
    let text = '',
      offset = 0;
    while (offset < line.length) {
      if (comment) {
        const end = line.indexOf('-->', offset);
        if (end < 0) return text;
        comment = false;
        offset = end + 3;
      } else {
        const start = line.indexOf('<!--', offset);
        if (start < 0) return text + line.slice(offset);
        text += line.slice(offset, start);
        comment = true;
        offset = start + 4;
      }
    }
    return text;
  };
  const flush = () => {
    if (block.length) append(cleanText(block.join('\n')));
    block = [];
    listIndent = null;
    pendingBlank = false;
  };
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (fence) {
      block.push(line);
      if (new RegExp('^\\s*' + fence[0] + '{' + fence.length + ',}\\s*$').test(line)) {
        fence = null;
        flush();
      }
      continue;
    }
    // The writer's JSON string is data, including any literal HTML-like text.
    // Decode it before interpreting Markdown comments elsewhere in the file.
    if (!comment && source === 'memory/capri-owner-notes.md') {
      const entry = /^- (\d{4}-\d{2}-\d{2}) (".*")$/.exec(line);
      if (entry) {
        try {
          const note = JSON.parse(entry[2]);
          if (typeof note === 'string') {
            flush();
            append(cleanText(note), noteDate(entry[1]));
            continue;
          }
        } catch {
          /* Preserve an unrecognized line as plain source text. */
        }
      }
    }
    line = visibleLine(line);
    const trimmed = line.trim();
    const fenced = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenced) {
      flush();
      fence = fenced[1];
      block.push(line);
      continue;
    }
    if (!trimmed) {
      if (listIndent !== null) pendingBlank = true;
      else flush();
      continue;
    }
    if (/^\s{0,3}#{1,6}(?:\s|$)/.test(line) || /^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      flush();
      continue;
    }
    if (
      index + 1 < lines.length &&
      !/^\s*(?:[-+*]|\d+[.)])\s+/.test(line) &&
      /^\s{0,3}(?:={3,}|-{3,})\s*$/.test(lines[index + 1])
    ) {
      flush();
      index++;
      continue;
    }
    if (placeholders.has(trimmed)) {
      flush();
      continue;
    }
    const bullet = /^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
    const indent = /^\s*/.exec(line)[0].length;
    if (bullet && (listIndent === null || bullet[1].length <= listIndent)) {
      flush();
      listIndent = bullet[1].length;
      block.push(bullet[2]);
    } else {
      if (pendingBlank) {
        if (listIndent !== null && indent > listIndent) block.push('');
        else flush();
      }
      pendingBlank = false;
      block.push(line);
    }
  }
  flush();
}

/** Read only owner-memory sources. Never queries a model, an index, sessions or chat archives. */
export async function readSavedMemory(workspace) {
  const snapshot = { items: [], truncated: false, unavailable: false };
  let root;
  try {
    root = await realpath(workspace);
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) return { ...snapshot, unavailable: true };
  } catch {
    return { ...snapshot, unavailable: true };
  }
  let bytes = 0,
    files = 0,
    entries = 0;
  const exhausted = () =>
    snapshot.items.length >= limits.items || bytes >= limits.totalBytes || files >= limits.files;
  const add = (source, text, date) => {
    if (!text || placeholders.has(text)) return;
    if (snapshot.items.length >= limits.items) {
      snapshot.truncated = true;
      return;
    }
    if (text.length > limits.itemCharacters) {
      snapshot.truncated = true;
      text = text.slice(0, limits.itemCharacters);
    }
    const id = createHash('sha256')
      .update(source + '\0' + snapshot.items.length + '\0' + text)
      .digest('hex')
      .slice(0, 24);
    snapshot.items.push({ id, text, source, ...(date && { date }) });
  };
  const read = async (file) => {
    if (exhausted()) {
      snapshot.truncated = true;
      return;
    }
    let handle;
    try {
      const before = await lstat(file);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        !inside(root, await realpath(file))
      ) {
        snapshot.unavailable = true;
        return;
      }
      files++;
      const remaining = Math.min(limits.fileBytes, limits.totalBytes - bytes);
      if (before.size > remaining) {
        snapshot.truncated = true;
        return;
      }
      const source = path.relative(root, file).split(path.sep).join('/');
      if (source.length > 512 || /[\x00-\x1f\x7f]/.test(source)) {
        snapshot.unavailable = true;
        return;
      }
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        !sameFile(before, info) ||
        info.size > remaining ||
        !inside(root, await realpath(file))
      ) {
        snapshot.unavailable = true;
        return;
      }
      const buffer = Buffer.alloc(remaining + 1);
      let length = 0;
      while (length < buffer.length) {
        const chunk = await handle.read(buffer, length, buffer.length - length, null);
        if (!chunk.bytesRead) break;
        length += chunk.bytesRead;
      }
      bytes += length;
      if (length > remaining) {
        snapshot.truncated = true;
        return;
      }
      const after = await handle.stat();
      if (
        !sameFile(info, after) ||
        after.nlink !== 1 ||
        info.size !== after.size ||
        info.mtimeMs !== after.mtimeMs
      ) {
        snapshot.unavailable = true;
        return;
      }
      memoryBlocks(buffer.subarray(0, length).toString('utf8'), source, (text, date) =>
        add(source, text, date),
      );
    } catch (error) {
      if (!missing(error)) snapshot.unavailable = true;
    } finally {
      await handle?.close().catch(() => {});
    }
  };
  const visit = async (directory, depth) => {
    if (exhausted() || entries >= limits.entries) {
      snapshot.truncated = true;
      return;
    }
    try {
      const before = await lstat(directory);
      if (
        !before.isDirectory() ||
        before.isSymbolicLink() ||
        !inside(root, await realpath(directory))
      ) {
        snapshot.unavailable = true;
        return;
      }
      const found = [];
      const stream = await opendir(directory, { bufferSize: 32 });
      for await (const entry of stream) {
        if (entries >= limits.entries) {
          snapshot.truncated = true;
          break;
        }
        entries++;
        found.push(entry.name);
      }
      const after = await lstat(directory);
      if (
        !sameFile(before, after) ||
        after.isSymbolicLink() ||
        !inside(root, await realpath(directory))
      ) {
        snapshot.unavailable = true;
        return;
      }
      found.sort();
      for (const name of found) {
        if (exhausted()) {
          snapshot.truncated = true;
          break;
        }
        const file = path.join(directory, name);
        const info = await lstat(file);
        if (info.isSymbolicLink()) {
          snapshot.unavailable = true;
          continue;
        }
        if (info.isDirectory()) {
          if (depth >= limits.depth) snapshot.truncated = true;
          else await visit(file, depth + 1);
        } else if (info.isFile() && /\.md$/i.test(name)) await read(file);
      }
    } catch (error) {
      if (!missing(error)) snapshot.unavailable = true;
    }
  };
  await read(path.join(root, 'USER.md'));
  await read(path.join(root, 'MEMORY.md'));
  await visit(path.join(root, 'memory'), 0);
  return snapshot;
}
