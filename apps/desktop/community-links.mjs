// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Renderer requests identifiers, never arbitrary URLs. Presence and Support use
// the same destinations so replacing an invite cannot leave an old RPC button.
export const COMMUNITY_LINKS = Object.freeze({
  boosty: 'https://boosty.to/overyx',
  lava: 'https://app.lava.top/overyx',
  tiktok: 'https://www.tiktok.com/@overyx2',
  youtube: 'https://www.youtube.com/@CapriChoom',
  discord: 'https://discord.gg/capricore',
  github: 'https://github.com/CapriChooms/CapriCore',
  website: 'https://capri-core.com/',
  faq: 'https://capri-core.com/#faq',
  releases: 'https://github.com/CapriChooms/CapriCore/releases/latest',
  issues: 'https://github.com/CapriChooms/CapriCore/issues/new/choose',
});

export function loadCommunityLinks(root) {
  try {
    const value = JSON.parse(readFileSync(path.join(root, 'config/community.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return COMMUNITY_LINKS;
    const links = Object.fromEntries(
      Object.entries(COMMUNITY_LINKS).map(([id, fallback]) => [
        id,
        Object.hasOwn(value, id) ? value[id] : fallback,
      ]),
    );
    for (const [id, destination] of Object.entries(links)) {
      if (typeof destination !== 'string') return COMMUNITY_LINKS;
      const url = new URL(destination);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.origin !== new URL(COMMUNITY_LINKS[id]).origin
      )
        return COMMUNITY_LINKS;
      // Upgrades may retain an older community config. This shipped invitation
      // has expired; it must not override the replacement in the new build.
      if (id === 'discord' && url.pathname.replace(/\/$/u, '') === '/ETMtqsGaZN')
        links[id] = COMMUNITY_LINKS.discord;
      if (
        ['github', 'issues', 'releases'].includes(id) &&
        /^\/CapriChooms\/Capri(?:\/|$)/u.test(url.pathname)
      )
        links[id] = COMMUNITY_LINKS[id];
    }
    return Object.freeze(links);
  } catch {
    // Older or malformed maintainer configuration keeps safe built-in links.
    return COMMUNITY_LINKS;
  }
}
