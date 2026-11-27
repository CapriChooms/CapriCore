// SPDX-License-Identifier: GPL-3.0-only
/** Loading weights does not prime Qwen's conversation cache. Vision, restart and
 * keep-alive eviction can all require a full prefill of an existing conversation.
 * This is a bounded planning allowance, not a claim that generation will be fast.
 */
export function conversationBudget({
  session,
  model,
  contextTokens,
  historyCharacters = 0,
  firstTextTimeoutMs = 30000,
  timeoutMs = 180000,
  residentBytes,
  residentGpuBytes,
  emulatedX64 = false,
}) {
  const positive = (n) => Number.isFinite(n) && n > 0;
  const window = positive(contextTokens) ? Math.min(contextTokens, 262144) : 32768;
  const matching = session?.model === model;
  const measured =
    matching && session.totalTokensFresh !== false && positive(session.totalTokens)
      ? session.totalTokens
      : 0;
  const pressure =
    matching &&
    session.contextBudgetStatus?.model === model &&
    session.contextBudgetStatus?.sessionId === session.sessionId &&
    positive(session.contextBudgetStatus.estimatedPromptTokens)
      ? session.contextBudgetStatus.estimatedPromptTokens
      : 0;
  // A local transcript is only a fallback: it omits native tools and memory.
  // Reserve the configured window for long histories if metadata is unavailable.
  const fallback = !measured && !pressure && historyCharacters >= 12000 ? window : 0;
  const promptTokens = Math.min(window, Math.max(measured, pressure, fallback));
  // Automatic acceleration can fall back to CPU. Use observed allocation,
  // rather than only the saved device preference, for the prefill allowance.
  const observedCpu = positive(residentBytes) && residentGpuBytes === 0;
  const initialDeadline = Math.min(
    timeoutMs,
    Math.max(firstTextTimeoutMs, emulatedX64 ? 180000 : observedCpu ? 120000 : 0),
  );
  const cap = Math.max(initialDeadline, Math.min(150000, timeoutMs - 30000));
  const firstReplyMs =
    promptTokens > 4096
      ? Math.max(
          initialDeadline,
          Math.min(cap, Math.ceil((15000 + (promptTokens / 160) * 1000) / 1000) * 1000),
        )
      : initialDeadline;
  return {
    firstTextTimeoutMs: firstReplyMs,
    promptTokens: Math.round(promptTokens),
    source: pressure
      ? 'gateway-estimate'
      : measured
        ? 'gateway-usage'
        : fallback
          ? 'local-history'
          : 'default',
  };
}

/** Read-only metadata is optional and must never block an ordinary turn. */
export async function readConversationBudget({ rpc, sessionKey, signal, ...options }) {
  signal?.throwIfAborted();
  let session;
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1200)]);
  try {
    const request = rpc.call('sessions.describe', { key: sessionKey }, { signal: bounded });
    session = await new Promise((resolve, reject) => {
      const abort = () => reject(bounded.reason);
      bounded.addEventListener('abort', abort, { once: true });
      request.then(resolve, reject).finally(() => bounded.removeEventListener('abort', abort));
      if (bounded.aborted) abort();
    });
  } catch {
    signal?.throwIfAborted();
  }
  return conversationBudget({ ...options, session: session?.session });
}
