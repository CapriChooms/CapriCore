import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const NATIVE_SOURCES = ['SpotifyBridge.cs', 'SpotifyAudio.cs', 'SpotifyAccessibility.cs'];
export function spotifySourceHash(root) {
  const hash = createHash('sha256');
  for (const name of [...NATIVE_SOURCES, 'ExportAutomation.cs'])
    hash
      .update(name + '\0')
      .update(readFileSync(path.join(root, 'integrations/spotify/native', name)));
  return hash.digest('hex');
}
