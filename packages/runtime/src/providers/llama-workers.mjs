// SPDX-License-Identifier: GPL-3.0-only
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { noLinks } from '../huggingface/artifacts.mjs';

function allocatePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function modelPaths(root, model) {
  const weights = model.files.filter(({ projector }) => !projector);
  const projector = model.files.find((item) => item.projector)?.file;
  if (weights.length === 1) return { file: weights[0].file, projector, dispose() {} };
  const base = noLinks(path.join(root, '.runtime/llama-model-links'));
  mkdirSync(base, { recursive: true });
  const temporary = mkdtempSync(path.join(base, 'shards-'));
  const files = [];
  const dispose = () => {
    for (const file of files) unlinkSync(file);
    rmdirSync(temporary);
  };
  try {
    weights.sort((left, right) => left.relative.localeCompare(right.relative, 'en'));
    for (const [index, item] of weights.entries()) {
      const part = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(item.relative);
      if (!part || Number(part[1]) !== index + 1 || Number(part[2]) !== weights.length)
        throw new Error('The GGUF shard set is incomplete.');
      const link = path.join(temporary, `model-${part[1]}-of-${part[2]}.gguf`);
      linkSync(item.file, link);
      files.push(link);
    }
    return { file: files[0], projector, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

const bounded = (value, fallback, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const illegalInstruction = 'CAPRI_LLAMA_ILLEGAL_INSTRUCTION';

async function workerFailure(error, worker, signal) {
  signal.throwIfAborted();
  const exitCode = error.exitCode ?? (await worker?.exitCode?.());
  signal.throwIfAborted();
  if (Number.isInteger(exitCode) && exitCode >>> 0 === 0xc000001d)
    return Object.assign(new Error('The local engine stopped on an illegal CPU instruction.'), {
      code: illegalInstruction,
    });
  return error;
}

export class LlamaWorkers {
  constructor({
    root,
    start,
    config,
    device,
    overheadMiB = 768,
    startupTimeoutMs = 160000,
    automaticGpuStartupTimeoutMs = 75000,
    canRetryIllegalInstruction = false,
  }) {
    Object.assign(this, {
      root,
      start,
      config,
      device,
      overheadMiB,
      startupTimeoutMs,
      automaticGpuStartupTimeoutMs,
      canRetryIllegalInstruction,
    });
    this.slots = {
      chat: { queue: Promise.resolve() },
      embedding: { queue: Promise.resolve() },
    };
    this.shutdown = new AbortController();
    this.baselineModes = new Set();
  }
  enqueue(role, fn) {
    const slot = this.slots[role];
    const next = slot.queue.then(() => fn(slot));
    slot.queue = next.catch(() => {});
    return next;
  }
  async stopSlot(slot) {
    clearTimeout(slot.timer);
    if (!slot.worker) return;
    const worker = slot.worker;
    await worker.process.stop();
    slot.worker = undefined;
    worker.dispose();
  }
  async open(model, role, options, signal, allowGpu, baseline = false) {
    const modelFiles = modelPaths(this.root, model);
    const port = await allocatePort().catch((error) => {
      modelFiles.dispose();
      throw error;
    });
    const token = randomBytes(32).toString('hex');
    const url = `http://127.0.0.1:${port}`;
    const args = [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--alias',
      model.name,
      '--model',
      modelFiles.file,
      '--ctx-size',
      String(options.context),
      '--threads',
      String(options.threads),
      '--parallel',
      '1',
      '--no-webui',
      '--no-context-shift',
      '--jinja',
      ...(allowGpu
        ? [
            '--n-gpu-layers',
            'auto',
            '--fit',
            'on',
            '--fit-ctx',
            String(options.context),
            '--fit-target',
            String(this.overheadMiB),
            ...(this.device ? ['--device', this.device] : []),
          ]
        : ['--device', 'none', '--n-gpu-layers', '0', '--fit', 'off']),
      ...(modelFiles.projector ? ['--mmproj', modelFiles.projector] : []),
      ...(model.templateFile ? ['--chat-template-file', model.templateFile] : []),
      ...(role === 'embedding'
        ? ['--embeddings', '--pooling', 'cls']
        : [
            '--flash-attn',
            'on',
            '--cache-type-k',
            'q8_0',
            '--cache-type-v',
            'q8_0',
            '--reasoning-format',
            'deepseek',
          ]),
    ];
    let child;
    try {
      signal.throwIfAborted();
      child = await this.start(role, args, { LLAMA_API_KEY: token }, { allowGpu, baseline });
      // In Automatic mode leave time for a CPU attempt in the caller's normal
      // preparation window if a Vulkan driver stalls instead of exiting.
      const deadline = AbortSignal.timeout(
        allowGpu && !this.device ? this.automaticGpuStartupTimeoutMs : this.startupTimeoutMs,
      );
      const timeout = AbortSignal.any([signal, deadline]);
      while (child.alive() && !timeout.aborted) {
        const response = await fetch(url + '/health', {
          redirect: 'error',
          signal: AbortSignal.any([timeout, AbortSignal.timeout(1500)]),
          headers: { authorization: `Bearer ${token}` },
        }).catch(() => null);
        await response?.body?.cancel();
        if (response?.ok && !timeout.aborted)
          return {
            ...options,
            url,
            token,
            model,
            process: child,
            allowGpu,
            baseline,
            dispose: modelFiles.dispose,
          };
        if (!timeout.aborted)
          await wait(200, undefined, { signal: timeout }).catch((error) => {
            if (!timeout.aborted) throw error;
          });
      }
      signal.throwIfAborted();
      throw Object.assign(new Error('llama.cpp could not load the local GGUF model.'), {
        code: allowGpu ? 'CAPRI_LLAMA_GPU_LOAD_FAILED' : 'CAPRI_LLAMA_CPU_LOAD_FAILED',
      });
    } catch (error) {
      try {
        throw await workerFailure(error, child, signal);
      } finally {
        await child?.stop();
        modelFiles.dispose();
      }
    }
  }
  async openCompatible(model, role, options, signal, allowGpu) {
    const baseline = this.baselineModes.has(allowGpu);
    try {
      return await this.open(model, role, options, signal, allowGpu, baseline);
    } catch (error) {
      if (error.code !== illegalInstruction || baseline || !this.canRetryIllegalInstruction)
        throw error;
      this.baselineModes.add(allowGpu);
      return this.open(model, role, options, signal, allowGpu, true);
    }
  }
  options(supplied, role) {
    const minimum = role === 'embedding' ? 512 : 1024;
    const context =
      role === 'embedding'
        ? 8192
        : bounded(supplied.num_ctx, this.config.contextTokens, minimum, 262144);
    const threads = Math.min(
      bounded(supplied.num_thread, this.config.cpuThreads ?? 4, 1, 64),
      availableParallelism(),
    );
    const cpu =
      role === 'embedding' || this.config.acceleration === 'cpu' || supplied.num_gpu === 0;
    return { context, threads, cpu };
  }
  async use(model, role, input, signal, work, canRetry = () => false) {
    const requestSignal = AbortSignal.any([signal, this.shutdown.signal]);
    return this.enqueue(role, async (slot) => {
      requestSignal.throwIfAborted();
      const options = this.options(input.options ?? {}, role);
      if (!options.cpu && this.device === 'unavailable')
        throw Object.assign(
          new Error('The selected GPU is unavailable. Choose a device in Model devices.'),
          { status: 503, code: 'CAPRI_LLAMA_GPU_UNAVAILABLE' },
        );
      clearTimeout(slot.timer);
      slot.timer = undefined;
      let worker = slot.worker;
      if (
        !worker ||
        !worker.process.alive() ||
        worker.model.name !== model.name ||
        worker.context < options.context ||
        worker.threads !== options.threads ||
        worker.cpu !== options.cpu
      ) {
        await this.stopSlot(slot);
        try {
          worker = await this.openCompatible(model, role, options, requestSignal, !options.cpu);
        } catch (error) {
          requestSignal.throwIfAborted();
          if (options.cpu || this.device) throw error;
          worker = await this.openCompatible(model, role, options, requestSignal, false);
        }
        slot.worker = worker;
      }
      try {
        try {
          return await work(worker, requestSignal);
        } catch (error) {
          const failure = await workerFailure(error, worker.process, requestSignal);
          if (
            failure.code !== illegalInstruction ||
            worker.baseline ||
            !this.canRetryIllegalInstruction
          )
            throw failure;
          this.baselineModes.add(worker.allowGpu);
          const { allowGpu } = worker;
          await this.stopSlot(slot);
          if (!canRetry()) throw failure;
          worker = await this.open(model, role, options, requestSignal, allowGpu, true);
          slot.worker = worker;
          try {
            return await work(worker, requestSignal);
          } catch (retryError) {
            throw await workerFailure(retryError, worker.process, requestSignal);
          }
        }
      } finally {
        const keep = this.keepAlive(input.keep_alive);
        if (keep === 0) await this.stopSlot(slot);
        else if (slot.worker && keep > 0 && !this.shutdown.signal.aborted) {
          const timer = setTimeout(() => {
            void this.enqueue(role, (current) =>
              current.timer === timer && current.worker === worker
                ? this.stopSlot(current)
                : undefined,
            ).catch(() => {});
          }, keep * 1000);
          slot.timer = timer;
          timer.unref();
        }
      }
    });
  }
  keepAlive(value) {
    if (typeof value === 'string') {
      const match = /^(\d{1,5})(s|m|h)$/.exec(value);
      if (match) value = Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
    }
    return bounded(value, this.config.keepAlive, -1, 86400);
  }
  list() {
    return Object.values(this.slots).flatMap(({ worker }) =>
      worker?.process.alive()
        ? [
            {
              name: worker.model.name,
              model: worker.model.name,
              size: worker.model.size,
              context_length: worker.context,
              ...(!worker.allowGpu ? { size_vram: 0 } : {}),
            },
          ]
        : [],
    );
  }
  async unload(model) {
    await Promise.all(
      Object.keys(this.slots).map((role) =>
        this.enqueue(role, (slot) =>
          slot.worker?.model.name === model ? this.stopSlot(slot) : undefined,
        ),
      ),
    );
  }
  async close() {
    this.shutdown.abort();
    await Promise.all(
      Object.keys(this.slots).map((role) => this.enqueue(role, (slot) => this.stopSlot(slot))),
    );
  }
}
