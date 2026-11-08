// SPDX-License-Identifier: GPL-3.0-only
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  statSync,
  statfsSync,
  renameSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { hubResponse, httpError } from './transport.mjs';

export function safeFileName(value) {
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !value ||
    value.includes('\\') ||
    /[\x00-\x1f\x7f:%?#]/.test(value)
  )
    throw new Error('Invalid Hugging Face filename.');
  for (const segment of value.split('/')) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      /[. ]$/.test(segment) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment) ||
      /[<>"|*]/.test(segment)
    )
      throw new Error('Invalid Hugging Face filename.');
  }
  return value;
}

export function noLinks(file) {
  let current = path.resolve(file);
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error('Hugging Face storage cannot follow filesystem links.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(file);
}

export function freeBytes(folder) {
  const space = statfsSync(folder, { bigint: true });
  return Number(space.bavail * space.bsize);
}

export async function fileHash(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function writablePartial(file) {
  noLinks(file);
  if (existsSync(file)) {
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1)
      throw new Error('Hugging Face partial download must be a private regular file.');
  }
}

export function operationLock(folder) {
  noLinks(folder);
  mkdirSync(folder, { recursive: true });
  const file = noLinks(path.join(folder, '.operation.lock'));
  try {
    const fd = openSync(file, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const { pid } = JSON.parse(readFileSync(file, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (probe) {
          stale = probe.code === 'ESRCH';
        }
      }
    } catch {
      /* A partial or unknown lock requires recovery by the owner. */
    }
    if (stale) {
      unlinkSync(file);
      return operationLock(folder);
    }
    throw new Error('Another Hugging Face operation is running. Wait for it to finish.');
  }
  return () => {
    noLinks(file);
    unlinkSync(file);
  };
}

export async function downloadArtifact(spec, folder, options = {}) {
  const { signal, onProgress = () => {}, diskFree = freeBytes, retryDelay = 1000 } = options;
  if (!/^[a-f0-9]{64}$/.test(spec.sha256) || !Number.isSafeInteger(spec.bytes) || spec.bytes <= 0)
    throw new Error('Hugging Face artifact has no verified size and SHA-256.');
  noLinks(folder);
  mkdirSync(folder, { recursive: true });
  const file = noLinks(path.join(folder, spec.sha256)),
    partial = noLinks(file + '.partial');
  writablePartial(partial);
  if (
    existsSync(file) &&
    statSync(file).isFile() &&
    statSync(file).size === spec.bytes &&
    (await fileHash(file, signal)) === spec.sha256
  )
    return file;
  if (existsSync(file)) unlinkSync(file);
  if (existsSync(partial) && statSync(partial).size >= spec.bytes) {
    if (
      statSync(partial).size === spec.bytes &&
      (await fileHash(partial, signal)) === spec.sha256
    ) {
      renameSync(partial, file);
      return file;
    }
    unlinkSync(partial);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    signal?.throwIfAborted();
    let offset = existsSync(partial) ? statSync(partial).size : 0;
    if ((await diskFree(folder)) < spec.bytes - offset + 64 * 1024 ** 2)
      throw new Error('There is not enough free disk space for this Hugging Face model.');
    let response, reader, handle;
    try {
      onProgress({ status: 'connecting', completed: offset, total: spec.bytes, file: spec.path });
      response = await hubResponse(spec.url, {
        ...options,
        timeout: 2 * 60 * 60 * 1000,
        headers: offset ? { range: `bytes=${offset}-` } : {},
      });
      if (![200, 206].includes(response.status)) throw httpError(response.status);
      if (
        response.status === 206 &&
        response.headers.get('content-range') !== `bytes ${offset}-${spec.bytes - 1}/${spec.bytes}`
      )
        throw new Error('Hugging Face returned an invalid byte range.');
      if (response.status === 200) offset = 0;
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== spec.bytes - offset)
        throw new Error('Hugging Face file size differs from the resolved manifest.');
      reader = response.body?.getReader();
      if (!reader) throw new Error('Hugging Face returned an empty file.');
      writablePartial(partial);
      handle = await open(partial, offset ? 'a' : 'w', 0o600);
      let completed = offset,
        previous = 0;
      const started = Date.now();
      while (true) {
        signal?.throwIfAborted();
        let timer;
        const chunk = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Hugging Face download stalled.')), 45000);
          }),
        ]).finally(() => clearTimeout(timer));
        if (chunk.done) break;
        completed += chunk.value.byteLength;
        if (completed > spec.bytes) throw new Error('Hugging Face file exceeds its declared size.');
        let written = 0;
        while (written < chunk.value.byteLength) {
          const result = await handle.write(chunk.value.subarray(written));
          written += result.bytesWritten;
        }
        if (Date.now() - previous >= 250 || completed === spec.bytes) {
          if ((await diskFree(folder)) < 32 * 1024 ** 2)
            throw new Error('Free disk space was exhausted during the model download.');
          onProgress({
            status: 'downloading',
            file: spec.path,
            completed,
            total: spec.bytes,
            bytesPerSecond: (completed - offset) / Math.max(0.1, (Date.now() - started) / 1000),
          });
          previous = Date.now();
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      if (completed !== spec.bytes) throw new Error('Hugging Face download was incomplete.');
      onProgress({ status: 'verifying', file: spec.path, completed, total: spec.bytes });
      if ((await fileHash(partial, signal)) !== spec.sha256) {
        unlinkSync(partial);
        throw new Error('Hugging Face checksum verification failed.');
      }
      noLinks(file);
      renameSync(partial, file);
      return file;
    } catch (error) {
      await reader?.cancel().catch(() => {});
      await handle?.close().catch(() => {});
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      signal?.throwIfAborted();
      if (
        attempt === 3 ||
        /checksum|byte range|manifest|declared size|disk space|denied|authentication|not found|Unapproved/.test(
          error.message,
        )
      ) {
        if (/Hugging Face|disk space/.test(error.message)) throw error;
        throw new Error('Hugging Face download could not be completed. Retry to resume.');
      }
      await delay(retryDelay * 2 ** attempt, undefined, { signal });
    }
  }
}
