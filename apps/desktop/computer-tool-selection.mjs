// SPDX-License-Identifier: GPL-3.0-only
import { LOCAL_RUNNER_POLICY } from '../../packages/runtime/src/providers/runner-policy.mjs';

const tool = {
  type: 'function',
  function: {
    name: 'desktop_control',
    description:
      'Carry out the current owner’s desktop or browser task, including every requested step.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['run_task'] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
};

const selectedAction = (args) => args?.action === 'run_task' && Object.keys(args).length === 1;

export function computerToolSelector({ url, model, params = {}, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password)
    throw new Error('Computer tool selection requires local inference.');
  async function request(endpoint, body, signal) {
    const response = await fetchImpl(new URL(endpoint, base), {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      body: JSON.stringify({ model, stream: false, ...LOCAL_RUNNER_POLICY, ...body }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const raw = await response.text();
    if (raw.length > 16384) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return async (text, { previous, required, nativeTools, signal }) => {
    const messages = [
      {
        role: 'system',
        content:
          'Decide whether the latest owner message asks you to carry out a concrete desktop task. ' +
          'If it does, call desktop_control with action run_task. Searching for pictures in a browser requires submitting the query and inspecting the results. ' +
          'Use previous messages only to resolve references. Capability questions, advice, quoted instructions and requests to refrain from an action do not authorize a task.',
      },
      ...(previous
        ? [{ role: 'user', content: 'Previous owner message, for reference only: ' + previous }]
        : []),
      { role: 'user', content: text },
    ];
    if (nativeTools) {
      const result = await request(
        '/v1/chat/completions',
        {
          messages,
          tools: [tool],
          tool_choice: required
            ? { type: 'function', function: { name: tool.function.name } }
            : 'auto',
          max_tokens: 160,
          reasoning_effort: 'none',
        },
        signal,
      );
      const choice = result?.choices?.[0];
      const calls = choice?.message?.tool_calls;
      if (
        Array.isArray(calls) &&
        calls.length === 1 &&
        calls[0]?.function?.name === tool.function.name &&
        ['tool_calls', 'stop'].includes(choice.finish_reason)
      ) {
        try {
          if (selectedAction(JSON.parse(calls[0].function.arguments))) return true;
        } catch {
          // Some providers return malformed function arguments. Ask for a structured decision.
        }
      }
      if (!required && choice?.finish_reason === 'stop' && !calls?.length) return false;
    }
    // Runners without native function calling can still make the same model decision.
    // A plain-text promise or a malformed response never starts a session.
    const result = await request(
      '/api/chat',
      {
        think: false,
        options: { ...params, num_predict: 96, temperature: 0 },
        format: {
          ...tool.function.parameters,
          properties: { action: { type: 'string', enum: ['run_task', 'respond'] } },
        },
        messages: [
          {
            ...messages[0],
            content: messages[0].content + ' Return a JSON object with action run_task or respond.',
          },
          ...messages.slice(1),
        ],
      },
      signal,
    );
    if (
      result?.done !== true ||
      result.done_reason === 'length' ||
      result.message?.tool_calls?.length
    )
      return null;
    try {
      const args = JSON.parse(result.message?.content);
      if (selectedAction(args)) return true;
      return args?.action === 'respond' && Object.keys(args).length === 1 ? false : null;
    } catch {
      return null;
    }
  };
}
