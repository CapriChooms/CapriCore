// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { sseData } from './chat-service.mjs';
import { CHATGPT_RESOURCE, ChatGPTPlanError } from './chatgpt-plan-auth.mjs';
import { chatGPTFastEffort } from './chatgpt-plan-models.mjs';

const invalid = () =>
  new ChatGPTPlanError(
    'ChatGPT returned an incomplete or unsupported response.',
    'CAPRI_CHATGPT_RESPONSE',
  );
export function chatGPTResponsesRequest(payload) {
  if (!Array.isArray(payload.messages) || !payload.messages.length) throw invalid();
  const input = [];
  for (const message of payload.messages) {
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output:
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      });
      continue;
    }
    if (!['system', 'developer', 'user', 'assistant'].includes(message.role)) throw invalid();
    if (message.content) {
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content.map((part) => {
              if (part.type === 'text' && typeof part.text === 'string')
                return {
                  type: message.role === 'assistant' ? 'output_text' : 'input_text',
                  text: part.text,
                };
              if (part.type === 'image_url' && typeof part.image_url?.url === 'string')
                return {
                  type: 'input_image',
                  image_url: part.image_url.url,
                  detail: part.image_url.detail ?? 'auto',
                };
              throw invalid();
            });
      input.push({ role: message.role, content });
    }
    for (const call of message.tool_calls ?? []) {
      if (
        call.type !== 'function' ||
        typeof call.function?.name !== 'string' ||
        typeof call.function.arguments !== 'string'
      )
        throw invalid();
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        namespace: 'capri',
        arguments: call.function.arguments,
      });
    }
  }
  const functions = (payload.tools ?? []).map((tool) => {
    if (tool.type !== 'function' || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.function?.name))
      throw invalid();
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description ?? '',
      parameters: tool.function.parameters ?? { type: 'object', properties: {} },
      strict: false,
    };
  });
  const effort =
    payload.reasoning?.effort ?? payload.reasoning_effort ?? chatGPTFastEffort(payload.model);
  const request = {
    model: payload.model,
    input,
    store: false,
    stream: true,
    max_output_tokens: Math.max(
      effort === 'none' ? 64 : 1024,
      Math.min(16384, payload.max_completion_tokens ?? payload.max_tokens ?? 2048),
    ),
    ...(functions.length
      ? {
          tools: [
            {
              type: 'namespace',
              name: 'capri',
              description: 'Owner-authorized Capri capabilities.',
              tools: functions,
            },
          ],
        }
      : {}),
  };
  if (['none', 'auto', 'required'].includes(payload.tool_choice))
    request.tool_choice = payload.tool_choice;
  else if (payload.tool_choice?.type === 'function')
    request.tool_choice = {
      type: 'function',
      namespace: 'capri',
      name: payload.tool_choice.function.name,
    };
  if (typeof payload.parallel_tool_calls === 'boolean')
    request.parallel_tool_calls = payload.parallel_tool_calls;
  if (payload.response_format?.type === 'json_object')
    request.text = { format: { type: 'json_object' } };
  if (payload.response_format?.type === 'json_schema')
    request.text = { format: { type: 'json_schema', ...payload.response_format.json_schema } };
  if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
    request.reasoning = { effort };
  return request;
}

async function* responseEvents(body, signal) {
  try {
    yield* sseData(body);
  } catch (error) {
    if (error instanceof ChatGPTPlanError) throw error;
    if (signal.aborted) throw new ChatGPTPlanError('ChatGPT request cancelled or timed out.');
    throw invalid();
  }
}

