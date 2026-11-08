// SPDX-License-Identifier: GPL-3.0-only
// Read-only compatibility for the withdrawn encrypted-storage experiment.
// Clean installations never create keys or encrypt dialogue files.
import { createDecipheriv } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { assertPrivatePath } from '../../packages/runtime/src/safe-file.mjs';

const MAGIC = Buffer.from('CAPRI-PRIVATE\x00\x01', 'ascii');
const IV_BYTES = 12;
export const PRIVATE_STORAGE_OVERHEAD = MAGIC.length + IV_BYTES + 16;
export const isLegacySealed = (bytes) =>
  Buffer.isBuffer(bytes) && bytes.subarray(0, MAGIC.length).equals(MAGIC);

export function legacyPrivateFileReader(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid legacy storage key.');
  const secret = Buffer.from(key);
  return Object.freeze({
    isSealed: isLegacySealed,
    open(bytes, purpose) {
      if (!isLegacySealed(bytes) || bytes.length < PRIVATE_STORAGE_OVERHEAD)
        throw new Error('Private data could not be unlocked.');
      try {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          secret,
          bytes.subarray(MAGIC.length, MAGIC.length + IV_BYTES),
        );
        decipher.setAAD(Buffer.from(`Capri private file v1:${purpose}`, 'utf8'));
        decipher.setAuthTag(bytes.subarray(MAGIC.length + IV_BYTES, PRIVATE_STORAGE_OVERHEAD));
        return Buffer.concat([
          decipher.update(bytes.subarray(PRIVATE_STORAGE_OVERHEAD)),
          decipher.final(),
        ]);
      } catch {
        throw new Error('Private data could not be unlocked.');
      }
    },
  });
}

/** Missing/unavailable legacy keys never block startup or overwrite old history. */
export async function readLegacyPrivateStorage({ keyFile, storage }) {
  if (!existsSync(keyFile)) return null;
  let key;
  try {
    assertPrivatePath(keyFile);
    const info = lstatSync(keyFile);
    if (!info.isFile() || info.nlink !== 1 || info.size > 16384) throw new Error();
    if (!(await storage.available())) throw new Error();
    const record = JSON.parse(readFileSync(keyFile, 'utf8'));
    if (record.schemaVersion !== 1 || typeof record.ciphertext !== 'string') throw new Error();
    const decoded = await storage.decrypt(Buffer.from(record.ciphertext, 'base64'));
    const value = typeof decoded === 'string' ? decoded : decoded?.result;
    const prefix = 'Capri private data key v1:';
    if (typeof value !== 'string' || !value.startsWith(prefix)) throw new Error();
    const hex = value.slice(prefix.length);
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error();
    key = Buffer.from(hex, 'hex');
    return legacyPrivateFileReader(key);
  } catch {
    return null;
  } finally {
    key?.fill(0);
  }
}
