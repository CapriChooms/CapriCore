// SPDX-License-Identifier: GPL-3.0-only
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile } from 'node:fs/promises';
import { existsSync, lstatSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { assertPrivatePath } from './safe-file.mjs';
import { responseTimingRecord, timingId } from './response-timing-schema.mjs';

const context = new AsyncLocalStorage();
let writer;
const turns = new Map();

/** Bounded, batched, best-effort diagnostics; disk I/O never gates a response. */
export class ResponseTimingLog {
  constructor(file, { maximumBytes = 512 * 1024 } = {}) {
    this.file = file;
    this.maximumBytes = maximumBytes;
    this.queue = [];
  }
  write(value) {
    const record = responseTimingRecord(value);
    if (!record || this.queue.length >= 128) return;
    this.queue.push(JSON.stringify(record) + '\n');
    if (!this.timer && !this.pending)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 25).unref();
  }
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      await this.pending;
      if (this.queue.length) return this.flush();
      return;
    }
    if (!this.queue.length) return;
    const bytes = this.queue.splice(0).join('');
    this.pending = (async () => {
      try {
        assertPrivatePath(this.file);
        mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        if (existsSync(this.file)) {
          const info = lstatSync(this.file);
          if (!info.isFile() || info.nlink !== 1) return;
          if (info.size + Buffer.byteLength(bytes) > this.maximumBytes) {
            const previous = this.file + '.1';
            assertPrivatePath(previous);
            if (existsSync(previous)) {
              const old = lstatSync(previous);
              if (!old.isFile() || old.nlink !== 1) return;
              unlinkSync(previous);
            }
            renameSync(this.file, previous);
          }
        }
        await appendFile(this.file, bytes, { mode: 0o600 });
      } catch {
        /* Optional diagnostics must never affect inference or expose a path. */
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
    if (this.queue.length) return this.flush();
  }
}

export function configureResponseTimings(log) {
  writer = log;
}
export function withResponseTiming(traceId, fn, source = 'desktop') {
  if (!timingId(traceId)) return fn();
  const existing = context.getStore();
  if (existing?.traceId === traceId) return fn();
  const turn = { traceId, source, started: performance.now(), stages: new Set() };
  turns.set(traceId, turn);
  if (turns.size > 128) turns.delete(turns.keys().next().value);
  return context.run(turn, () => {
    markResponseTiming(source === 'gateway' ? 'gateway_received' : 'received');
    return fn();
  });
}
export function currentResponseTiming() {
  return context.getStore();
}
export function markResponseTiming(
  stage,
  counters = {},
  { turn = context.getStore(), source = turn?.source, requestId } = {},
) {
  if (!turn || !writer) return;
  const value = responseTimingRecord({
    ...counters,
    schemaVersion: 1,
    event: 'response-timing',
    traceId: turn.traceId,
    source,
    stage,
    requestId,
    time: new Date().toISOString(),
    elapsedMs: performance.now() - turn.started,
  });
  if (value) writer.write(value);
}
export function acknowledgeResponsePaint(traceId, rendererElapsedMs) {
  const turn = turns.get(traceId);
  if (
    !turn ||
    turn.stages.has('first_paint') ||
    !Number.isFinite(rendererElapsedMs) ||
    rendererElapsedMs < 0 ||
    rendererElapsedMs > 600000
  )
    return false;
  turn.stages.add('first_paint');
  markResponseTiming('first_paint', { rendererElapsedMs }, { turn, source: 'renderer' });
  return true;
}
