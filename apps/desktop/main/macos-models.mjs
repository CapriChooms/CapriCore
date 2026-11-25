// SPDX-License-Identifier: GPL-3.0-only
import pinned from '../../../config/llama-models.json' with { type: 'json' };
import { LlamaModelStore } from '../../../packages/runtime/src/providers/llama-model-store.mjs';

const gb = (bytes) => (bytes / 1_000_000_000).toFixed(2) + ' GB';

/** The first-run prompt and transfer share the exact upstream pins used by the local engine.
 * Existing imported/custom models may start normally but are never fetched by this flow. */
export async function prepareMacModels({
  root,
  settings,
  localChat,
  signal,
  confirm,
  progress,
  store = new LlamaModelStore(root, { embeddingModel: settings.embeddingModel }),
}) {
  signal.throwIfAborted();
  const required = new Set([...(localChat ? [settings.model] : []), settings.embeddingModel]);
  const missing = [];
  for (const name of required) {
    try {
      store.get(name);
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.status !== 404) throw error;
    }
    const upstream = store.upstream(name);
    if (!Object.hasOwn(pinned, upstream))
      throw Object.assign(new Error('Restore the selected model in Settings, then reconnect.'), {
        code: 'CAPRI_MAC_MODEL_SETUP',
      });
    const spec = pinned[upstream];
    const bytes = spec.nativeModel
      ? spec.nativeModel.bytes + spec.extraProjector.bytes
      : spec.layers.reduce((total, layer) => total + layer.size, 0);
    missing.push({ name, upstream, bytes });
  }
  if (!missing.length) return true;
  const total = missing.reduce((sum, item) => sum + item.bytes, 0);
  const approved = await confirm({
    message: 'Download models for Capri?',
    detail: [
      ...missing.map(({ upstream, bytes }) => upstream + ' · ' + gb(bytes)),
      '',
      'Up to ' +
        gb(total) +
        ' will be downloaded to this Mac. You can pause and resume the download in Capri.',
    ].join('\n'),
    buttons: ['Download', 'Later'],
    defaultId: 1,
    cancelId: 1,
    signal,
  });
  signal.throwIfAborted();
  if (approved.response !== 0) return false;
  let previous = 0;
  for (const item of missing) {
    const update = (completed, verifying = false) => {
      const fraction = (previous + completed) / total;
      const percent = Math.min(100, Math.floor(fraction * 100));
      progress(
        (verifying ? 'Verifying ' : 'Downloading ') + item.upstream + ' · ' + percent + '%',
        fraction,
      );
    };
    signal.throwIfAborted();
    update(0);
    try {
      await store.pull(item.name, {
        signal,
        onProgress: (value) => update(value.completed, value.status === 'verifying'),
      });
    } catch (error) {
      signal.throwIfAborted();
      throw Object.assign(
        new Error(error.message + ' Select Reconnect to resume.', { cause: error }),
        {
          code: 'CAPRI_MAC_MODEL_SETUP',
        },
      );
    }
    previous += item.bytes;
  }
  signal.throwIfAborted();
  return true;
}
