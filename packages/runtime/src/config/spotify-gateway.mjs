// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';

const samePath = (a, b) =>
  typeof a === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
export function spotifyAccess(config, root, agentId) {
  const plugin = path.join(root, 'integrations/spotify');
  const agent = config.agents?.entries?.[agentId];
  return (
    Boolean(agent) &&
    config.plugins?.entries?.['capri-spotify']?.enabled === true &&
    config.plugins?.load?.paths?.some((value) => samePath(value, plugin)) === true &&
    (!Array.isArray(config.plugins?.allow) || config.plugins.allow.includes('capri-spotify')) &&
    ![config.tools, config.agents?.defaults?.tools, agent?.tools].some((tools) =>
      tools?.deny?.includes('spotify_control'),
    ) &&
    (!Array.isArray(config.tools?.allow) || config.tools.allow.includes('spotify_control')) &&
    (!Array.isArray(agent?.tools?.allow) ||
      agent.tools.allow.includes('spotify_control') ||
      agent.tools.alsoAllow?.includes('spotify_control'))
  );
}
export function configureSpotify(existing, { root, agentId, enabled }) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid Spotify permission.');
  const config = structuredClone(existing),
    agent = config.agents?.entries?.[agentId];
  if (!agent) throw new Error('Start the local Capri core before setting up Spotify.');
  config.plugins ??= {};
  config.plugins.load ??= {};
  config.plugins.entries ??= {};
  const plugin = path.join(root, 'integrations/spotify');
  config.plugins.load.paths = (config.plugins.load.paths ?? []).filter(
    (value) => !samePath(value, plugin),
  );
  if (enabled) config.plugins.load.paths.push(plugin);
  config.plugins.entries['capri-spotify'] = {
    ...config.plugins.entries['capri-spotify'],
    enabled,
    config: config.plugins.entries['capri-spotify']?.config ?? {},
  };
  if (Array.isArray(config.plugins.allow)) {
    config.plugins.allow = config.plugins.allow.filter((id) => id !== 'capri-spotify');
    if (enabled) config.plugins.allow.push('capri-spotify');
  }
  agent.tools ??= {};
  agent.tools.alsoAllow = (agent.tools.alsoAllow ?? []).filter(
    (tool) => tool !== 'spotify_control',
  );
  if (enabled) agent.tools.alsoAllow.push('spotify_control');
  if (enabled)
    for (const tools of [config.tools, config.agents?.defaults?.tools, agent.tools])
      if (Array.isArray(tools?.deny))
        tools.deny = tools.deny.filter((tool) => tool !== 'spotify_control');
  for (const tools of [config.tools, agent.tools])
    if (Array.isArray(tools?.allow)) {
      tools.allow = tools.allow.filter((tool) => tool !== 'spotify_control');
      if (enabled) tools.allow.push('spotify_control');
    }
  return config;
}
