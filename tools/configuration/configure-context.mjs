/** Explicit migration; never reset the owner's session or memory. */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root, runtime, settings } from '../../packages/runtime/src/index.mjs';
import { applyLocalContextPolicy } from '../../scripts/context-policy.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';

const rt = runtime(),
  config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
const policy = applyLocalContextPolicy(config, settings.contextTokens);
const backups = path.join(root, 'data/config-backups');
mkdirSync(backups, { recursive: true });
copyFileSync(
  rt.configPath,
  path.join(backups, `context-${new Date().toISOString().replaceAll(':', '-')}.json`),
);
writeJsonAtomic(rt.configPath, config);
console.log(
  JSON.stringify({
    contextTokens: settings.contextTokens,
    compaction: policy,
    historyPreserved: true,
  }),
);
