// SPDX-License-Identifier: GPL-3.0-only
import {
  createReadStream,
  createWriteStream,
  existsSync,
  statSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { noLinks } from './policy.mjs';
import { waitWhilePaused } from './pause.mjs';

const LIMIT = 512 * 1024 ** 2;
export function npmTarballUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'registry.npmjs.org' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('.tgz')
  )
    throw new Error('Unapproved npm tarball URL');
  return url;
}
async function matches(file, expected) {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > LIMIT) return false;
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('base64') === expected;
}

/** Restore large interrupted npm transfers by content integrity, not by changing a registry. */
export async function downloadNpmTarball(
  spec,
  folder,
  {
    signal,
    pauseFile,
    fetchImpl = fetch,
    progress = () => {},
    onRetry = () => {},
    sleep = (ms) => delay(ms, undefined, { signal }),
  } = {},
) {
  const url = npmTarballUrl(spec.resolved);
  const expected = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(spec.integrity)?.[1];
  if (!expected || Buffer.from(expected, 'base64').length !== 64)
    throw new Error('A pinned SHA-512 npm integrity is required');
  noLinks(folder);
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, Buffer.from(expected, 'base64').toString('hex') + '.tgz');
  const partial = file + '.part';
  noLinks(file);
  noLinks(partial);
  if (await matches(file, expected)) return file;
  if (await matches(partial, expected)) {
    renameSync(partial, file);
    return file;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    signal?.throwIfAborted();
    await waitWhilePaused(pauseFile, { signal });
    noLinks(partial);
    let offset = existsSync(partial) ? statSync(partial).size : 0;
    if (offset > LIMIT) throw new Error('npm partial download exceeds its size limit');
    try {
      const response = await fetchImpl(url, {
        headers: { Range: `bytes=${offset}-`, 'accept-encoding': 'identity' },
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20 * 60 * 1000)])
          : AbortSignal.timeout(20 * 60 * 1000),
      });
      if (response.status === 416) {
        await response.body?.cancel();
        if (existsSync(partial)) unlinkSync(partial);
        throw Object.assign(
          new Error('npm partial download could not be resumed; retry from the beginning'),
          { retryable: true },
        );
      }
      if (![200, 206].includes(response.status)) {
        await response.body?.cancel();
        throw Object.assign(new Error(`npm tarball HTTP ${response.status}`), {
          retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
        });
      }
      let total = Number(response.headers.get('content-length')) || null;
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get('content-range') ?? '',
        );
        if (
          !range ||
          Number(range[1]) !== offset ||
          Number(range[2]) < offset ||
          Number(range[3]) <= Number(range[2])
        ) {
          await response.body?.cancel();
          throw Object.assign(new Error('Invalid npm tarball range'), { retryable: false });
        }
        total = Number(range[3]);
      } else offset = 0;
      if (total && (!Number.isSafeInteger(total) || total > LIMIT)) {
        await response.body?.cancel();
        throw Object.assign(new Error('npm tarball exceeds its size limit'), { retryable: false });
      }
      if (!response.body)
        throw Object.assign(new Error('npm tarball has no body'), { retryable: false });
      let received = offset,
        previous = 0;
      const meter = new Transform({
        transform(chunk, _encoding, done) {
          received += chunk.length;
          if (received > LIMIT || (total && received > total))
            return done(
              Object.assign(new Error('npm tarball exceeds declared size'), { retryable: false }),
            );
          if (Date.now() - previous >= 500) {
            previous = Date.now();
            progress({ received, total, attempt });
          }
          done(null, chunk);
        },
      });
      const input = async function* () {
        const reader = response.body.getReader();
        try {
          while (true) {
            signal?.throwIfAborted();
            if (pauseFile && existsSync(pauseFile)) {
              await reader.cancel();
              throw Object.assign(new Error('npm download paused'), { paused: true });
            }
            let timer;
            const next = await Promise.race([
              reader.read(),
              new Promise((_resolve, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      Object.assign(new Error('npm download stopped responding'), {
                        retryable: true,
                      }),
                    ),
                  60000,
                );
              }),
            ]).finally(() => clearTimeout(timer));
            if (next.done) break;
            yield next.value;
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      };
      await pipeline(
        Readable.from(input()),
        meter,
        createWriteStream(partial, { flags: offset ? 'a' : 'w' }),
        { signal },
      );
      if (total && received !== total)
        throw Object.assign(new Error('npm download ended early'), { retryable: true });
      if (!(await matches(partial, expected))) {
        unlinkSync(partial);
        throw Object.assign(new Error('npm tarball integrity mismatch; installation stopped'), {
          retryable: false,
          code: 'NPM_INTEGRITY_MISMATCH',
        });
      }
      renameSync(partial, file);
      progress({ received, total: received, attempt });
      return file;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.paused) {
        attempt--;
        await waitWhilePaused(pauseFile, { signal });
        continue;
      }
      const networkCode = error.cause?.code ?? error.code;
      const transient =
        error.retryable === true ||
        [
          'ECONNRESET',
          'ETIMEDOUT',
          'EAI_AGAIN',
          'ENOTFOUND',
          'UND_ERR_SOCKET',
          'UND_ERR_CONNECT_TIMEOUT',
        ].includes(networkCode) ||
        error.name === 'TimeoutError';
      if (!transient || error.retryable === false) {
        error.retryable = false;
        throw error;
      }
      if (attempt === 4) throw error;
      onRetry({
        attempt: attempt + 1,
        code: networkCode ?? error.name,
        bytes: existsSync(partial) ? statSync(partial).size : 0,
      });
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error('npm tarball recovery failed');
}

export async function recoverNpmTarball({
  root,
  error,
  nodeExecutable,
  command,
  signal,
  pauseFile,
  progress,
  fetchImpl,
  onLog = () => {},
}) {
  const text = String(error.outputTail ?? error.message);
  const entries = Object.values(
    JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages ?? {},
  );
  const specs = entries.filter(
    (entry) =>
      typeof entry.resolved === 'string' &&
      entry.resolved.startsWith('https://registry.npmjs.org/') &&
      text.includes(entry.resolved) &&
      /^sha512-/.test(entry.integrity ?? ''),
  );
  const unique = [...new Map(specs.map((spec) => [spec.resolved, spec])).values()];
  if (!unique.length) return false;
  for (const spec of unique) {
    const file = await downloadNpmTarball(
      spec,
      path.join(root, '.runtime/installer/npm-artifacts'),
      {
        signal,
        pauseFile,
        progress,
        fetchImpl,
        onRetry: ({ attempt, code, bytes }) =>
          onLog(
            `Package recovery ${attempt}/4: ${code}; ${bytes} partial bytes retained (${new URL(spec.resolved).pathname}).`,
          ),
      },
    );
    signal?.throwIfAborted();
    await command(nodeExecutable, [
      path.join(path.dirname(nodeExecutable), 'node_modules/npm/bin/npm-cli.js'),
      'cache',
      'add',
      file,
      '--cache=' + path.join(root, '.runtime/npm-cache'),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
  }
  return true;
}
