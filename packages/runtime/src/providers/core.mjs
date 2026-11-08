import { settings } from '../config/settings.mjs';
import { runtime, headers } from '../context.mjs';
import { startOllama, startGateway, stopManaged } from './services.mjs';
import { request } from '../http.mjs';
import { managedProcess } from '../host/processes.mjs';
import { runCli } from '../client.mjs';
import { root } from '../host/paths.mjs';

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureNativeLanguageModel } from './native-model.mjs';
import { ensureEmbeddingModel } from './embedding-model.mjs';
import { responsiveness } from '../hardware/responsiveness.mjs';

export async function startCore(
  rt = runtime(),
  {
    preload = settings.preloadModels,
    onStage = () => {},
    signal,
    voiceExpected = false,
    voiceReady = false,
  } = {},
) {
  signal?.throwIfAborted();
  onStage('core', 'running');
  const ollama = await startOllama(rt, { signal, voiceExpected, voiceReady });
  signal?.throwIfAborted();
  if (
    rt.remote?.enabled &&
    rt.remote.skipLocalModelOnApi !== false &&
    settings.model !== settings.embeddingModel
  ) {
    // An owned Ollama server can survive a desktop restart with keep_alive=-1.
    // Release only the configured chat model; memory and other local services
    // keep their own residency policy.
    const { models = [] } = await request(`${rt.ollamaUrl}/api/ps`, { timeout: 3000, signal });
    signal?.throwIfAborted();
    if (models.some((model) => model.name === settings.model)) {
      const released = await request(`${rt.ollamaUrl}/api/generate`, {
        method: 'POST',
        timeout: 30000,
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: settings.model, keep_alive: 0, stream: false }),
      });
      signal?.throwIfAborted();
      if (released?.error || released?.done !== true)
        throw new Error('The idle local language model could not be unloaded.');
    }
  }
  if (!rt.remote?.enabled) await ensureNativeLanguageModel(rt, settings, { signal });
  const inventory = await ensureEmbeddingModel(rt, {
    model: settings.embeddingModel,
    inventory: await request(`${rt.ollamaUrl}/api/tags`, { signal }),
    signal,
  });
  for (const name of [...(rt.remote?.enabled ? [] : [settings.model]), settings.embeddingModel]) {
    if (!inventory.models.some((model) => model.name === name))
      throw new Error(`Model ${name} is missing. Run scripts/pull-models.mjs.`);
  }
  signal?.throwIfAborted();
  await startGateway(rt, { signal });
  signal?.throwIfAborted();
  onStage('core', 'ready');
  if (preload) {
    onStage('models', 'running');
    await prewarmModels(rt, { signal, inventory });
    let agentReady = true;
    await (rt.remote?.enabled ? Promise.resolve() : prewarmAgentRuntime(rt, { signal })).catch(
      (error) => {
        signal?.throwIfAborted();
        agentReady = false;
        console.warn('Agent warmup unavailable:', error.message);
      },
    );
    signal?.throwIfAborted();
    onStage('models', agentReady ? 'ready' : 'failed');
  }
  return ollama;
}

