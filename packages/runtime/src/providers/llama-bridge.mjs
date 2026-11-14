// SPDX-License-Identifier: GPL-3.0-only
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { modelPreparationErrors } from './model-residency.mjs';

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const unavailable = (message) => Object.assign(new Error(message), { status: 503 });
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function json(response, value, status = 200) {
  response.writeHead(status, jsonHeaders).end(JSON.stringify(value));
}

async function readJson(req) {
  const buffers = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 ** 2) throw invalid('The local model request exceeds its size limit.');
    buffers.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(buffers).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw invalid('Invalid local model request.');
}

const imageUrl = (image) => {
  if (typeof image !== 'string') throw invalid('Invalid local image.');
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(image)) return image;
  if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(image)) throw invalid('Invalid local image.');
  const mime = image.startsWith('/9j/')
    ? 'jpeg'
    : image.startsWith('UklGR')
      ? 'webp'
      : image.startsWith('R0lGOD')
        ? 'gif'
        : 'png';
  return `data:image/${mime};base64,${image.replace(/\s/g, '')}`;
};

function nativeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 512)
    throw invalid('Invalid chat messages.');
  let pending = [];
  return messages.map((entry, index) => {
    if (!entry || !['system', 'developer', 'user', 'assistant', 'tool'].includes(entry.role))
      throw invalid('Invalid chat role.');
    let content = entry.content ?? '';
    if (Array.isArray(entry.images) && entry.images.length) {
      if (typeof content !== 'string' || entry.images.length > 16)
        throw invalid('Invalid chat image list.');
      content = [
        ...(content ? [{ type: 'text', text: content }] : []),
        ...entry.images.map((image) => ({
          type: 'image_url',
          image_url: { url: imageUrl(image) },
        })),
      ];
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'image_url') imageUrl(part.image_url?.url);
        else if (part?.type !== 'text') throw invalid('Unsupported local input type.');
      }
    } else if (typeof content !== 'string') throw invalid('Invalid chat content.');
    const message = { role: entry.role, content };
    if (typeof entry.reasoning_content === 'string' || typeof entry.thinking === 'string')
      message.reasoning_content = entry.reasoning_content ?? entry.thinking;
    if (entry.role === 'assistant' && Array.isArray(entry.tool_calls)) {
      message.tool_calls = entry.tool_calls.map((call, callIndex) => {
        const fn = call.function;
        if (!fn || typeof fn.name !== 'string') throw invalid('Invalid local tool call.');
        return {
          id: call.id ?? `call_${index}_${callIndex}`,
          type: 'function',
          function: {
            name: fn.name,
            arguments:
              typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
          },
        };
      });
      pending = [...message.tool_calls];
    }
    if (entry.role === 'tool') {
      const found = pending.findIndex((call) =>
        entry.tool_call_id
          ? call.id === entry.tool_call_id
          : !entry.tool_name || call.function.name === entry.tool_name,
      );
      message.tool_call_id =
        entry.tool_call_id ?? (found >= 0 ? pending[found].id : `call_${index}_0`);
      if (found >= 0) pending.splice(found, 1);
    }
    return message;
  });
}

export function llamaChatBody(input, { legacy, config, model }) {
  const options = input.options ?? {};
  const body = {
    model: model.name,
    messages: nativeMessages(input.messages),
    stream: input.stream === true || (legacy && input.stream !== false),
    ...(!legacy && input.stream_options ? { stream_options: input.stream_options } : {}),
    ...(Array.isArray(input.tools) && input.tools.length ? { tools: input.tools } : {}),
    ...(input.tool_choice !== undefined ? { tool_choice: input.tool_choice } : {}),
  };
  const max = options.num_predict ?? input.max_completion_tokens ?? input.max_tokens ?? 8192;
  if (Number.isInteger(max) && max > 0) body.max_tokens = Math.min(32768, max);
  for (const key of [
    'temperature',
    'top_k',
    'top_p',
    'min_p',
    'repeat_penalty',
    'repeat_last_n',
    'seed',
    'frequency_penalty',
    'presence_penalty',
  ]) {
    const value = options[key] ?? input[key] ?? config.generation?.[key];
    if (Number.isFinite(value)) body[key] = value;
  }
  const stop = options.stop ?? input.stop;
  if (typeof stop === 'string' || Array.isArray(stop)) body.stop = stop;
  const effort = input.reasoning_effort;
  const thinking =
    input.think === true ||
    ['low', 'medium', 'high', 'xhigh'].includes(input.think) ||
    ['low', 'medium', 'high', 'xhigh'].includes(effort);
  const scaled = { low: 1, medium: 2, high: 4, xhigh: 8 }[effort ?? input.think] ?? 1;
  const budget = options.think_budget ?? options.reasoning_budget ?? config.reasoningBudget ?? 64;
  body.chat_template_kwargs = { enable_thinking: thinking };
  body.reasoning_budget = thinking ? Math.min(4096, Math.max(1, budget * scaled)) : 0;
  if (input.format === 'json') body.response_format = { type: 'json_object' };
  else if (input.format && typeof input.format === 'object')
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'capri_result', schema: input.format },
    };
  else if (input.response_format) body.response_format = input.response_format;
  return body;
}

