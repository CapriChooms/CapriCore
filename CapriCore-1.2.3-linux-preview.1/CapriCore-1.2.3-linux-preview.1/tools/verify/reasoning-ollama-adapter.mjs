// SPDX-License-Identifier: GPL-3.0-only
/** Explicit loopback only; never read Capri preferences, API credentials or owner history. */
export function createReasoningOllamaAdapter({
  url,
  contextTokens = 8192,
  baselineTokens = 768,
  reasoningTokens = 4096,
  fetchImpl = fetch,
}) {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !['', '/'].includes(endpoint.pathname)
  )
    throw new Error('An explicit HTTP loopback model endpoint is required.');
  for (const [value, minimum, maximum] of [
    [contextTokens, 2048, 131072],
    [baselineTokens, 64, 8192],
    [reasoningTokens, 256, 16384],
  ])
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error('Invalid evaluation token budget.');
  return async ({ mode, model, messages, signal }) => {
    const outputBudget = mode === 'reasoning' ? reasoningTokens : baselineTokens;
    const response = await fetchImpl(new URL('/api/chat', endpoint), {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        think: mode === 'reasoning',
        keep_alive: -1,
        tools: [],
        options: {
          temperature: 0,
          seed: 73421,
          num_ctx: contextTokens,
          num_predict: outputBudget,
        },
        messages: messages.map((message, index) =>
          index === 0 && mode === 'reasoning'
            ? {
                ...message,
                content:
                  message.content +
                  ' Check the calculation and the constraints carefully before giving the final answer.',
              }
            : message,
        ),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Evaluation inference failed.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Evaluation response was empty.');
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) {
          await reader.cancel();
          throw new Error('Evaluation response exceeded its limit.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(joined));
    if (body.done !== true || typeof body.message?.content !== 'string')
      throw new Error('Evaluation response was incomplete.');
    return {
      content: body.message.content,
      model: body.model ?? model,
      reasoningObserved:
        typeof body.message.thinking === 'string' && body.message.thinking.trim().length > 0,
      visibleCharacters: body.message.content.length,
      reasoningCharacters:
        typeof body.message.thinking === 'string' ? body.message.thinking.length : 0,
      doneReason: ['stop', 'length'].includes(body.done_reason) ? body.done_reason : 'other',
      budgetExhausted:
        body.done_reason === 'length' ||
        (Number.isSafeInteger(body.eval_count) && body.eval_count >= outputBudget),
      ...(Number.isSafeInteger(body.eval_count) && body.eval_count >= 0
        ? { outputTokens: body.eval_count }
        : {}),
    };
  };
}