export async function prewarmAgentRuntime(rt = runtime(), { signal } = {}) {
  signal?.throwIfAborted();
  // Priming an API-backed agent would make a paid provider request, not warm
  // the optional local standby model.
  if (rt.remote?.enabled) return;
  const process = managedProcess(rt.logPrefix);
  if (!process) return;
  const file = path.join(root, 'data/run', `${rt.logPrefix}.primed.json`);
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.pid === process.pid && saved.startedAt === process.startedAt) return;
  } catch {
    /* A new Gateway needs its agent runtime primed. */
  }
  const key = `agent:${settings.agentId}:internal-warmup-${randomUUID()}`;
  const started = performance.now();
  try {
    await request(`${rt.gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      timeout: responsiveness(settings).agentWarmupTimeoutMs,
      signal,
      headers: {
        ...headers(rt),
        'x-openclaw-session-key': key,
        'x-capri-thinking-once': 'off',
        'x-capri-tools-once': 'conversation',
      },
      body: JSON.stringify({
        model: `openclaw/${settings.agentId}`,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Internal runtime warmup. Do not use tools, write files, or save memories.',
          },
          { role: 'user', content: 'Reply only with the word Ready.' },
        ],
      }),
    });
  } finally {
    // Only the generated technical session is removed; never the user's session.
    await runCli(
      [
        'gateway',
        'call',
        'sessions.delete',
        '--params',
        JSON.stringify({ key, deleteTranscript: true }),
        '--json',
        '--timeout',
        '60000',
      ],
      rt,
      { signal: signal?.aborted ? AbortSignal.timeout(1500) : signal },
    );
  }
  writeFileSync(
    file,
    JSON.stringify({
      pid: process.pid,
      startedAt: process.startedAt,
      warmupMs: performance.now() - started,
    }),
  );
}

export async function prewarmModels(rt = runtime(), { signal, inventory } = {}) {
  // Direct provider priming creates no OpenClaw messages or user memories.
  // Avoid replacing a useful conversation KV cache with "Hello" on reconnect.
  signal?.throwIfAborted();
  let warmLanguage = !rt.remote?.enabled;
  if (rt.remote?.enabled && rt.remote.skipLocalModelOnApi === false) {
    // API mode never imports or downloads a missing local language model.
    inventory ??= await request(`${rt.ollamaUrl}/api/tags`, { signal });
    warmLanguage = inventory.models?.some((model) => model.name === settings.model) === true;
  }
  signal?.throwIfAborted();
  const { models = [] } = await request(`${rt.ollamaUrl}/api/ps`, { signal });
  signal?.throwIfAborted();
  const languageReady = models.some(
    (model) =>
      model.name === settings.model &&
      model.context_length === settings.contextTokens &&
      (settings.acceleration !== 'cpu' || model.size_vram === 0),
  );
  const embeddingsReady = models.some(
    (model) => model.name === settings.embeddingModel && model.size_vram === 0,
  );
  await Promise.all([
    languageReady || !warmLanguage
      ? undefined
      : request(`${rt.ollamaUrl}/api/chat`, {
          method: 'POST',
          timeout: 180000,
          signal,
          headers: { 'content-type': 'application/json' },
          // Match OpenClaw's runner options: toggling context shift reloads Ollama.
          body: JSON.stringify({
            model: settings.model,
            messages: [{ role: 'user', content: 'Hello.' }],
            stream: false,
            ...(!settings.modelCapabilities || settings.modelCapabilities.includes('thinking')
              ? { think: false }
              : {}),
            truncate: false,
            shift: false,
            keep_alive: settings.keepAlive ?? -1,
            options: {
              num_ctx: settings.contextTokens,
              num_predict: 1,
              ...(settings.acceleration === 'cpu' ? { num_gpu: 0 } : {}),
            },
          }),
        }),
    embeddingsReady
      ? undefined
      : request(`${rt.ollamaUrl}/api/embed`, {
          method: 'POST',
          timeout: 180000,
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: settings.embeddingModel,
            input: 'Memory index warmup.',
            keep_alive: settings.keepAlive ?? -1,
            options: { num_gpu: 0 },
          }),
        }),
  ]);
}

export async function stopCore(rt = runtime(), { companion = true } = {}) {
  const stop = async (name) => {
    const started = performance.now();
    try {
      await stopManaged(name);
    } finally {
      console.info('Capri service shutdown:', name, Math.round(performance.now() - started), 'ms');
    }
  };
  if (companion) await stop('desktop');
  // Voice and Gateway have independent lifelines. Drain both concurrently;
  // leave Ollama available until Gateway has released its SQLite/session state.
  const results = await Promise.allSettled([stop('companion-voice'), stop(rt.logPrefix)]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  await stop('ollama');
}
