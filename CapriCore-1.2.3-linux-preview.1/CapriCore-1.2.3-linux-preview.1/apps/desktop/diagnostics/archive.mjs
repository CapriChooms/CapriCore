// SPDX-License-Identifier: GPL-3.0-only
import { crc32, deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(deflateRaw);

/** Bounded, UTF-8 ZIP without external executables or runtime dependencies. */
export async function diagnosticZip(entries) {
  if (entries.length > 64) throw new Error('Too many diagnostic files');
  const local = [],
    central = [],
    names = new Set(),
    now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate =
    ((Math.max(1980, Math.min(2107, now.getFullYear())) - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  let offset = 0,
    total = 0;
  for (const { name, bytes } of entries) {
    if (names.has(name)) throw new Error('Duplicate diagnostic filename');
    names.add(name);
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(name) ||
      name.startsWith('/') ||
      name.split('/').some((p) => !p || p === '..')
    )
      throw new Error('Invalid diagnostic filename');
    const data = Buffer.from(bytes);
    total += data.length;
    if (total > 16 * 1024 ** 2) throw new Error('Diagnostics exceed the size limit');
    const packed = await compress(data),
      filename = Buffer.from(name),
      crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, packed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(dosTime, 12);
    directory.writeUInt16LE(dosDate, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(packed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
