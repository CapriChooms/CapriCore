// SPDX-License-Identifier: GPL-3.0-only
// An allowlist, not a token-regex filter: ordinary prose, tool arguments and
// unknown JSON fields may themselves be private, even when they contain no key.
import { existsSync, lstatSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { diagnosticModelId } from './technical-model-id.mjs';
export { diagnosticModelId } from './technical-model-id.mjs';
import { assertPrivatePath, writePrivateBytesAtomic } from './safe-file.mjs';
import { responseTimingRecord } from './response-timing-schema.mjs';
const ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EIO',
  'EBUSY',
  'EPIPE',
  'EINVAL',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ERR_DLOPEN_FAILED',
  'CAPRI_VOICE_GPU_UNSUPPORTED',
  'CAPRI_VOICE_PYTHON_VERSION',
  'CAPRI_VOICE_REFERENCE_MISSING',
  'CAPRI_VOICE_DEPENDENCIES',
  'CAPRI_VOICE_CUDA_DOWNLOAD',
  'CAPRI_VOICE_RUNTIME_VERIFICATION',
  'CAPRI_VOICE_MODEL_DOWNLOAD',
  'CAPRI_VOICE_MODEL_VERIFICATION',
  'CAPRI_VOICE_INSTALL_FAILED',
  'CAPRI_ROUTER_NATIVE_LIBRARY_UNAVAILABLE',
  'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING',
  'CAPRI_MODEL_WARMUP_FAILED',
  'CUDA_OUT_OF_MEMORY',
  'CUDA_ARCH_UNSUPPORTED',
  'NATIVE_LIBRARY_LOAD_FAILED',
  'TLS_HANDSHAKE_EOF',
]);
const STAGES = new Set([
  'checking',
  'dependencies',
  'cuda-prepare',
  'cuda-connect',
  'cuda-download',
  'cuda-retry',
  'verify',
  'preparing',
  'downloading',
  'installing',
  'verifying',
  'starting',
  'ready',
  'stopping',
  'stopped',
  'cancelled',
  'error',
  'interrupted',
  'complete',
  'voice-runtime',
  'voice-dependencies',
  'voice-models',
  'recognition',
  'request-router',
  'models',
  'runtime',
  'python',
  'node',
  'extracting',
]);
const EVENTS = new Set([
  'started',
  'exited',
  'spawn-failed',
  'stage',
  'progress',
  'failure',
  'activity',
]);

export function privateLogRecord(input, { service, stream, stage } = {}) {
  const source = typeof input === 'string' ? input.slice(-16384) : '';
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    /* Unknown text is never copied. */
  }
  const timing = responseTimingRecord(parsed);
  if (timing) return timing;
  const record = { schemaVersion: 1 };
  if (
    typeof parsed?.time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed.time)
  )
    record.time = parsed.time;
  if (/^[a-z0-9-]{1,64}$/i.test(service ?? '')) record.service = service;
  if (['stdout', 'stderr'].includes(stream)) record.stream = stream;
  const selectedStage = stage ?? parsed?.stage;
  if (STAGES.has(selectedStage)) record.stage = selectedStage;
  record.event = EVENTS.has(parsed?.event)
    ? parsed.event
    : /error|exception|failed|failure|traceback|could not|cannot|out of memory|timeout/i.test(
          source,
        )
      ? 'failure'
      : record.stage
        ? 'stage'
        : 'activity';
  // Only the desktop host's dedicated event can add model metadata. Unknown
  // prose and model-looking fields in other log records remain excluded.
  const modelService = service ?? (parsed?.schemaVersion === 1 ? parsed.service : undefined);
  if (parsed?.event === 'model-selected' && modelService === 'desktop') {
    const modelId = diagnosticModelId(parsed.modelId);
    if (modelId) {
      record.event = 'model-selected';
      record.service = 'desktop';
      record.modelId = modelId;
    }
  }
  const codes = source.match(/\b[A-Z][A-Z0-9_]{2,63}\b/g) ?? [];
  const code = codes.find((value) => ERROR_CODES.has(value));
  if (code) record.code = code;
  if (/CUDA.*out of memory|out of memory.*CUDA/i.test(source)) record.code = 'CUDA_OUT_OF_MEMORY';
  if (/no kernel image|not compatible with the current PyTorch/i.test(source))
    record.code = 'CUDA_ARCH_UNSUPPORTED';
  if (/DLL load failed|VCRUNTIME|WinError 126/i.test(source))
    record.code = 'NATIVE_LIBRARY_LOAD_FAILED';
  if (/tls handshake eof/i.test(source)) record.code = 'TLS_HANDSHAKE_EOF';
  const exception =
    /\b(TypeError|ReferenceError|SyntaxError|RangeError|ImportError|ModuleNotFoundError|RuntimeError|ValueError|OSError|MemoryError|TimeoutError)\b/.exec(
      source,
    )?.[1];
  if (exception) record.exception = exception;
  const httpStatus = /\b(?:HTTP(?:\/\d(?:\.\d)?)?\s*|status(?:Code)?[\s"':=]+)([45]\d{2})\b/i.exec(
    source,
  )?.[1];
  if (httpStatus) record.httpStatus = Number(httpStatus);
  if (
    Number.isInteger(parsed?.exitCode) &&
    parsed.exitCode >= -2147483648 &&
    parsed.exitCode <= 4294967295
  )
    record.exitCode = parsed.exitCode;
  for (const field of ['elapsedMs', 'received', 'total'])
    if (
      Number.isSafeInteger(parsed?.[field]) &&
      parsed[field] >= 0 &&
      parsed[field] <= Number.MAX_SAFE_INTEGER
    )
      record[field] = parsed[field];
  return record;
}