function metrics(packet) {
  const { usage, timings } = packet;
  return {
    prompt_eval_count: usage?.prompt_tokens ?? timings?.prompt_n ?? 0,
    eval_count: usage?.completion_tokens ?? timings?.predicted_n ?? 0,
    ...(Number.isFinite(timings?.prompt_ms)
      ? { prompt_eval_duration: Math.round(timings.prompt_ms * 1e6) }
      : {}),
    ...(Number.isFinite(timings?.predicted_ms)
      ? { eval_duration: Math.round(timings.predicted_ms * 1e6) }
      : {}),
  };
}

function legacyTools(calls) {
  return calls.map(({ id, function: fn }, index) => {
    let args = fn.arguments;
    if (typeof args === 'string')
      try {
        args = JSON.parse(args);
      } catch {}
    return { ...(id ? { id } : {}), function: { index, name: fn.name, arguments: args } };
  });
}

const legacyMessage = (message = {}) => ({
  role: 'assistant',
  content: typeof message.content === 'string' ? message.content : '',
  ...(message.reasoning_content ? { thinking: message.reasoning_content } : {}),
  ...(message.tool_calls?.length ? { tool_calls: legacyTools(message.tool_calls) } : {}),
});

function stamp(model, values) {
  return { model, created_at: new Date().toISOString(), ...values };
}

async function writeLine(res, value, signal) {
  signal.throwIfAborted();
  if (!res.write(JSON.stringify(value) + '\n')) await once(res, 'drain', { signal });
}

async function legacyStream(upstream, res, model, signal, generate) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  let buffer = '',
    finish,
    info = {};
  const tools = [];
  for await (const text of upstream.body.pipeThrough(new TextDecoderStream())) {
    signal.throwIfAborted();
    buffer += text;
    if (buffer.length > 2 * 1024 ** 2)
      throw unavailable('Local model stream packet exceeds its limit.');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const packet = JSON.parse(data);
      if (packet.error) throw unavailable('The local model stopped before finishing the response.');
      if (packet.usage || packet.timings) info = { ...info, ...metrics(packet) };
      const choice = packet.choices?.[0],
        delta = choice?.delta;
      finish = choice?.finish_reason ?? finish;
      if (!delta) continue;
      for (const part of delta.tool_calls ?? []) {
        const index = part.index;
        if (!Number.isInteger(index) || index < 0 || index >= 64)
          throw unavailable('Invalid local tool stream.');
        const tool = (tools[index] ??= { function: { name: '', arguments: '' } });
        if (part.id) tool.id = part.id;
        if (part.function?.name) tool.function.name += part.function.name;
        if (part.function?.arguments) tool.function.arguments += part.function.arguments;
        if (tool.function.arguments.length > 2 * 1024 ** 2)
          throw unavailable('Local tool arguments exceed their limit.');
      }
      const message = legacyMessage({ ...delta, tool_calls: undefined });
      if (message.content || message.thinking)
        await writeLine(
          res,
          stamp(model, {
            ...(generate ? { response: message.content, thinking: message.thinking } : { message }),
            done: false,
          }),
          signal,
        );
    }
  }
  if (!finish) throw unavailable('The local model stream ended early.');
  if (tools.length)
    await writeLine(
      res,
      stamp(model, { message: legacyMessage({ tool_calls: tools.filter(Boolean) }), done: false }),
      signal,
    );
  res.end(
    JSON.stringify(
      stamp(model, {
        ...(generate ? { response: '' } : { message: legacyMessage() }),
        done: true,
        done_reason: finish,
        ...info,
      }),
    ) + '\n',
  );
}

async function nativeRequest(worker, endpoint, body, signal) {
  let response;
  try {
    response = await fetch(worker.url + endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { ...jsonHeaders, authorization: 'Bearer ' + worker.token },
      body: JSON.stringify(body),
    });
  } catch (error) {
    signal.throwIfAborted();
    throw unavailable('llama.cpp stopped while processing the request.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(
      new Error(`llama.cpp could not complete the request (HTTP ${response.status}).`),
      { status: response.status >= 400 && response.status < 500 ? response.status : 503 },
    );
  }
  return response;
}

