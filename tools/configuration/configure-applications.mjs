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
  path.join(backups, `applications-${new Date().toISOString().replaceAll(':', '-')}.json`),
);
config.plugins ??= {};
config.plugins.load ??= {};
config.plugins.load.paths ??= [];
const plugin = path.join(root, 'integrations/desktop-actions');
if (!config.plugins.load.paths.includes(plugin)) config.plugins.load.paths.push(plugin);
config.plugins.entries ??= {};
config.plugins.entries['capri-applications'] = { enabled: true, config: {} };
if (Array.isArray(config.plugins.allow) && !config.plugins.allow.includes('capri-applications'))
  config.plugins.allow.push('capri-applications');
const agent = config.agents.entries[settings.agentId];
agent.tools ??= {};
agent.tools.alsoAllow = [...new Set([...(agent.tools.alsoAllow ?? []), 'application_control'])];
if (Array.isArray(config.tools?.allow) && !config.tools.allow.includes('application_control'))
  config.tools.allow.push('application_control');
writeJsonAtomic(rt.configPath, config);
console.log('Fixed application tool configured; app permissions remain off by default.');
