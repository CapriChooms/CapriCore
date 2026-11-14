// SPDX-License-Identifier: GPL-3.0-only
import { closeSync, openSync, readSync, fstatSync } from 'node:fs';

// GGUF stores the model description ahead of tensors. Skip vocabulary and
// numeric arrays rather than materializing them or loading the model.
export function ggufMetadata(file) {
  const fd = openSync(file, 'r');
  try {
    const size = Math.min(fstatSync(fd).size, 48 * 1024 ** 2);
    let buffer = Buffer.alloc(Math.min(size, 128 * 1024));
    let filled = readSync(fd, buffer, 0, buffer.length, 0);
    let offset = 0;
    const take = (length) => {
      const end = offset + length;
      if (!Number.isSafeInteger(end) || end > size) throw new Error('Invalid GGUF metadata.');
      if (end > filled) {
        const expanded = Buffer.alloc(Math.min(size, Math.max(end, buffer.length * 2)));
        buffer.copy(expanded, 0, 0, filled);
        filled += readSync(fd, expanded, filled, expanded.length - filled, filled);
        buffer = expanded;
      }
      if (end > filled) throw new Error('Incomplete GGUF metadata.');
      const start = offset;
      offset = end;
      return start;
    };
    const u32 = () => {
      const index = take(4);
      return buffer.readUInt32LE(index);
    };
    const u64 = () => {
      const index = take(8);
      const value = Number(buffer.readBigUInt64LE(index));
      if (!Number.isSafeInteger(value)) throw new Error('Invalid GGUF metadata count.');
      return value;
    };
    const string = (read) => {
      const length = u64();
      const start = take(length);
      if (read) return buffer.toString('utf8', start, start + length);
    };
    const widths = [1, 1, 2, 2, 4, 4, 4, 1, 0, 0, 8, 8, 8];
    const value = (type, read) => {
      if (type === 8) return string(read);
      if (type === 9) {
        const element = u32(),
          count = u64();
        if (widths[element]) take(count * widths[element]);
        else if (element === 8 && count <= 2 ** 20)
          for (let index = 0; index < count; index++) string(false);
        else throw new Error('Invalid GGUF array.');
        return;
      }
      const width = widths[type];
      if (!width) throw new Error('Invalid GGUF value.');
      const index = take(width);
      if (read && type === 4) return buffer.readUInt32LE(index);
      if (read && type === 10) return Number(buffer.readBigUInt64LE(index));
    };
    take(4);
    if (buffer.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(u32()))
      throw new Error('Unsupported GGUF header.');
    u64();
    const count = u64();
    if (count > 8192) throw new Error('GGUF metadata exceeds the limit.');
    const result = Object.create(null);
    for (let index = 0; index < count; index++) {
      const key = string(true);
      const read =
        key === 'general.architecture' ||
        key.endsWith('.context_length') ||
        /^tokenizer\.chat_template(?:\.[a-z_]+)?$/.test(key);
      const entry = value(u32(), read);
      if (read && entry !== undefined) result[key] = entry;
    }
    return result;
  } finally {
    closeSync(fd);
  }
}
