/** Migrate the active agent to the native Qwen alias without resetting history. */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  root,
  runtime,
  settings,
  startLlama,
  request,
  headers,
  runCli,
  generationParams,
  reasoningBudget,
} from '../../packages/runtime/src/index.mjs';
import { ensureNativeLanguageModel } from '../../packages/runtime/src/providers/native-model.mjs';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';

const rt = runtime();
await startLlama(rt);
await ensureNativeLanguageModel(rt);
const config = JSON.parse(readFileSync(rt.configPath, 'utf8'));
const models = config.models.providers.ollama.models,
  ref = `ollama/${settings.model}`,
  oldRef = `ollama/${settings.upstreamModel}`;
let model = models.find((item) => item.id === settings.model);
if (!model) {
  const source = models.find((item) => item.id === settings.upstreamModel);
  if (!source) throw new Error('The upstream Qwen model is missing from OpenClaw configuration');
  model = { ...structuredClone(source), id: settings.model };
  models.push(model);
}
model.params = { ...model.params, ...generationParams() };
delete model.params.thinking;
const defaults = config.agents.defaults,
  agent = config.agents.entries[settings.agentId];
defaults.model = {
  ...(typeof defaults.model === 'object' ? defaults.model : {}),
  primary: ref,
  fallbacks: [],
};
for (const field of ['utilityModel', 'imageModel'])
  if (defaults[field] === oldRef) defaults[field] = ref;
agent.model = {
  ...(typeof agent.model === 'object' ? agent.model : {}),
  primary: ref,
  fallbacks: [],
};
agent.thinkingDefault = settings.thinkingDefault;
const backups = path.join(root, 'data/config-backups');
mkdirSync(backups, { recursive: true });
copyFileSync(
  rt.configPath,
  path.join(backups, `performance-${new Date().toISOString().replaceAll(':', '-')}.json`),
);
writeJsonAtomic(rt.configPath, config);
const online = await request(`${rt.gatewayUrl}/v1/models`, {
  headers: headers(rt),
  timeout: 3000,
}).catch(() => null);
if (online)
  await runCli(
    [
      'gateway',
      'call',
      'sessions.patch',
      '--params',
      JSON.stringify({
        key: settings.sessionKey,
        model: ref,
        thinkingLevel: settings.thinkingDefault,
      }),
      '--json',
      '--timeout',
      '60000',
    ],
    rt,
  );
console.log(
  JSON.stringify({
    model: settings.model,
    upstream: settings.upstreamModel,
    reasoningBudget: reasoningBudget(),
    historyPreserved: true,
    note: 'Restart Capri when changing the local reasoning budget.',
  }),
);
