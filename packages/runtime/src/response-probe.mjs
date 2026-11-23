// SPDX-License-Identifier: GPL-3.0-only
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  currentResponseTiming,
  withResponseTiming,
  markResponseTiming,
} from './response-timing.mjs';
import { timingId } from './response-timing-schema.mjs';
import { diagnosticModelId } from './technical-model-id.mjs';

/** Observe bounded JSON/NDJSON lines without retaining or logging their contents. */
export class ProviderTimingTap {
  constructor(mark, { streaming = true } = {}) {
    this.mark = mark;
    this.streaming = streaming;
    this.decoder = new TextDecoder();
    this.pending = '';
    this.first = false;
    this.firstContent = false;
    this.reasoningCharacters = 0;
    this.finished = false;
  }
  packet(packet) {
    if (!this.first && (packet.message?.content || packet.message?.thinking || packet.response)) {
      this.first = true;
      this.mark('provider_first_token', { streaming: Number(this.streaming) });
    }
    if (!this.firstContent) {
      if (typeof packet.message?.thinking === 'string')
        this.reasoningCharacters += packet.message.thinking.length;
      if (packet.message?.content || packet.response) {
        this.firstContent = true;
        this.mark('provider_first_content', {
          reasoningCharactersBeforeText: this.reasoningCharacters,
        });
      }
    }
    if (packet.done === true && !this.finished) {
      this.finished = true;
      const metrics = {};
      for (const [from, to] of Object.entries({
        load_duration: 'loadMs',
        prompt_eval_duration: 'promptEvalMs',
        eval_duration: 'evalMs',
        total_duration: 'totalMs',
      }))
        if (Number.isFinite(packet[from])) metrics[to] = packet[from] / 1e6;
      if (Number.isSafeInteger(packet.prompt_eval_count))
        metrics.promptTokens = packet.prompt_eval_count;
      if (Number.isSafeInteger(packet.eval_count)) metrics.outputTokens = packet.eval_count;
      this.mark('provider_finished', metrics);
    }
  }
  push(bytes, final = false) {
    if (this.finished) return;
    this.pending +=
      typeof bytes === 'string'
        ? bytes
        : this.decoder.decode(bytes ?? new Uint8Array(), { stream: !final });
    if (this.pending.length > 1024 * 1024) {
      this.pending = '';
      return;
    }
    let newline;
    while ((newline = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      this.line(line);
    }
    if (final) {
      this.line(this.pending);
      this.pending = '';
    }
  }
  line(line) {
    if (this.firstContent && !/"done"\s*:\s*true/.test(line)) return;
    try {
      this.packet(JSON.parse(line));
    } catch {
      /* Observability cannot break a provider response. */
    }
  }
}

export function providerRequestCounts(body) {
  if (typeof body !== 'string') return {};
  const counts = { payloadBytes: Buffer.byteLength(body) };
  if (body.length > 2 * 1024 * 1024) return counts;
  try {
    const value = JSON.parse(body);
    const modelId = diagnosticModelId(value.model);
    if (modelId) counts.modelId = modelId;
    if (typeof value.think === 'boolean') counts.thinking = Number(value.think);
    if (typeof value.shift === 'boolean') counts.contextShift = Number(value.shift);
    if (typeof value.truncate === 'boolean') counts.truncate = Number(value.truncate);
    if (Array.isArray(value.tools)) {
      counts.toolCount = value.tools.length;
      counts.toolSchemaCharacters = JSON.stringify(value.tools).length;
    }
    for (const [key, target] of Object.entries({
      num_thread: 'threadCount',
      num_batch: 'batchSize',
      num_gpu: 'gpuLayers',
      num_predict: 'predictTokens',
    }))
      if (Number.isFinite(value.options?.[key])) counts[target] = value.options[key];
    if (Array.isArray(value.messages)) {
      counts.messageCount = value.messages.length;
      counts.inputCharacters = 0;
      counts.systemCharacters = 0;
      for (const message of value.messages)
        if (typeof message.content === 'string') {
          counts.inputCharacters += message.content.length;
          if (message.role === 'system') counts.systemCharacters += message.content.length;
        }
    }
    if (Number.isFinite(value.options?.num_ctx)) counts.contextTokens = value.options.num_ctx;
    counts.streaming = Number(value.stream !== false);
  } catch {
    /* Never save raw or malformed bodies. */
  }
  return counts;
}

/** Only Capri's owned loopback Ollama endpoint. No remote API keys or responses are inspected. */
export function timingFetch(original, { ollamaPort }) {
  return async function (input, options) {
    let url;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    } catch {
      return original(input, options);
    }
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== String(ollamaPort) ||
      !['/api/chat', '/api/generate'].includes(url.pathname)
    )
      return original(input, options);
    const turn = currentResponseTiming();
    if (!turn) return original(input, options);
    const requestId = randomUUID();
    const mark = (stage, values) =>
      markResponseTiming(stage, values, { turn, source: 'provider', requestId });
    const counts = providerRequestCounts(options?.body);
    mark('provider_request', counts);
    try {
      const response = await original(input, options);
      mark('provider_headers', { status: response.status });
      if (!response.body) return response;
      const tap = new ProviderTimingTap(mark, { streaming: counts.streaming !== 0 });
      return new Response(
        response.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              try {
                tap.push(chunk);
              } catch {
                /* Diagnostic parsing is optional. */
              }
              controller.enqueue(chunk);
            },
            flush() {
              try {
                tap.push(undefined, true);
              } catch {
                /* Preserve provider delivery. */
              }
            },
          }),
        ),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      );
    } catch (error) {
      mark('provider_failed');
      throw error;
    }
  };
}

