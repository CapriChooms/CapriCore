// SPDX-License-Identifier: GPL-3.0-only
// Original procedural UI symbol. Optional character artwork is not required.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './atomic-json.mjs';
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, bytes) {
  const name = Buffer.from(type),
    content = Buffer.concat([name, bytes]),
    length = Buffer.alloc(4),
    hash = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const byte of content) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  hash.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, hash]);
}
export function defaultAvatarPng(size = 1536) {
  if (!Number.isInteger(size) || size < 16 || size > 2048)
    throw new Error('Invalid default avatar canvas');
  const stride = size * 4 + 1,
    pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2,
        dy = y - size * 0.48,
        r = Math.hypot(dx, dy),
        unit = size / 1536;
      const ring = Math.abs(r - 190 * unit) < 5 * unit,
        diamond = Math.abs(Math.abs(dx) + Math.abs(dy) - 240 * unit) < 5 * unit,
        eye = r < 54 * unit;
      if (ring || diamond || eye) {
        const i = y * stride + 1 + x * 4;
        pixels[i] = eye ? 250 : 115;
        pixels[i + 1] = eye ? 100 : 245;
        pixels[i + 2] = eye ? 170 : 230;
        pixels[i + 3] = 255;
      }
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function createDefaultAvatar(folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'avatar.png'), defaultAvatarPng());
  writeJsonAtomic(path.join(folder, 'sprite-set.json'), {
    schemaVersion: 1,
    canvas: { width: 1536, height: 1536 },
    defaultSprite: 'neutral',
    sprites: [
      {
        id: 'neutral',
        pose: 'idle',
        expression: 'neutral_small_smile',
        file: 'avatar.png',
        description: 'Original digital companion symbol.',
      },
    ],
  });
}
