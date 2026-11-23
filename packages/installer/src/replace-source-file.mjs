// SPDX-License-Identifier: GPL-3.0-only
import {
  copyFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  lstatSync,
  chmodSync,
  constants,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { noLinks } from './policy.mjs';

/** The caller validates/backups the managed source entry before replacing it. */
export async function replaceSourceFile(source, target, { root, signal } = {}) {
  const boundary = path.resolve(root),
    destination = path.resolve(target);
  if (!destination.startsWith(boundary + path.sep))
    throw new Error('Source replacement escaped installation');
  noLinks(source);
  noLinks(destination);
  const staging = path.join(boundary, '.runtime/installer/staging');
  noLinks(staging);
  mkdirSync(staging, { recursive: true });
  const temporary = path.join(staging, randomUUID() + '.tmp');
  const makeWritable = (file) => {
    const info = lstatSync(file);
    if (process.platform === 'win32' && !(info.mode & 0o200)) chmodSync(file, info.mode | 0o200);
  };
  try {
    signal?.throwIfAborted();
    copyFileSync(source, temporary, constants.COPYFILE_EXCL);
    makeWritable(temporary);
    for (let attempt = 0; attempt < 4; attempt++) {
      signal?.throwIfAborted();
      let previous,
        changedReadOnly = false;
      try {
        noLinks(destination);
        if (existsSync(destination)) {
          previous = lstatSync(destination);
          if (!previous.isFile()) throw new Error('Source destination must be a regular file');
          if (process.platform === 'win32' && !(previous.mode & 0o200)) {
            if (previous.nlink > 1)
              throw new Error('Cannot change attributes of a hard-linked source file');
            chmodSync(destination, previous.mode | 0o200);
            changedReadOnly = true;
          }
        }
        renameSync(temporary, destination);
        return;
      } catch (error) {
        if (changedReadOnly && existsSync(destination)) {
          const current = lstatSync(destination);
          if (current.ino === previous.ino && current.dev === previous.dev)
            chmodSync(destination, previous.mode);
        }
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        if (attempt === 3) {
          const failure = new Error(
            `Cannot replace installed file ${path.relative(boundary, destination)} (${error.code}). It may be in use or protected by Windows. Close Capri and other installers, then retry. Existing file contents were preserved.`,
            { cause: error },
          );
          failure.code = error.code;
          throw failure;
        }
        await delay([200, 500, 1000][attempt], undefined, { signal });
      }
    }
  } finally {
    try {
      if (existsSync(temporary)) {
        makeWritable(temporary);
        unlinkSync(temporary);
      }
    } catch {
      // A scanner can briefly hold the staged file too. Keep the original failure;
      // any leftover stays in the private installer cache, outside source files.
    }
  }
}
