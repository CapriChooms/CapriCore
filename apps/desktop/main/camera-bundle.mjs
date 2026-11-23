// SPDX-License-Identifier: GPL-3.0-only
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertPrivatePath } from '../../../packages/runtime/src/safe-file.mjs';

export const CAMERA_BUNDLES_FOLDER = 'bundles';

export function readCameraBundleReceipt(directory) {
  const file = path.join(directory, 'active.json');
  assertPrivatePath(file);
  const info = lstatSync(file, { throwIfNoEntry: false });
  if (!info) return { file, bytes: null, bundleId: null };
  if (!info.isFile() || info.nlink !== 1 || info.size > 256)
    throw new Error('Invalid Capri Camera bundle receipt.');
  const bytes = readFileSync(file);
  let bundleId = null;
  try {
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (
      value?.schemaVersion === 1 &&
      Object.keys(value).length === 2 &&
      typeof value.bundleId === 'string' &&
      value.bundleId.length === 32 &&
      /^[a-f0-9]{32}$/.test(value.bundleId)
    )
      bundleId = value.bundleId;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return { file, bytes, bundleId };
}
