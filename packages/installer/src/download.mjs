// SPDX-License-Identifier: GPL-3.0-only
import {
  createReadStream,
  createWriteStream,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { noLinks } from './policy.mjs';
import {
  resumableArtifact,
  partialFile,
  httpFailure,
  canRetry,
  requestArtifact,
} from './resumable-download.mjs';

const hosts = new Set([
  'nodejs.org',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'npmmirror.com',
  'cdn.npmmirror.com',
]);
export function artifactUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !hosts.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error('Unapproved dependency download URL');
  return url;
}
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function artifactSources(spec) {
  if (
    !/^[a-f0-9]{64}$/.test(spec.sha256) ||
    !Number.isSafeInteger(spec.bytes) ||
    spec.bytes <= 0 ||
    (spec.mirrors !== undefined && (!Array.isArray(spec.mirrors) || spec.mirrors.length > 3))
  )
    throw new Error('Invalid pinned download manifest');
  const sources = [spec.url, ...(spec.mirrors ?? [])].map((source) => {
    if (typeof source !== 'string') throw new Error('Invalid dependency download source');
    return artifactUrl(source);
  });
  if (new Set(sources.map((source) => source.href)).size !== sources.length)
    throw new Error('Duplicate dependency download source');
  return sources;
}
export async function fetchArtifact(
  spec,
  folder,
  {
    signal,
    progress = () => {},
    fetchImpl = fetch,
    pauseFile,
    onSource = () => {},
    headersTimeoutMs = 30000,
  } = {},
) {
  signal?.throwIfAborted();
  if (!Number.isInteger(headersTimeoutMs) || headersTimeoutMs < 1 || headersTimeoutMs > 30000)
    throw new Error('Invalid dependency header timeout');
  const sources = artifactSources(spec);
  if (pauseFile)
    return resumableArtifact(
      spec,
      folder,
      { signal, progress, fetchImpl, pauseFile, onSource, headersTimeoutMs },
      { artifactUrl, fileHash, sources },
    );
  noLinks(folder);
  mkdirSync(folder, { recursive: true });
  const final = path.join(folder, spec.sha256 + '.zip');
  noLinks(final);
  for (const [index, source] of sources.entries()) {
    const partial = partialFile(final, source, index);
    noLinks(partial);
    if (existsSync(partial)) unlinkSync(partial);
  }
  if (
    existsSync(final) &&
    statSync(final).size === spec.bytes &&
    (await fileHash(final)) === spec.sha256
  )
    return final;
  if (existsSync(final)) unlinkSync(final);
  for (const [index, source] of sources.entries()) {
    const partial = partialFile(final, source, index);
    let url = source,
      response;
    onSource({ index, host: source.hostname });
    try {
      for (let redirect = 0; redirect < 6; redirect++) {
        response = await requestArtifact(url, { signal, fetchImpl, headersTimeoutMs });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Download redirect has no location');
        url = artifactUrl(new URL(location, url).href);
      }
      if (response?.status !== 200) {
        await response?.body?.cancel().catch(() => {});
        throw httpFailure(response?.status);
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== spec.bytes)) {
        await response.body?.cancel();
        throw new Error('Dependency size differs from the pinned manifest');
      }
      const hash = createHash('sha256'),
        started = Date.now();
      let received = 0,
        previous = 0;
      const meter = new Transform({
        transform(chunk, encoding, done) {
          received += chunk.length;
          if (received > spec.bytes) {
            done(new Error('Dependency exceeds pinned size'));
            return;
          }
          hash.update(chunk);
          const now = Date.now();
          if (now - previous >= 250 || received === spec.bytes) {
            const rate = received / Math.max((now - started) / 1000, 0.1);
            progress({
              received,
              total: spec.bytes,
              bytesPerSecond: rate,
              secondsRemaining: (spec.bytes - received) / rate,
            });
            previous = now;
          }
          done(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(partial, { flags: 'wx' }),
        { signal },
      );
      if (received !== spec.bytes)
        throw Object.assign(new Error('Dependency download was incomplete'), { retryable: true });
      if (hash.digest('hex') !== spec.sha256)
        throw new Error('Dependency checksum verification failed');
      renameSync(partial, final);
      return final;
    } catch (error) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      signal?.throwIfAborted();
      if (!canRetry(error) || index === sources.length - 1) throw error;
    } finally {
      if (existsSync(partial)) unlinkSync(partial);
    }
  }
}
