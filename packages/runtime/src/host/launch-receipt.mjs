// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { writeJsonAtomic } from '../atomic-json.mjs';
export const validLaunchNonce = (value) =>
  typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export function publishLaunchReceipt(root, nonce) {
  if (!validLaunchNonce(nonce)) return false;
  const folder = path.join(root, 'data/run');
  for (
    let cursor = folder;
    cursor && cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  )
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('Linked launch receipt folder');
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'launch-' + nonce + '.json');
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()))
    throw new Error('Invalid launch receipt');
  writeJsonAtomic(file, {
    schemaVersion: 1,
    nonce,
    phase: 'window-ready',
    pid: process.pid,
    at: Date.now(),
  });
  return true;
}
