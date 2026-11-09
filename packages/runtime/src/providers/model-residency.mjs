// SPDX-License-Identifier: GPL-3.0-only
import { request } from '../http.mjs';
import { localRunnerOptions } from './runner-policy.mjs';

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
    const resident = models.find(
      (entry) =>
        entry.name === model &&
        entry.context_length === contextTokens &&
        (acceleration !== 'cpu' || entry.size_vram === 0),
    );
    if (resident)
      return {
        cold: false,
        ...(Number.isFinite(resident.size) && Number.isFinite(resident.size_vram)
          ? {
              residentBytes: resident.size,
              residentGpuBytes: resident.size_vram,
              residentContextTokens: resident.context_length,
            }
          : {}),
      };
    const result = await requestImpl(`${url}/api/chat`, {
      method: 'POST',
      timeout: 180000,
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
    if (result.done !== true) throw new Error('Ollama did not complete language model preparation');
    return { cold: true };
  } catch (cause) {
    signal?.throwIfAborted();
    throw Object.assign(new Error('The local language model could not be prepared.', { cause }), {
      code: 'CAPRI_MODEL_NOT_READY',
    });
  }
}
