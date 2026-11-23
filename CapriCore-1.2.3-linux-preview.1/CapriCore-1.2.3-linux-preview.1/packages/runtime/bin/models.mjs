// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { modelPlan } from '../src/providers/model-plan.mjs';
import { root, settings, runtime, startLlama, request, writeJsonAtomic } from '../src/index.mjs';
import { ensureNativeLanguageModel } from '../src/providers/native-model.mjs';
import { pullModel } from '../src/providers/pull-model.mjs';

const plan = modelPlan(settings, process.argv.slice(2));
if (plan.preview) {
  console.log(JSON.stringify(plan));
} else {
  const rt = runtime();
  await startLlama(rt);
  for (const model of plan.models) {
    console.log(`Preparing ${model}...`);
    await pullModel(rt, model, {
      onProgress: ({ file, fileCompleted, fileTotal, completed, total }) => {
        if (process.env.CAPRI_INSTALL_FILE_PROGRESS && file && total > 0) {
          console.log(
            JSON.stringify({
              capriFileTransfer: file,
              received: fileCompleted,
              total: fileTotal,
              stageFraction: completed / total,
            }),
          );
        }
      },
    });
  }
  if (!plan.embeddingOnly || plan.repairSelected) await ensureNativeLanguageModel(rt);
  const inventory = await request(`${rt.ollamaUrl}/api/tags`);
  writeJsonAtomic(path.join(root, 'data/model-inventory.json'), inventory);
  console.log('Models ready. Memory embeddings run on the CPU.');
}
