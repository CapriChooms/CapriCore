// SPDX-License-Identifier: GPL-3.0-only
import { request } from '../http.mjs';

const managedModel = 'capri-embed:latest';
const baseModel = 'bge-m3:latest';
const contains = (inventory, name) =>
  Array.isArray(inventory?.models) && inventory.models.some((model) => model.name === name);

/** Repair only Capri's CPU alias from weights already present in the local inventory. */
export async function ensureEmbeddingModel(
  rt,
  { model = managedModel, inventory, signal, requestImpl = request } = {},
) {
  signal?.throwIfAborted();
  if (contains(inventory, model)) return inventory;
  const repairError = () =>
    Object.assign(
      new Error(
        `Memory model ${model} is missing. Run Capri Setup again to repair the installation.`,
      ),
      { code: 'CAPRI_MEMORY_MODEL_MISSING' },
    );
  if (model !== managedModel || !contains(inventory, baseModel)) throw repairError();
  try {
    const created = await requestImpl(`${rt.ollamaUrl}/api/create`, {
      method: 'POST',
      timeout: 60000,
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: managedModel,
        from: baseModel,
        parameters: { num_gpu: 0 },
        stream: false,
      }),
    });
    signal?.throwIfAborted();
    if (created?.error) throw repairError();
    const repaired = await requestImpl(`${rt.ollamaUrl}/api/tags`, { signal });
    signal?.throwIfAborted();
    if (!contains(repaired, model)) throw repairError();
    return repaired;
  } catch {
    signal?.throwIfAborted();
    throw repairError();
  }
}
