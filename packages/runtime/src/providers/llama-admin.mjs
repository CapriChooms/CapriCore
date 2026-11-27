// SPDX-License-Identifier: GPL-3.0-only
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { settings } from '../config/settings.mjs';
import { root } from '../host/paths.mjs';
import { assertPrivatePath } from '../safe-file.mjs';

const tokenFile = (directory) => path.join(directory, 'data/run/llama-admin-token');

export function readLlamaAdminToken(directory = root) {
  const file = tokenFile(directory);
  assertPrivatePath(file);
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1 || info.size !== 65)
    throw new Error('Local inference credentials are unavailable.');
  const token = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Local inference credentials are unavailable.');
  return token;
}

export function initializeLlamaAdminToken() {
  const file = tokenFile(root);
  assertPrivatePath(file);
  try {
    writeFileSync(file, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  readLlamaAdminToken();
}

export function llamaAdminHeaders(baseUrl, directory = root) {
  if (baseUrl !== `http://127.0.0.1:${settings.ollamaPort}`) return {};
  try {
    return { authorization: 'Bearer ' + readLlamaAdminToken(directory) };
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
