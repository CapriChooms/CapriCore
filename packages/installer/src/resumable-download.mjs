// SPDX-License-Identifier: GPL-3.0-only
import {
  createReadStream,
  createWriteStream,
  existsSync,
  statSync,
  unlinkSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { noLinks } from './policy.mjs';
import { waitWhilePaused } from './pause.mjs';
const transientHttp = new Set([408, 429, 500, 502, 503, 504]);
const transientNetwork = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
export function partialFile(final, source, index) {
  // Keep legacy primary partials; mirrors never append to another origin's bytes.
  return index === 0
    ? final + '.part'
    : final +
        '.source-' +
        createHash('sha256').update(source.href).digest('hex').slice(0, 24) +
        '.part';
}
export function httpFailure(status) {
  return Object.assign(new Error('Dependency download failed: HTTP ' + status), {
    httpStatus: status,
    retryable: transientHttp.has(status),
  });
}
export function canRetry(error) {
  if (error?.retryable !== undefined) return error.retryable === true;
  const pending = [error],
    seen = new Set();
  let transient = false;
  while (pending.length && seen.size < 12) {
    const cause = pending.shift();
    if (!cause || seen.has(cause)) continue;
    seen.add(cause);
    // A certificate failure must never be disguised by another nested network error.
    if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/.test(String(cause.code ?? '')))
      return false;
    if (transientNetwork.has(cause.code) || cause.name === 'TimeoutError') transient = true;
    pending.push(cause.cause, ...(Array.isArray(cause.errors) ? cause.errors : []));
  }
  return transient;
}
export async function requestArtifact(url, { signal, fetchImpl, headers, headersTimeoutMs }) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Dependency headers timed out', 'TimeoutError')),
    headersTimeoutMs,
  );
  timer.unref?.();
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      credentials: 'omit',
      headers: { 'accept-encoding': 'identity', ...headers },
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        controller.signal,
        AbortSignal.timeout(2 * 60 * 60 * 1000),
      ]),
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    // The short deadline is only for connection/headers, never the large body.
    clearTimeout(timer);
  }
}
class Paused extends Error {}
export async function resumableArtifact(
  spec,
  folder,
  {
    signal,
    pauseFile,
    progress = () => {},
    fetchImpl,
    onSource = () => {},
    headersTimeoutMs = 30000,
  },
  { artifactUrl, fileHash, sources = [artifactUrl(spec.url)] },
) {
  if (!/^[a-f0-9]{64}$/.test(spec.sha256) || !Number.isSafeInteger(spec.bytes) || spec.bytes <= 0)
    throw new Error('Invalid pinned download manifest');
  if (!Number.isInteger(headersTimeoutMs) || headersTimeoutMs < 1 || headersTimeoutMs > 30000)
    throw new Error('Invalid dependency header timeout');
  noLinks(folder);
  mkdirSync(folder, { recursive: true });
  const final = path.join(folder, spec.sha256 + '.zip');
  const partials = sources.map((source, index) => partialFile(final, source, index));
  noLinks(final);
  for (const partial of partials) noLinks(partial);
  if (
    existsSync(final) &&
    statSync(final).size === spec.bytes &&
    (await fileHash(final)) === spec.sha256
  )
    return final;
  if (existsSync(final)) unlinkSync(final);
  for (const partial of partials) {
    if (
      existsSync(partial) &&
      statSync(partial).size === spec.bytes &&
      (await fileHash(partial)) === spec.sha256
    ) {
      renameSync(partial, final);
      return final;
    }
    if (existsSync(partial) && statSync(partial).size >= spec.bytes) unlinkSync(partial);
  }
  let attempts = 0,
    sourceIndex = 0;
  while (attempts < 6) {
    await waitWhilePaused(pauseFile, { signal });
    signal?.throwIfAborted();
    const source = sources[sourceIndex],
      partial = partials[sourceIndex];
    // Recheck before every write, including after a pause or source rotation.
    noLinks(partial);
    let response;
    try {
      onSource({ index: sourceIndex, host: source.hostname });
      let offset = existsSync(partial) ? statSync(partial).size : 0,
        url = source;
      for (let redirects = 0; redirects < 6; redirects++) {
        response = await requestArtifact(url, {
          signal,
          fetchImpl,
          headersTimeoutMs,
          headers: offset ? { Range: `bytes=${offset}-` } : {},
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Download redirect has no location');
        url = artifactUrl(new URL(location, url).href);
      }
      if (![200, 206].includes(response.status)) throw httpFailure(response.status);
      if (
        response.status === 206 &&
        response.headers.get('content-range') !== `bytes ${offset}-${spec.bytes - 1}/${spec.bytes}`
      )
        throw new Error('Invalid dependency byte range');
      if (response.status === 200) offset = 0;
      const declared = response.headers.get('content-length');
      if (
        declared !== null &&
        (!/^\d+$/.test(declared) || Number(declared) !== spec.bytes - offset)
      )
        throw new Error('Dependency size differs from the pinned manifest');
      const hash = createHash('sha256');
      if (offset)
        for await (const chunk of createReadStream(partial)) {
          signal?.throwIfAborted();
          hash.update(chunk);
        }
      let received = offset,
        previous = 0;
      const started = Date.now();
      const meter = new Transform({
        transform(chunk, encoding, done) {
          if (pauseFile && existsSync(pauseFile)) return done(new Paused());
          received += chunk.length;
          if (received > spec.bytes) return done(new Error('Dependency exceeds pinned size'));
          hash.update(chunk);
          if (Date.now() - previous >= 250 || received === spec.bytes) {
            const rate = (received - offset) / Math.max((Date.now() - started) / 1000, 0.1);
            progress({
              received,
              total: spec.bytes,
              bytesPerSecond: rate,
              secondsRemaining: (spec.bytes - received) / Math.max(rate, 1),
            });
            previous = Date.now();
          }
          done(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(partial, { flags: offset ? 'a' : 'w' }),
        { signal },
      );
      if (received !== spec.bytes)
        throw Object.assign(new Error('Dependency download was incomplete'), { retryable: true });
      if (hash.digest('hex') !== spec.sha256) {
        unlinkSync(partial);
        throw new Error('Dependency checksum verification failed');
      }
      renameSync(partial, final);
      return final;
    } catch (error) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      signal?.throwIfAborted();
      if (error instanceof Paused) continue;
      attempts++;
      if (attempts >= 6 || !canRetry(error)) throw error;
      sourceIndex = (sourceIndex + 1) % sources.length;
      // Try the next independent source immediately; only back off after a full round.
      if (sourceIndex === 0)
        await delay(Math.min(1000 * 2 ** attempts, 15000), undefined, { signal });
    }
  }
}
