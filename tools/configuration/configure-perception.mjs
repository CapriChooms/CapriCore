import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, settings } from '../../packages/runtime/src/index.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';
const rt = runtime(),
  config = JSON.parse(readFileSync(rt.configPath, 'utf8')),
  backups = path.join(root, 'data/config-backups');
mkdirSync(backups, { recursive: true });
copyFileSync(
  rt.configPath,
  path.join(backups, `perception-${new Date().toISOString().replaceAll(':', '-')}.json`),
);
config.plugins ??= {};
config.plugins.load ??= {};
config.plugins.load.paths ??= [];
const plugin = path.join(root, 'integrations/perception');
if (!config.plugins.load.paths.includes(plugin)) config.plugins.load.paths.push(plugin);
config.plugins.entries ??= {};
config.plugins.entries['capri-perception'] = {
  enabled: true,
  config: { sessionKey: settings.sessionKey },
};
if (Array.isArray(config.plugins.allow) && !config.plugins.allow.includes('capri-perception'))
  config.plugins.allow.push('capri-perception');
writeJsonAtomic(rt.configPath, config);
console.log('Ephemeral visual context configured. No screen or camera access has been enabled.');