export function createLlamaBridge({ store, workers, config, version, configuration }) {
  const started = Date.now();
  const instance = randomUUID();
  return createServer({ requestTimeout: 180000, headersTimeout: 15000 }, async (req, res) => {
    // This service is private to loopback. Reject browser cross-origin and
    // DNS-rebinding requests before accepting any model data or operations.
    if (
      !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '') ||
      (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)
    )
      return json(res, { error: 'Local inference is restricted to Capri.' }, 403);
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const { signal } = abort;
    try {
      const method = req.method,
        route = req.url;
      if (method === 'GET') {
        if (route === '/api/version')
          return json(res, { version, engine: 'llama.cpp', started, instance, configuration });
        if (route === '/api/tags') return json(res, { models: store.list() });
        if (route === '/api/ps') return json(res, { models: workers.list() });
        if (route === '/v1/models')
          return json(res, {
            object: 'list',
            data: store
              .list()
              .map(({ name }) => ({ id: name, object: 'model', owned_by: 'capri' })),
          });
      }
      if (!['POST', 'DELETE'].includes(method))
        return json(res, { error: 'Unknown local endpoint.' }, 404);
      const input = await readJson(req);
      if (route === '/api/pull' && method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.flushHeaders();
        await store.pull(input.model ?? input.name, {
          signal,
          onProgress: (progress) => {
            if (!signal.aborted) res.write(JSON.stringify(progress) + '\n');
          },
        });
        return res.end();
      }
      if (route === '/api/create' && method === 'POST') {
        if (input.files) store.registerImport(input.model, input.files);
        else store.get(input.model);
        return json(res, { status: 'success' });
      }
      if (route === '/api/delete' && method === 'DELETE') {
        await workers.unload(input.model);
        store.pendingImports.delete(input.model);
        return json(res, {});
      }
      if (
        route === '/api/generate' &&
        method === 'POST' &&
        !input.prompt &&
        input.keep_alive === 0
      ) {
        await workers.unload(input.model);
        return json(res, stamp(input.model, { done: true, done_reason: 'unload' }));
      }
      const model = store.get(input.model);
      if (route === '/api/show') return json(res, store.describe(model));
      if (['/api/embed', '/api/embeddings', '/v1/embeddings'].includes(route)) {
        const source = input.input ?? input.prompt;
        if (
          !model.embedding ||
          !(
            typeof source === 'string' ||
            (Array.isArray(source) &&
              source.length &&
              source.every((text) => typeof text === 'string'))
          )
        )
          throw invalid('Invalid local embedding request.');
        return await workers.use(model, 'embedding', input, signal, async (worker, active) => {
          const upstream = await nativeRequest(
            worker,
            '/v1/embeddings',
            { model: model.name, input: source },
            active,
          );
          const packet = await upstream.json();
          if (route === '/v1/embeddings') return json(res, packet);
          const embeddings = packet.data.map((entry) => entry.embedding);
          return json(
            res,
            route === '/api/embeddings'
              ? { embedding: embeddings[0] }
              : { model: model.name, embeddings, prompt_eval_count: packet.usage?.prompt_tokens },
          );
        });
      }
      if (
        !['/api/chat', '/api/generate', '/v1/chat/completions'].includes(route) ||
        model.embedding
      )
        return json(res, { error: 'Unknown local inference endpoint.' }, 404);
      const legacy = route !== '/v1/chat/completions';
      if (route === '/api/generate')
        input.messages = [{ role: 'user', content: input.prompt ?? '', images: input.images }];
      const body = llamaChatBody(input, { legacy, config, model });
      if (legacy && body.stream) body.stream_options = { include_usage: true };
      await workers.use(model, 'chat', input, signal, async (worker, active) => {
        const upstream = await nativeRequest(worker, '/v1/chat/completions', body, active);
        if (body.stream) {
          if (legacy)
            await legacyStream(upstream, res, model.name, active, route === '/api/generate');
          else {
            res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
            await pipeline(Readable.fromWeb(upstream.body), res, { signal: active });
          }
          return;
        }
        const packet = await upstream.json();
        if (!legacy) return json(res, packet);
        const choice = packet.choices?.[0];
        if (!choice?.message) throw unavailable('The local model returned no answer.');
        const message = legacyMessage(choice.message);
        return json(
          res,
          stamp(model.name, {
            ...(route === '/api/generate'
              ? { response: message.content, thinking: message.thinking }
              : { message }),
            done: true,
            done_reason: choice.finish_reason,
            ...metrics(packet),
          }),
        );
      });
    } catch (error) {
      if (signal.aborted || res.destroyed) return;
      const status = Number.isInteger(error.status) ? error.status : 503;
      const message = routeError(error, status, req.url);
      if (res.headersSent) res.end(JSON.stringify({ error: message }) + '\n');
      else {
        const code = Object.hasOwn(modelPreparationErrors, error.code) ? error.code : undefined;
        if (code) res.setHeader('x-capri-model-error', code);
        json(res, { error: message }, status);
      }
    }
  });
}

function routeError(error, status, route) {
  if (error.status === status || route === '/api/pull') {
    // Download URLs can contain short-lived query tokens. They never leave the transport.
    return String(error.message)
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[download URL]')
      .slice(0, 200);
  }
  return 'The local llama.cpp runtime could not complete the request.';
}
