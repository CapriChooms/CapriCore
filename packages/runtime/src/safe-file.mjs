// SPDX-License-Identifier: GPL-3.0-only
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function assertPrivatePath(file) {
  let cursor = path.resolve(file);
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('Private storage paths cannot contain filesystem links.');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

/** Atomic binary replacement with link and hardlink checks. */
export function writePrivateBytesAtomic(file, bytes) {
  assertPrivatePath(file);
  if (existsSync(file)) {
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error('Private storage is unavailable.');
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  assertPrivatePath(file);
  const temporary = `${file}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
