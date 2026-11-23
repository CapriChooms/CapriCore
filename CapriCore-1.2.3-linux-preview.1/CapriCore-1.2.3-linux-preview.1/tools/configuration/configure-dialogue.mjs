/** Explicitly apply source sampling without replacing the user's runtime config. */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runtime, root, settings, generationParams } from '../../packages/runtime/src/index.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';

const rt = runtime();
const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
const model = config.models?.providers?.ollama?.models?.find((item) => item.id === settings.model);
if (!model) throw new Error('Configured Capri model is missing from the local runtime');
const profile = generationParams();
const backups = path.join(root, 'data/config-backups');
mkdirSync(backups, { recursive: true });
copyFileSync(
  rt.configPath,
  path.join(backups, `dialogue-${new Date().toISOString().replaceAll(':', '-')}.json`),
);
model.params = { ...model.params, ...profile };
writeJsonAtomic(rt.configPath, config);
console.log(
  JSON.stringify({
    applied: profile,
    model: model.id,
    session: settings.sessionKey,
    historyPreserved: true,
  }),
);
