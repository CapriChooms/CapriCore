import { modelPlan } from '../src/providers/model-plan.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  root,
  settings,
  runtime,
  startOllama,
  request,
  environment,
  ollamaPath,
} from '../src/index.mjs';
import { ensureNativeLanguageModel } from '../src/providers/native-model.mjs';
import { pullModel } from '../src/providers/pull-model.mjs';
import { recoverRegistryTls } from '../src/providers/registry-tls-recovery.mjs';
import { recoverPullService } from '../src/providers/pull-service-recovery.mjs';

const plan = modelPlan(settings, process.argv.slice(2));
if (plan.preview) {
  console.log(JSON.stringify(plan));
} else {
  const rt = runtime();
  await startOllama(rt);
  for (const model of plan.models) {
    console.log(`Downloading ${model}...`);
    await pullModel(rt, model, {
      recoverTls: ({ signal }) => recoverRegistryTls(rt, { signal }),
      recoverConnection: ({ signal }) => recoverPullService(rt, { signal }),
    });
  }
  if (!plan.embeddingOnly) await ensureNativeLanguageModel(rt);
  await new Promise((resolve, reject) => {
    const child = spawn(
      ollamaPath,
      ['create', settings.embeddingModel, '-f', path.join(root, 'config/Embedding.Modelfile')],
      { cwd: root, env: environment(rt), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let errorText = '';
    child.stderr.on('data', (chunk) => {
      errorText += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(errorText))));
  });
  const inventory = await request(`${rt.ollamaUrl}/api/tags`);
  writeFileSync(
    path.join(root, 'data/model-inventory.json'),
    JSON.stringify(inventory, null, 2) + '\n',
  );
  console.log('Models ready. Memory embeddings are configured for CPU.');
}