/** Persist only the latest selected ID; never capture general child stdout. */
export function writeModelSelectionLog(directory, value) {
  const modelId = diagnosticModelId(value);
  if (!modelId) return false;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return false;
  const record = privateLogRecord(
    JSON.stringify({ schemaVersion: 1, event: 'model-selected', modelId }),
    { service: 'desktop' },
  );
  record.time = new Date().toISOString();
  try {
    writePrivateBytesAtomic(
      path.join(directory, 'desktop-model.jsonl'),
      Buffer.from(JSON.stringify(record) + '\n'),
    );
    return true;
  } catch {
    // Missing diagnostic storage must not prevent the companion from starting.
    return false;
  }
}

/** Diagnostics retain useful error classes/stages, never legacy free text. */
export function privateLog(input) {
  const records = [];
  let omitted = 0;
  for (const line of String(input ?? '')
    .slice(-256 * 1024)
    .split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = privateLogRecord(line);
    if (record.event === 'activity' && !record.code && !record.exception && !record.stage)
      omitted++;
    else records.push(record);
  }
  if (omitted) records.push({ schemaVersion: 1, event: 'private-lines-omitted', count: omitted });
  // Preserve the latest failure, not the oldest 500 events in the log tail.
  return records
    .slice(-500)
    .map((value) => JSON.stringify(value))
    .join('\n');
}

/** One-time/startup cleanup of owned legacy runtime logs, never user documents. */
export function sanitizeLegacyLogs(directory) {
  const result = { sanitized: 0, skipped: 0 };
  assertPrivatePath(directory);
  if (!existsSync(directory)) return result;
  if (!lstatSync(directory).isDirectory()) throw new Error('Private log storage is unavailable.');
  for (const name of readdirSync(directory).slice(0, 256)) {
    if (!/\.(?:log|jsonl|txt)$/i.test(name)) continue;
    const file = path.join(directory, name);
    let handle;
    try {
      assertPrivatePath(file);
      const info = lstatSync(file);
      if (!info.isFile() || info.nlink !== 1) {
        result.skipped++;
        continue;
      }
      // Retain bounded useful failure evidence; raw old prefixes must not remain.
      const length = Math.min(256 * 1024, info.size),
        bytes = Buffer.alloc(length);
      handle = openSync(file, 'r');
      const read = readSync(handle, bytes, 0, length, Math.max(0, info.size - length));
      closeSync(handle);
      handle = undefined;
      const sanitized = Buffer.from(privateLog(bytes.subarray(0, read).toString('utf8')) + '\n');
      writePrivateBytesAtomic(file, sanitized);
      result.sanitized++;
    } catch {
      result.skipped++;
    } finally {
      if (handle !== undefined) closeSync(handle);
    }
  }
  return result;
}
