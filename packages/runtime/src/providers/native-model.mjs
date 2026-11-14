import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { root } from '../host/paths.mjs';
import { settings } from '../config/settings.mjs';
import { runtime } from '../context.mjs';
import { request } from '../http.mjs';
import { generationParams } from '../config/inference.mjs';

function manifestFile(name) {
  if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?(?::[a-zA-Z0-9._-]+)?$/.test(name))
    throw new Error('Invalid local model name');
  const [base, tag = 'latest'] = name.split(':');
  return path.join(
    root,
    'data/models/manifests/registry.ollama.ai',
    ...(base.includes('/') ? base.split('/') : ['library', base]),
    tag,
  );
}
const validDigest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const readBlob = (digest) =>
  readFileSync(path.join(root, 'data/models/blobs', digest.replace(':', '-')), 'utf8');

/** Reuse the exact upstream weights/projector, without its Go renderer/parser. */
export function nativeModelDefinition(manifest, blob = readBlob, profile = generationParams()) {
  if (
    !Array.isArray(manifest?.layers) ||
    manifest.layers.length > 32 ||
    manifest.layers.some((layer) => !validDigest(layer.digest))
  )
    throw new Error('Invalid upstream model manifest');
  const weights = manifest.layers.filter(
    (layer) => layer.mediaType === 'application/vnd.ollama.image.model',
  );
  const projectors = manifest.layers.filter(
    (layer) => layer.mediaType === 'application/vnd.ollama.image.projector',
  );
  if (weights.length !== 1 || projectors.length > 1)
    throw new Error('Expected one language GGUF and at most one vision projector');
  const params = manifest.layers.find(
    (layer) => layer.mediaType === 'application/vnd.ollama.image.params',
  );
  const license = manifest.layers.find(
    (layer) => layer.mediaType === 'application/vnd.ollama.image.license',
  );
  return {
    files: {
      'model.gguf': weights[0].digest,
      ...(projectors.length ? { 'mmproj.gguf': projectors[0].digest } : {}),
    },
    parameters: { ...(params ? JSON.parse(blob(params.digest)) : {}), ...profile },
    ...(license ? { license: blob(license.digest) } : {}),
  };
}

export async function ensureNativeLanguageModel(
  rt = runtime(),
  config = settings,
  { signal } = {},
) {
  signal?.throwIfAborted();
  if (!config.upstreamModel || config.upstreamModel === config.model) return;
  if (rt.localEngine === 'llama.cpp') {
    const description = await request(`${rt.ollamaUrl}/api/show`, {
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model }),
    }).catch((error) => {
      signal?.throwIfAborted();
      if (!/^HTTP 404 from /.test(error.message)) throw error;
      throw Object.assign(
        new Error('Download the selected local language model before starting Capri.'),
        { code: 'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING' },
      );
    });
    if (
      !description.template?.trim() ||
      !['tools', 'thinking'].every((capability) => description.capabilities?.includes(capability))
    )
      throw new Error('The local language model is missing its native GGUF chat template.');
    return;
  }
  let upstream;
  try {
    upstream = JSON.parse(readFileSync(manifestFile(config.upstreamModel), 'utf8'));
  } catch {
    throw Object.assign(
      new Error(
        `Download ${config.upstreamModel} with scripts/pull-models.mjs before starting Capri.`,
      ),
      { code: 'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING' },
    );
  }
  const definition = nativeModelDefinition(
    upstream,
    readBlob,
    generationParams(config.generation, config),
  );
  const show = () =>
    request(`${rt.ollamaUrl}/api/show`, {
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model }),
    });
  let existing = await show().catch(() => null),
    matches = false;
  if (existing?.template_source === 'gguf_chat_template')
    try {
      const saved = JSON.parse(readFileSync(manifestFile(config.model), 'utf8'));
      const own = nativeModelDefinition(
        saved,
        readBlob,
        generationParams(config.generation, config),
      );
      matches = isDeepStrictEqual(own, definition);
    } catch {
      /* Rebuild a missing or outdated local alias through Ollama's API. */
    }
  if (!matches) {
    signal?.throwIfAborted();
    const result = await request(`${rt.ollamaUrl}/api/create`, {
      method: 'POST',
      timeout: 120000,
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, stream: false, ...definition }),
    });
    if (result?.error) throw new Error(result.error);
    existing = await show();
  }
  if (
    existing?.template_source !== 'gguf_chat_template' ||
    !existing.capabilities?.includes('tools') ||
    !existing.capabilities?.includes('thinking')
  )
    throw new Error(
      'The local Qwen alias must use its native chat template with thinking and tools.',
    );
  if (definition.files['mmproj.gguf'] && !existing.capabilities.includes('vision'))
    throw new Error('Native Qwen lost its upstream vision projector');
}
