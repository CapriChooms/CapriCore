// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readNpuSettings, validateNpuModel } from './npu-settings.mjs';
import { readModelDevices } from '../model-device-settings.mjs';

const failure = (code) => Object.assign(new Error(npuErrorMessage(code)), { code });
export function npuErrorMessage(code) {
  return (
    {
      CAPRI_NPU_RUNTIME_MISSING:
        'The native NPU runtime is missing. Prepare OpenVINO or select a vendor Python environment.',
      CAPRI_NPU_NOT_FOUND: 'No compatible NPU was found. Check the NPU driver and runtime.',
      CAPRI_NPU_MODEL_INVALID:
        'Choose a converted OpenVINO/ONNX GenAI model containing only local model data.',
      CAPRI_NPU_PROVIDER_MISMATCH:
        'This model does not use the selected NPU provider. CPU/GPU fallback is disabled.',
      CAPRI_NPU_CONTEXT_LIMIT:
        'The request exceeds this NPU model context. Reduce conversation context or reply length.',
      CAPRI_NPU_TIMEOUT:
        'The NPU operation timed out. Check the model, driver and runtime, then retry.',
      CAPRI_NPU_INPUT_INVALID:
        'This NPU model accepts text only. Use a compatible vision model for images.',
    }[code] ??
    'The native NPU could not complete this operation. Check the converted model and vendor runtime.'
  );
}

export function npuPython(root, config) {
  if (config.python) return config.python;
  if (config.backend !== 'openvino') return '';
  const prepared = path.join(root, '.runtime/npu-openvino/Scripts/python.exe');
  if (existsSync(prepared)) return prepared;
  // An explicitly prepared private runtime is required; never use the Windows Store alias.
  return '';
}

