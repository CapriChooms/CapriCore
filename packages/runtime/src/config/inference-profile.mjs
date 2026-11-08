// SPDX-License-Identifier: GPL-3.0-only
import { applyLocalContextPolicy } from './context-policy.mjs';
/** Only Capri's managed provider changes; embeddings stay on the local CPU. */
export function applyInferenceProfile(config, rt, local) {
  // Launcher and status helpers do not load the desktop's provider selection.
  // An absent choice must not turn a previously selected API into local inference.
  if (rt.remote === undefined) return config;
  const providers = config.models.providers;
  if (!rt.remote?.enabled) {
    if (String(config.agents.defaults.model?.primary).startsWith('capri-api/')) {
      config.agents.defaults.model.primary = 'ollama/' + local.model;
      config.agents.defaults.imageModel = 'ollama/' + local.model;
      const entry = config.agents.entries?.[local.agentId];
      if (entry?.model) delete entry.model;
    }
    delete providers['capri-api'];
    return config;
  }
  providers['capri-api'] = {
    baseUrl: rt.inferenceUrl + '/v1',
    api: 'openai-completions',
    apiKey: '${CAPRI_REMOTE_PROXY_TOKEN}',
    models: [
      {
        id: rt.remote.model,
        name: rt.remote.model,
        input: rt.remote.vision ? ['text', 'image'] : ['text'],
        // The authenticated local proxy consumes this per-turn control and
        // translates it only for providers with a known reasoning protocol.
        reasoning: true,
        compat: {
          supportsReasoningEffort: true,
          ...(rt.remote.tools === false ? { supportsTools: false } : {}),
        },
        contextWindow: rt.remote.contextTokens,
        maxTokens: 8192,
      },
    ],
  };
  config.agents.defaults.model = { primary: 'capri-api/' + rt.remote.model, fallbacks: [] };
  config.agents.defaults.imageModel = 'capri-api/' + rt.remote.model;
  config.agents.defaults.thinkingDefault = 'off';
  applyLocalContextPolicy(config, rt.remote.contextTokens);
  const entry = config.agents.entries?.[local.agentId];
  if (entry?.model) delete entry.model;
  return config;
}
