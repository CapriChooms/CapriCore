// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { writeJsonAtomic } from '../../packages/runtime/src/atomic-json.mjs';
import { spotifySourceHash } from './native-build.mjs';
import { configureSpotify } from '../../packages/runtime/src/config/spotify-gateway.mjs';
export { configureSpotify, spotifyAccess } from '../../packages/runtime/src/config/spotify-gateway.mjs';
export function readSpotifyConfig(file) {
  const bytes = readFileSync(file);
  if (bytes.length > 2 * 1024 ** 2)
    throw new Error('Spotify configuration exceeds its size limit.');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
export function spotifyBridgeReady(root) {
  try {
    const folder = path.join(root, '.runtime/spotify-bridge');
    const build = readSpotifyConfig(path.join(folder, 'build.json'));
    return (
      /^[a-f0-9]{16}\/Capri\.Spotify\.exe$/.test(build.artifact ?? '') &&
      build.sourceSha256 === spotifySourceHash(root) &&
      existsSync(path.join(folder, build.artifact))
    );
  } catch {
    return false;
  }
}
/** Called with the owning Gateway stopped. A failed restart can restore this exact configuration. */
export function saveSpotifyAccess({ root, rt, agentId, enabled }) {
  const before = readSpotifyConfig(rt.configPath);
  const next = configureSpotify(before, { root, agentId, enabled });
  const backup = path.join(root, 'data/config-backups', 'spotify-access-' + randomUUID() + '.json');
  writeJsonAtomic(backup, before);
  writeJsonAtomic(rt.configPath, next);
  return { restore: () => writeJsonAtomic(rt.configPath, before) };
}
