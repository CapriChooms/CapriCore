/** Read the authoring sprite set that the runtime catalog is compiled from. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SPRITE_SOURCE_NAME = 'complete-sprite-set.json';

export function spriteSourcePath(folder) {
  return path.join(folder, SPRITE_SOURCE_NAME);
}

export function readSpriteSource(folder, read = readFileSync) {
  const file = spriteSourcePath(folder);
  let text;
  try {
    text = read(file, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const missing = new Error(
      `${SPRITE_SOURCE_NAME} is not part of the public source release, so the runtime catalog cannot be rebuilt here. ` +
        'The committed runtime-sprite-set.json is used as-is. Run this command only in a checkout that contains the authoring sprite set.',
    );
    missing.code = 'SPRITE_SOURCE_MISSING';
    throw missing;
  }
  return JSON.parse(text);
}