export class NpuWorker {
  constructor({ root, python, backend, spawnImpl = spawn }) {
    Object.assign(this, { root, python, backend, spawnImpl });
    this.sequence = 0;
  }
  async start() {
    if (this.child) return;
    if (!this.python || !existsSync(this.python)) throw failure('CAPRI_NPU_RUNTIME_MISSING');
    const env = {};
    for (const name of [
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'LOCALAPPDATA',
      'APPDATA',
      'ProgramFiles',
      'ProgramData',
      'PATH',
    ])
      if (process.env[name]) env[name] = process.env[name];
    if (this.backend === 'vitis') {
      const scripts = path.dirname(this.python);
      const install = path.dirname(scripts);
      if (
        path.basename(scripts).toLowerCase() === 'scripts' &&
        /^ryzen-ai-\d/i.test(path.basename(install))
      ) {
        env.RYZEN_AI_INSTALLATION_PATH = install;
        env.PATH = [scripts, env.PATH ?? ''].join(path.delimiter);
      } else if (process.env.RYZEN_AI_INSTALLATION_PATH) {
        env.RYZEN_AI_INSTALLATION_PATH = process.env.RYZEN_AI_INSTALLATION_PATH;
      }
    }
    Object.assign(env, { PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' });
    const child = this.spawnImpl(
      this.python,
      ['-I', '-u', path.join(this.root, 'integrations/npu/worker.py')],
      {
        cwd: this.root,
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    this.child = child;
    let buffer = '';
    child.stdin.on('error', () => this.stop());
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return this.stop();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const packet = JSON.parse(raw),
            pending = this.pending;
          if (!pending || packet.id !== pending.id) continue;
          if (
            packet.type === 'delta' &&
            typeof packet.text === 'string' &&
            packet.text.length <= 65536
          )
            pending.delta?.(packet.text);
          else if (packet.type === 'result') {
            this.pending = null;
            packet.ok
              ? pending.resolve(packet.data)
              : pending.reject(
                  failure(
                    /^CAPRI_NPU_[A-Z_]+$/.test(packet.code)
                      ? packet.code
                      : 'CAPRI_NPU_EXECUTION_FAILED',
                  ),
                );
          }
        } catch {
          this.stop();
        }
      }
    });
    child.once('error', () => this.stop());
    child.once('exit', () => {
      if (this.child === child) this.stop();
    });
  }
  async request(op, value = {}, { signal, delta, timeoutMs = 120000 } = {}) {
    signal?.throwIfAborted();
    if (this.pending) throw failure('CAPRI_NPU_BUSY');
    await this.start();
    signal?.throwIfAborted();
    if (this.pending) throw failure('CAPRI_NPU_BUSY');
    const id = ++this.sequence;
    let timer, cancel;
    try {
      return await new Promise((resolve, reject) => {
        this.pending = { id, resolve, reject, delta };
        cancel = () => {
          this.stop(signal.reason);
        };
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => this.stop(failure('CAPRI_NPU_TIMEOUT')), timeoutMs);
        this.child.stdin.write(JSON.stringify({ ...value, id, op }) + '\n');
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  stop(reason = failure('CAPRI_NPU_EXECUTION_FAILED')) {
    const child = this.child,
      pending = this.pending;
    this.child = this.pending = null;
    pending?.reject(reason);
    child?.kill(); // Only this owned child; a hung native compile cannot trap Escape/shutdown.
    this.onStop?.();
  }
}

/** Internal fetch-shaped facade over private stdin/stdout. No HTTP server, API key or cloud. */
export class NpuInference {
  constructor({ root, config = readNpuSettings(root), Worker = NpuWorker }) {
    Object.assign(this, { root, config, Worker });
    this.model = 'native-npu-' + config.backend;
    this.deviceId =
      `npu-${config.backend}:0:` +
      createHash('sha256')
        .update(config.backend + '\0' + config.modelPath)
        .digest('hex')
        .slice(0, 16);
    this.fetch = this.fetch.bind(this);
  }
  get active() {
    return readModelDevices(this.root).language === this.deviceId;
  }
  worker() {
    if (!this.client) {
      this.client = new this.Worker({
        root: this.root,
        python: npuPython(this.root, this.config),
        backend: this.config.backend,
      });
      this.client.onStop = () => {
        this.loaded = null;
      };
    }
    return this.client;
  }
  async probe() {
    return this.worker().request('probe', { backend: this.config.backend }, { timeoutMs: 30000 });
  }
  async test({ signal } = {}) {
    await this.ready({ signal });
    let characters = 0;
    await this.worker().request(
      'generate',
      { messages: [{ role: 'user', content: 'Reply with the word Ready.' }], maxTokens: 32 },
      {
        signal,
        timeoutMs: 90000,
        delta: (text) => {
          characters += text.length;
        },
      },
    );
    if (!characters) throw failure('CAPRI_NPU_EXECUTION_FAILED');
    return { ready: true, outputCharacters: characters };
  }
  async ready({ signal } = {}) {
    if (this.loaded) return this.loaded;
    validateNpuModel(this.config);
    this.loaded = this.worker().request(
      'load',
      {
        ...this.config,
        cachePath: path.join(this.root, '.runtime/npu-cache', this.config.backend),
      },
      { signal, timeoutMs: 300000 },
    );
    try {
      return await this.loaded;
    } catch (error) {
      this.loaded = null;
      throw error;
    }
  }
  stop() {
    this.client?.stop();
    this.client = this.loaded = null;
  }
  async fetch(url, options = {}) {
    const signal = options.signal;
    signal?.throwIfAborted();
    await this.ready({ signal });
    const body = JSON.parse(options.body ?? '{}');
    let messages = body.messages ?? [{ role: 'user', content: body.prompt ?? '' }];
    if (messages.some((row) => typeof row.content !== 'string' || row.images?.length))
      throw failure('CAPRI_NPU_INPUT_INVALID');
    if (body.format && typeof body.format === 'object')
      messages = [
        {
          role: 'system',
          content: 'Return only JSON matching this schema: ' + JSON.stringify(body.format),
        },
        ...messages,
      ];
    const maximum = Math.min(4096, body.max_tokens ?? body.options?.num_predict ?? 512);
    const openai = String(url).includes('/v1/');
    const encode = new TextEncoder();
    const packet = (content, done = false) =>
      openai
        ? `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: done ? 'stop' : null }] })}\n\n` +
          (done ? 'data: [DONE]\n\n' : '')
        : JSON.stringify({ message: { role: 'assistant', content }, done }) + '\n';
    if (body.stream !== false) {
      const cancellation = new AbortController();
      const combined = signal
        ? AbortSignal.any([signal, cancellation.signal])
        : cancellation.signal;
      const stream = new ReadableStream({
        start: (controller) => {
          this.worker()
            .request(
              'generate',
              { messages, maxTokens: maximum },
              {
                signal: combined,
                delta: (text) => controller.enqueue(encode.encode(packet(text))),
              },
            )
            .then(() => {
              controller.enqueue(encode.encode(packet('', true)));
              controller.close();
            })
            .catch((error) => {
              this.loaded = null;
              controller.error(error);
            });
        },
        cancel: () => cancellation.abort(),
      });
      return new Response(stream, {
        headers: { 'content-type': openai ? 'text/event-stream' : 'application/x-ndjson' },
      });
    }
    let content = '';
    await this.worker().request(
      'generate',
      { messages, maxTokens: maximum },
      {
        signal,
        delta: (text) => {
          content += text;
        },
      },
    );
    return Response.json(
      openai
        ? { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }
        : { message: { role: 'assistant', content }, done: true },
    );
  }
}
