import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, settings } from '../../packages/runtime/src/index.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';

const rt = runtime(),
  config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
const backups = path.join(root, 'data/config-backups');
mkdirSync(backups, { recursive: true });
copyFileSync(
  rt.configPath,
  path.join(backups, `filesystem-${new Date().toISOString().replaceAll(':', '-')}.json`),
);
config.plugins ??= {};
config.plugins.load ??= {};
config.plugins.load.paths ??= [];
const plugin = path.join(root, 'integrations/filesystem');
if (!config.plugins.load.paths.includes(plugin)) config.plugins.load.paths.push(plugin);
config.plugins.entries ??= {};
config.plugins.entries['capri-filesystem'] = { enabled: true, config: {} };
if (Array.isArray(config.plugins.allow) && !config.plugins.allow.includes('capri-filesystem'))
  config.plugins.allow.push('capri-filesystem');
const agent = config.agents.entries[settings.agentId];
agent.tools ??= {};
agent.tools.alsoAllow = [...new Set([...(agent.tools.alsoAllow ?? []), 'filesystem_control'])];
if (Array.isArray(config.tools?.allow) && !config.tools.allow.includes('filesystem_control'))
  config.tools.allow.push('filesystem_control');
writeJsonAtomic(rt.configPath, config);
console.log(
  'File tool configured. Capri manages installation access and additional folder permissions in the desktop.',
);
