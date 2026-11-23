// SPDX-License-Identifier: GPL-3.0-only
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { summarizeModelResidency } from './diagnostics/resources.mjs';

const unknown = () => ({
  status: 'unknown',
  totalBytes: null,
  gpuBytes: null,
  contextTokens: null,
});
const validModel = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\s\x00-\x1f]/.test(value);
const tagged = (value) =>
  value.slice(value.lastIndexOf('/') + 1).includes(':') ? value : value + ':latest';

function inventoryEndpoint(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return new URL('/api/ps', url).href;
  } catch {
    return null;
  }
}

function readLocalInventory(endpoint, { signal, maxBytes }) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const request = httpRequest(
      url,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        // A numeric direct socket bypasses global fetch dispatchers, agents
        // and proxy environment variables. No redirect or cookie handling.
        createConnection: () =>
          connect({
            host: url.hostname === '[::1]' ? '::1' : url.hostname,
            port: Number(url.port || 80),
            family: url.hostname === '[::1]' ? 6 : 4,
          }),
      },
      (response) => {
        const encoding = response.headers['content-encoding'];
        if (
          response.statusCode !== 200 ||
          (encoding && encoding !== 'identity') ||
          Number(response.headers['content-length']) > maxBytes
        ) {
          response.destroy();
          finish(new Error('Local residency unavailable.'));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            finish(new Error('Local residency unavailable.'));
          } else chunks.push(chunk);
        });
        response.on('aborted', () => finish(new Error('Local residency unavailable.')));
        response.on('error', (error) => finish(error));
        response.on('end', () => {
          try {
            finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            finish(new Error('Local residency unavailable.'));
          }
        });
      },
    );
    const abort = () => {
      request.destroy();
      finish(new Error('Local residency unavailable.'));
    };
    request.on('error', (error) => finish(error));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else request.end();
  });
}

/** Keep only the selected model's reviewed allocation counters, never its name
 * or any untrusted server extras. Embedding residency cannot become LLM usage.
 */
export function selectedModelResidency(value, model) {
  if (!validModel(model)) return unknown();
  const summary = summarizeModelResidency(value, model);
  if (!summary.available) return unknown();
  const selected = value.models.filter((item) =>
    [item?.name, item?.model].some((name) => validModel(name) && tagged(name) === tagged(model)),
  );
  if (selected.length === 0) {
    const complete =
      !summary.truncated &&
      value.models.every((item) => [item?.name, item?.model].some(validModel));
    return complete ? { ...unknown(), status: 'unloaded' } : unknown();
  }
  if (selected.length !== 1) return unknown();
  // A selected row beyond the diagnostic report's eight-row presentation cap
  // is still usable; do not mistake a truncated report for an unloaded model.
  const name = [selected[0].name, selected[0].model].find(
    (name) => validModel(name) && tagged(name) === tagged(model),
  );
  const row = summarizeModelResidency({ models: selected }, name).models[0];
  return {
    status: row.offload,
    totalBytes: row.totalBytes,
    gpuBytes: row.gpuBytes,
    contextTokens: row.contextTokens,
  };
}

/** Read-only local GET, shared by UI consumers. It never starts Ollama, loads
 * models, sends credentials or inference, or contacts the active API provider.
 */
export class LocalModelResidencySampler {
  constructor({
    url,
    read = readLocalInventory,
    now = Date.now,
    timeoutMs = 700,
    refreshMs = 2000,
    failureMs = 10000,
  }) {
    this.endpoint = inventoryEndpoint(url);
    Object.assign(this, { read, now });
    this.timeoutMs = Math.max(1, Math.min(2000, timeoutMs));
    this.refreshMs = Math.max(0, Math.min(60000, refreshMs));
    this.failureMs = Math.max(0, Math.min(60000, failureMs));
    this.generation = 0;
    this.invalidate();
  }

  invalidate() {
    this.generation++;
    this.pending?.controller.abort();
    this.pending = null;
    this.model = null;
    this.value = unknown();
    this.nextAt = 0;
  }

  async sample({ model, remote = false, available = true } = {}) {
    if (remote || !available || !this.endpoint || !validModel(model)) {
      this.invalidate();
      return unknown();
    }
    if (this.model !== model) {
      this.invalidate();
      this.model = model;
    }
    if (!this.pending && this.now() < this.nextAt) return { ...this.value };
    if (!this.pending) {
      const job = {
        generation: this.generation,
        controller: new AbortController(),
      };
      job.promise = this.probe(model, job.controller)
        .then(({ value, failed }) => {
          if (job.generation !== this.generation) return unknown();
          this.value = value;
          this.nextAt = this.now() + (failed ? this.failureMs : this.refreshMs);
          return { ...value };
        })
        .finally(() => {
          if (this.pending === job) this.pending = null;
        });
      this.pending = job;
    }
    return { ...(await this.pending.promise) };
  }

  async probe(model, controller) {
    let timer, abort;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return this.read(this.endpoint, {
            method: 'GET',
            timeout: this.timeoutMs,
            maxBytes: 64 * 1024,
            signal: controller.signal,
          });
        }),
        new Promise((_resolve, reject) => {
          abort = () => reject(new Error('Local residency unavailable.'));
          controller.signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => controller.abort(), this.timeoutMs);
          if (controller.signal.aborted) abort();
        }),
      ]);
      const value = selectedModelResidency(result, model);
      return { value, failed: !summarizeModelResidency(result, model).available };
    } catch {
      return { value: unknown(), failed: true };
    } finally {
      clearTimeout(timer);
      if (abort) controller.signal.removeEventListener('abort', abort);
    }
  }
}
