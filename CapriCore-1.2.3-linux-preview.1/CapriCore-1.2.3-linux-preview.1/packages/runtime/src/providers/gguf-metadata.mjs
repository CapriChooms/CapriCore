// SPDX-License-Identifier: GPL-3.0-only
import { closeSync, openSync, readSync, fstatSync } from 'node:fs';

// GGUF stores the model description ahead of tensors. Skip vocabulary and
// numeric arrays rather than materializing them or loading the model.
export function ggufMetadata(file) {
  const fd = openSync(file, 'r');
  try {
    const size = Math.min(fstatSync(fd).size, 48 * 1024 ** 2);
    const buffer = Buffer.allocUnsafe(Math.min(size, 128 * 1024));
    let windowStart = 0;
    let windowEnd = 0;
    let offset = 0;
    const take = (length) => {
      const end = offset + length;
      if (!Number.isSafeInteger(end) || end > size) throw new Error('Invalid GGUF metadata.');
      const start = offset;
      offset = end;
      return start;
    };
    const inWindow = (start, length) => {
      if (start < windowStart || start + length > windowEnd) {
        windowStart = start;
        windowEnd = start + readSync(fd, buffer, 0, Math.min(buffer.length, size - start), start);
        if (start + length > windowEnd) throw new Error('Incomplete GGUF metadata.');
      }
      return start - windowStart;
    };
    const uint32At = (start) => buffer.readUInt32LE(inWindow(start, 4));
    const uint64At = (start) => Number(buffer.readBigUInt64LE(inWindow(start, 8)));
    const u32 = () => uint32At(take(4));
    const u64 = () => {
      const value = uint64At(take(8));
      if (!Number.isSafeInteger(value)) throw new Error('Invalid GGUF metadata count.');
      return value;
    };
    const string = (read) => {
      const length = u64();
      const start = take(length);
      if (!read) return;
      if (length > buffer.length) {
        const data = Buffer.allocUnsafe(length);
        if (readSync(fd, data, 0, length, start) !== length)
          throw new Error('Incomplete GGUF metadata.');
        return data.toString('utf8');
      }
      const index = inWindow(start, length);
      return buffer.toString('utf8', index, index + length);
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
      if (read && type === 4) return uint32At(index);
      if (read && type === 10) return uint64At(index);
    };
    const magic = inWindow(take(4), 4);
    if (buffer.toString('ascii', magic, magic + 4) !== 'GGUF' || ![2, 3].includes(u32()))
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
