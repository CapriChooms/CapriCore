// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import configured from '../config/community.json' with { type: 'json' };
import { COMMUNITY_LINKS, loadCommunityLinks } from '../apps/desktop/community-links.mjs';
import { DiscordPresence } from '../apps/desktop/discord-presence.mjs';
import {
  COMMUNITY_LINKS as legacyLinks,
  registerCompanionIpc,
} from '../apps/desktop/main/companion-ipc.mjs';

const parent = path.join(process.cwd(), '.runtime/community-links-tests');
mkdirSync(parent, { recursive: true });
function fixture(value) {
  const root = mkdtempSync(path.join(parent, 'case-'));
  mkdirSync(path.join(root, 'config'));
  if (value !== undefined)
    writeFileSync(path.join(root, 'config/community.json'), JSON.stringify(value));
  return root;
}
const activity = (links) =>
  new DiscordPresence({
    preferences: {
      snapshot: () => ({ enabled: true, applicationId: '123456789012345678', assetKey: '' }),
    },
    communityLinks: links,
  }).activity();

test('shipped community destinations and both Discord activity buttons use the same shared defaults', () => {
  assert.equal(legacyLinks, COMMUNITY_LINKS, 'Existing imports retain the same safe allowlist');
  assert.deepEqual(configured, COMMUNITY_LINKS);
  assert.equal(COMMUNITY_LINKS.discord, 'https://discord.gg/capricore');
  const buttons = activity().buttons;
  assert.deepEqual(buttons, [
    { label: 'Get Capri', url: COMMUNITY_LINKS.github },
    { label: 'Join Her Discord', url: COMMUNITY_LINKS.discord },
  ]);
});

test('a retained older installation config cannot restore the expired shipped invitation', () => {
  const links = loadCommunityLinks(fixture({ discord: 'https://discord.gg/ETMtqsGaZN' }));
  assert.equal(links.discord, 'https://discord.gg/capricore');
  assert.equal(activity(links).buttons[1].url, 'https://discord.gg/capricore');
});

test('retained private-era links migrate to public repository and issue reporting together', () => {
  const links = loadCommunityLinks(
    fixture({
      github: 'https://github.com/CapriChooms/Capri',
      issues: 'https://github.com/CapriChooms/Capri/issues/new',
    }),
  );
  assert.equal(links.github, 'https://github.com/CapriChooms/CapriCore');
  assert.equal(links.issues, 'https://github.com/CapriChooms/CapriCore/issues/new/choose');
  assert.equal(activity(links).buttons[0].url, links.github);
});

test('a replacement invite updates presence and Support together without forwarding unknown configuration', async () => {
  const invite = 'https://discord.gg/fresh-test-invite';
  const root = fixture({ discord: invite, futurePrivateMetadata: 'fixture-private-value' });
  const links = loadCommunityLinks(root);
  assert.deepEqual(Object.keys(links), Object.keys(COMMUNITY_LINKS));
  assert(Object.isFrozen(links));
  assert.equal(
    links.github,
    COMMUNITY_LINKS.github,
    'Older partial configs retain new default links',
  );
  const presence = activity(links);
  assert.equal(presence.buttons[1].url, invite);
  assert(!JSON.stringify(presence).includes('fixture-private-value'));
  const handlers = new Map(),
    opened = [];
  registerCompanionIpc((name, handler) => handlers.set(name, handler), {
    root,
    state: root,
    rt: { workspace: root },
    preferences: {},
    shell: { openExternal: async (url) => opened.push(url) },
  });
  const open = handlers.get('capri:community-link');
  await open('discord');
  await open('github');
  await open('issues');
  assert.deepEqual(opened, [
    presence.buttons[1].url,
    presence.buttons[0].url,
    COMMUNITY_LINKS.issues,
  ]);
  for (const id of ['futurePrivateMetadata', '__proto__', 'constructor', 'file:///private'])
    await assert.rejects(open(id), /Unknown community link/);
  assert.equal(opened.length, 3);
});

test('malformed files and destinations outside their approved HTTPS origin use safe defaults', () => {
  assert.equal(loadCommunityLinks(fixture()), COMMUNITY_LINKS);
  for (const value of [
    null,
    [],
    'not-a-map',
    { discord: null },
    { discord: 'http://discord.gg/fresh-test-invite' },
    { discord: 'https://user:password@discord.gg/fresh-test-invite' },
    { discord: 'https://discord.gg:8443/fresh-test-invite' },
    { discord: 'https://discord.gg.evil.invalid/fresh-test-invite' },
    { discord: 'file:///private' },
    { github: 'https://github.com.evil.invalid/Capri' },
  ])
    assert.equal(loadCommunityLinks(fixture(value)), COMMUNITY_LINKS);
  const broken = fixture();
  writeFileSync(path.join(broken, 'config/community.json'), '{broken');
  assert.equal(loadCommunityLinks(broken), COMMUNITY_LINKS);
});