async function* completionPackets(body, payload, signal) {
  const id = 'chatcmpl-' + randomUUID(),
    calls = new Map();
  const names = new Set((payload.tools ?? []).map((tool) => tool.function?.name));
  const packet = (delta, finish_reason = null, usage) => ({
    id,
    object: 'chat.completion.chunk',
    model: payload.model,
    choices: [{ index: 0, delta, finish_reason }],
    ...(usage ? { usage } : {}),
  });
  let completed = false,
    textSeen = false,
    total = 0;
  const tool = (item, index) => {
    if (item.type !== 'function_call') return;
    const name = item.name?.replace(/^capri\./, '');
    if (item.namespace !== undefined && item.namespace !== 'capri') throw invalid();
    if (
      !names.has(name) ||
      typeof item.call_id !== 'string' ||
      item.call_id.length > 200 ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 1024
    )
      throw invalid();
    const existing = calls.get(index);
    if (existing) {
      if (existing.id !== item.call_id || existing.name !== name) throw invalid();
      return existing;
    }
    const value = { id: item.call_id, name, index: calls.size, arguments: '', announced: false };
    calls.set(index, value);
    return value;
  };
  const delta = (call, argumentsPart = '') => {
    const result = {
      index: call.index,
      ...(!call.announced ? { id: call.id, type: 'function' } : {}),
      function: { ...(!call.announced ? { name: call.name } : {}), arguments: argumentsPart },
    };
    call.announced = true;
    call.arguments += argumentsPart;
    return { tool_calls: [result] };
  };
  for await (const raw of responseEvents(body, signal)) {
    signal.throwIfAborted();
    total += raw.length;
    if (total > 16 * 1024 * 1024) throw invalid();
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw invalid();
    }
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
      if (typeof event.delta !== 'string') throw invalid();
      textSeen = true;
      yield packet({ content: event.delta });
    } else if (
      event.type === 'response.output_item.added' &&
      event.item?.type === 'function_call'
    ) {
      if (event.item.arguments !== undefined && typeof event.item.arguments !== 'string')
        throw invalid();
      const call = tool(event.item, event.output_index);
      yield packet(delta(call, event.item.arguments ?? ''));
    } else if (event.type === 'response.function_call_arguments.delta') {
      const call = calls.get(event.output_index);
      if (!call || typeof event.delta !== 'string') throw invalid();
      yield packet(delta(call, event.delta));
    } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const call = tool(event.item, event.output_index),
        full = event.item.arguments;
      if (typeof full !== 'string' || !full.startsWith(call.arguments)) throw invalid();
      if (!call.announced || full.length > call.arguments.length)
        yield packet(delta(call, full.slice(call.arguments.length)));
    } else if (
      event.type === 'response.failed' ||
      event.type === 'error' ||
      event.type === 'response.incomplete'
    ) {
      const code = event.response?.error?.code ?? event.code;
      throw [
        'subscription_sharing_usage_limit_exceeded',
        'subscription_sharing_usage_unavailable',
      ].includes(code)
        ? new ChatGPTPlanError(
            'ChatGPT plan usage is unavailable or its limit was reached. Open Manage usage.',
            'CAPRI_CHATGPT_LIMIT',
          )
        : invalid();
    } else if (event.type === 'response.completed') {
      if (event.response?.status !== 'completed') throw invalid();
      for (const [index, item] of (event.response.output ?? []).entries()) {
        if (item.type === 'function_call') {
          const call = tool(item, index),
            full = item.arguments;
          if (typeof full !== 'string' || !full.startsWith(call.arguments)) throw invalid();
          if (!call.announced || full.length > call.arguments.length)
            yield packet(delta(call, full.slice(call.arguments.length)));
        }
      }
      if (!textSeen) {
        const text = (event.response.output ?? [])
          .flatMap((item) => (item.type === 'message' ? (item.content ?? []) : []))
          .map((part) =>
            part.type === 'output_text'
              ? (part.text ?? '')
              : part.type === 'refusal'
                ? (part.refusal ?? '')
                : '',
          )
          .join('');
        if (text) {
          textSeen = true;
          yield packet({ content: text });
        }
      }
      if (!textSeen && !calls.size) throw invalid();
      const usage = event.response.usage;
      yield packet(
        {},
        calls.size ? 'tool_calls' : 'stop',
        usage
          ? {
              prompt_tokens: usage.input_tokens,
              completion_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
            }
          : undefined,
      );
      completed = true;
      break;
    }
  }
  if (!completed) throw invalid();
}

export async function chatGPTCompletion(auth, payload, signal, accessToken) {
  const request = chatGPTResponsesRequest(payload),
    controller = new AbortController();
  const boundedSignal = AbortSignal.any([controller.signal, signal, AbortSignal.timeout(120000)]);
  auth.controllers.set(controller, payload.accountId);
  let response;
  try {
    response = await auth.fetchImpl(CHATGPT_RESOURCE + '/responses', {
      method: 'POST',
      signal: boundedSignal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        authorization: 'Bearer ' + accessToken,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(request),
    });
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw new ChatGPTPlanError(
        response.status === 429
          ? 'ChatGPT usage limit reached. Open Manage usage.'
          : 'ChatGPT request could not complete. Check the account, model and plan usage permission.',
        'CAPRI_CHATGPT_CONNECTION',
      );
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    // The ChatGPT direct route can omit Content-Type on a valid SSE response.
    // Its bounded event parser and response.completed requirement still validate
    // the stream. Explicit non-SSE media types remain unsupported.
    if (contentType && contentType !== 'text/event-stream') throw invalid();
    const packets = completionPackets(response.body, payload, boundedSignal);
    async function* encoded() {
      try {
        for await (const packet of packets)
          yield Buffer.from('data: ' + JSON.stringify(packet) + '\n\n');
        yield Buffer.from('data: [DONE]\n\n');
      } catch (error) {
        throw error instanceof ChatGPTPlanError ? error : invalid();
      } finally {
        controller.abort();
        auth.controllers.delete(controller);
      }
    }
    if (payload.stream === true) {
      const iterator = encoded();
      return new Response(
        new ReadableStream({
          async pull(target) {
            try {
              const next = await iterator.next();
              if (next.done) target.close();
              else target.enqueue(next.value);
            } catch (error) {
              target.error(error instanceof ChatGPTPlanError ? error : invalid());
            }
          },
          async cancel() {
            controller.abort();
            await iterator.return().catch(() => {});
            auth.controllers.delete(controller);
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    let text = '',
      usage,
      finish_reason;
    const calls = new Map();
    for await (const packet of packets) {
      const choice = packet.choices[0];
      text += choice.delta.content ?? '';
      for (const part of choice.delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? {
          id: part.id,
          type: 'function',
          function: { name: part.function.name, arguments: '' },
        };
        call.function.arguments += part.function.arguments ?? '';
        calls.set(part.index, call);
      }
      usage = packet.usage ?? usage;
      finish_reason = choice.finish_reason ?? finish_reason;
    }
    controller.abort();
    auth.controllers.delete(controller);
    return Response.json({
      id: 'chatcmpl-' + randomUUID(),
      object: 'chat.completion',
      model: payload.model,
      choices: [
        {
          index: 0,
          finish_reason,
          message: {
            role: 'assistant',
            content: text || null,
            ...(calls.size ? { tool_calls: [...calls.values()] } : {}),
          },
        },
      ],
      usage,
    });
  } catch (error) {
    const cancelled = boundedSignal.aborted;
    controller.abort();
    auth.controllers.delete(controller);
    void response?.body?.cancel().catch(() => {});
    throw error instanceof ChatGPTPlanError
      ? error
      : new ChatGPTPlanError(
          cancelled
            ? 'ChatGPT request cancelled or timed out.'
            : 'ChatGPT connection failed. Check the network and try again.',
        );
  }
}
