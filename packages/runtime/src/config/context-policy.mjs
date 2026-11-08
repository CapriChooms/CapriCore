/** Small local models need a recent tail that fits alongside tools/persona. */
export const MIN_COMPANION_CONTEXT = 32768;
export const CONTEXT_CHOICES = Object.freeze([32768, 65536, 131072, 262144]);

export function contextChoicesFor(config = {}) {
  const choices = /^capri-hf-[a-f0-9]{24}:latest$/.test(config.model ?? '')
    ? [8192, 16384, ...CONTEXT_CHOICES]
    : CONTEXT_CHOICES;
  return choices.filter((value) => value <= (config.modelContextLimit ?? 262144));
}
export function validateContextChoice(value, config = {}) {
  if (!contextChoicesFor(config).includes(value)) throw new Error('Unsupported context window.');
  return value;
}
export const isManagedCapriModel = (model) => /^capri-qwen3[.]5:(?:0[.]8|2|4|9)b$/.test(model);

const localCompanionModel = (model) =>
  isManagedCapriModel(model) ||
  model === 'ministral-3:3b' ||
  model === 'gemma4:e2b' ||
  /^capri-hf-[a-f0-9]{24}:latest$/.test(model ?? '');
const positiveTokens = (value) => (Number.isSafeInteger(value) && value > 0 ? value : undefined);

/** Reserve only this turn's output; stored model/context/provider settings stay intact. */
export function localTurnOutputBudget(model, { agentId, thinkingLevel } = {}) {
  if (agentId !== 'capri' || model?.provider !== 'ollama' || !localCompanionModel(model.id))
    return undefined;
  const maximum = positiveTokens(model.maxTokens);
  if (!maximum) return undefined;
  const thinking = ['minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'].includes(
    thinkingLevel,
  );
  const contextTokens = Math.min(
    positiveTokens(model.contextWindow) ?? Infinity,
    positiveTokens(model.params?.num_ctx) ?? Infinity,
  );
  return Math.min(
    thinking ? 8192 : 2048,
    maximum,
    positiveTokens(model.params?.num_predict) ?? Infinity,
    Math.max(1, Math.floor(contextTokens / 2)),
  );
}

export function modelForLocalTurn(model, options) {
  const maxTokens = localTurnOutputBudget(model, options);
  return maxTokens !== undefined &&
    (maxTokens !== model.maxTokens || model.params?.num_predict !== maxTokens)
    ? { ...model, maxTokens, params: { ...model.params, num_predict: maxTokens } }
    : model;
}

/** Upgrade only Capri's inference window; keep plugins, credentials and history. */
export function ensureManagedContext(config, model, contextTokens) {
  if (!isManagedCapriModel(model)) return false;
  const entry = config.models?.providers?.ollama?.models?.find((item) => item.id === model);
  if (!entry) return false;
  const target = Math.max(
    MIN_COMPANION_CONTEXT,
    contextTokens,
    entry.contextTokens ?? 0,
    entry.params?.num_ctx ?? 0,
  );
  const before = JSON.stringify([entry, config.agents]);
  entry.contextWindow = entry.contextTokens = target;
  entry.params = { ...entry.params, num_ctx: target };
  applyLocalContextPolicy(config, target);
  return before !== JSON.stringify([entry, config.agents]);
}

export function localContextPolicy(contextTokens) {
  if (!Number.isInteger(contextTokens) || contextTokens < 8192 || contextTokens > 262144)
    throw new Error('Unsupported local context size');
  return {
    enabled: true,
    mode: 'safeguard',
    keepRecentTokens: Math.min(4096, Math.floor(contextTokens / 8)),
    recentTurnsPreserve: 2,
    // Bound replay before it approaches the model's hard limit. This is the
    // active transcript only (not tools/personality); native compaction keeps
    // the original transcript and replaces replay with a summary + recent tail.
    maxActiveTranscriptBytes: Math.max(24576, Math.floor(contextTokens * 0.75)),
    thinkingLevel: 'off',
    timeoutSeconds: 10,
    qualityGuard: { enabled: true, maxRetries: 0 },
    midTurnPrecheck: { enabled: true },
    postIndexSync: 'async',
  };
}

/** Preserve memory provider settings and explicit memory writes/search. */
export function applyLocalContextPolicy(config, contextTokens) {
  const defaults = config.agents?.defaults;
  if (!defaults) throw new Error('Agent defaults are missing');
  defaults.compaction = { ...defaults.compaction, ...localContextPolicy(contextTokens) };
  for (const agent of [defaults, config.agents.entries?.capri]) {
    if (
      typeof agent?.utilityModel === 'string' &&
      /^ollama\/capri-qwen3[.]5:/.test(agent.utilityModel)
    )
      agent.utilityModel = '';
  }
  return defaults.compaction;
}