/** Optional hook for OpenClaw's guarded native adapter, which uses its own Undici fetch.
 * It observes the already serialized body/response and never changes dispatch or SSRF policy.
 */
export function providerTimingSpan(url, body, { ollamaPort }) {
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    return undefined;
  }
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.port !== String(ollamaPort) ||
    endpoint.pathname !== '/api/chat'
  )
    return undefined;
  const parent = currentResponseTiming();
  const turn = parent ?? { traceId: randomUUID(), source: 'provider', started: performance.now() };
  const requestId = randomUUID();
  const mark = (stage, values) =>
    markResponseTiming(stage, values, { turn, source: 'provider', requestId });
  const counts = providerRequestCounts(body);
  mark('provider_request', { ...counts, linked: Number(Boolean(parent)) });
  return {
    failed() {
      mark('provider_failed');
    },
    response(response) {
      mark('provider_headers', { status: response.status });
      if (!response.body) return response;
      const tap = new ProviderTimingTap(mark, { streaming: counts.streaming !== 0 });
      return new Response(
        response.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              try {
                tap.push(chunk);
              } catch {}
              controller.enqueue(chunk);
            },
            flush() {
              try {
                tap.push(undefined, true);
              } catch {}
            },
          }),
        ),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      );
    },
  };
}

/** Gateway preload only: bind the existing request to a validated random trace ID. */
export function installGatewayTimingProbe() {
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    const [request, response] = args;
    const traceId = request?.headers?.['x-capri-trace-id'];
    if (
      event !== 'request' ||
      request.method !== 'POST' ||
      request.url !== '/v1/chat/completions' ||
      !timingId(traceId)
    )
      return Reflect.apply(emit, this, [event, ...args]);
    return withResponseTiming(
      traceId,
      () => {
        const turn = currentResponseTiming();
        const write = response.write;
        let first = false,
          pending = '';
        response.write = function (chunk, ...rest) {
          if (!first) {
            pending +=
              typeof chunk === 'string'
                ? chunk
                : Buffer.isBuffer(chunk)
                  ? chunk.toString('utf8')
                  : '';
            if (pending.length > 65536) pending = '';
            let newline;
            while ((newline = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, newline);
              pending = pending.slice(newline + 1);
              if (!line.startsWith('data:')) continue;
              try {
                if (JSON.parse(line.slice(5)).choices?.[0]?.delta?.content) {
                  first = true;
                  pending = '';
                  markResponseTiming('gateway_first_delta', {}, { turn });
                  break;
                }
              } catch {
                /* SSE may contain [DONE]. */
              }
            }
          }
          return Reflect.apply(write, this, [chunk, ...rest]);
        };
        response.once('finish', () =>
          markResponseTiming('gateway_finished', { status: response.statusCode }, { turn }),
        );
        return Reflect.apply(emit, this, [event, ...args]);
      },
      'gateway',
    );
  };
  return () => {
    http.Server.prototype.emit = emit;
  };
}
