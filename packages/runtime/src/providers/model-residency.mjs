// SPDX-License-Identifier: GPL-3.0-only
import { request } from '../http.mjs';
import { localRunnerOptions } from './runner-policy.mjs';

export const IMPORTED_CHAT_ERROR =
  'The imported model did not reply. Try another GGUF file or a smaller context window.';

export const modelPreparationErrors = Object.freeze({
  CAPRI_LOCAL_LANGUAGE_MODEL_MISSING:
    'Local model files are missing or incomplete. Open Language model settings and prepare the selected model again.',
  CAPRI_LLAMA_GPU_UNAVAILABLE:
    'The selected GPU is unavailable to the local model engine. Refresh Model devices and choose an available device.',
  CAPRI_LLAMA_GPU_LOAD_FAILED:
    'The local model could not start on the selected GPU. Try a smaller context or choose Automatic or CPU in Model devices.',
  CAPRI_LLAMA_CPU_LOAD_FAILED:
    'The local model could not start on CPU. Try a smaller model or context.',
});

function preparationHttpError(response) {
  const code = response.headers.get('x-capri-model-error');
  if (Object.hasOwn(modelPreparationErrors, code))
    return Object.assign(new Error(modelPreparationErrors[code]), { code });
}

export async function verifyImportedChat(
  { url, model, contextTokens, modelCapabilities, acceleration, cpuThreads },
  { signal, requestImpl = request } = {},
) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1')
    throw new Error('Language model preparation must use local loopback');
  signal?.throwIfAborted();
  try {
    const result = await requestImpl(`${url}/api/chat`, {
      method: 'POST',
      timeout: 120000,
      maxBytes: 1024 * 1024,
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with only OK.' }],
        stream: false,
        ...(modelCapabilities.includes('thinking') ? { think: false } : {}),
        truncate: false,
        shift: false,
        keep_alive: 0,
        options: {
          num_ctx: contextTokens,
          num_predict: 24,
          ...localRunnerOptions({ acceleration, cpuThreads }),
        },
      }),
    });
    signal?.throwIfAborted();
    if (
      result?.done === true &&
      typeof result.message?.content === 'string' &&
      result.message.content.trim()
    )
      return;
  } catch (cause) {
    signal?.throwIfAborted();
    throw new Error(IMPORTED_CHAT_ERROR, { cause });
  }
  throw new Error(IMPORTED_CHAT_ERROR);
}

const allocation = (resident) =>
  Number.isFinite(resident?.size) && Number.isFinite(resident?.size_vram)
    ? {
        residentBytes: resident.size,
        residentGpuBytes: resident.size_vram,
        residentContextTokens: resident.context_length,
      }
    : {};

/** A keep-alive expiry is not a ready language model. Prime only missing/cold
 * inference; never replace a resident conversation KV cache or call agent tools.
 */
export async function ensureLanguageModelReady(
  { url, model, contextTokens, keepAlive = -1, acceleration, cpuThreads, modelCapabilities },
  { signal, requestImpl = request } = {},
) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1')
    throw new Error('Language model preparation must use local loopback');
  signal?.throwIfAborted();
  try {
    const { models = [] } = await requestImpl(`${url}/api/ps`, { timeout: 3000, signal });
    signal?.throwIfAborted();
    const matches = (entry) =>
      entry.name === model &&
      entry.context_length === contextTokens &&
      (acceleration !== 'cpu' || entry.size_vram === 0);
    const resident = models.find(matches);
    if (resident)
      return {
        cold: false,
        ...allocation(resident),
      };
    const result = await requestImpl(`${url}/api/chat`, {
      method: 'POST',
      timeout: 180000,
      onHttpError: preparationHttpError,
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hello.' }],
        stream: false,
        ...(!modelCapabilities || modelCapabilities.includes('thinking') ? { think: false } : {}),
        truncate: false,
        shift: false,
        keep_alive: keepAlive,
        options: {
          num_ctx: contextTokens,
          num_predict: 1,
          ...localRunnerOptions({ acceleration, cpuThreads }),
        },
      }),
    });
    signal?.throwIfAborted();
    if (result.done !== true)
      throw new Error('The local engine did not complete language model preparation');
    // A newly prepared auto runner may also be CPU-only. This bounded metadata
    // read must not turn successful inference into a preparation failure.
    const loaded = await requestImpl(`${url}/api/ps`, { timeout: 1000, signal }).catch(() => ({}));
    signal?.throwIfAborted();
    return {
      cold: true,
      ...allocation(Array.isArray(loaded.models) ? loaded.models.find(matches) : undefined),
    };
  } catch (cause) {
    signal?.throwIfAborted();
    const knownFailure = Object.hasOwn(modelPreparationErrors, cause?.code);
    throw Object.assign(
      new Error(
        knownFailure
          ? modelPreparationErrors[cause.code]
          : 'The local language model could not be prepared.',
        { cause },
      ),
      { code: 'CAPRI_MODEL_NOT_READY' },
    );
  }
}
