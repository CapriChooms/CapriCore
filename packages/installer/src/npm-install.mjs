// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { recoverNpmTarball } from './npm-tarball.mjs';

const transient = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ERR_SOCKET_TIMEOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE',
  'E408',
  'E429',
  'E500',
  'E502',
  'E503',
  'E504',
]);

/** Only npm's explicit failure code counts; cleanup warnings are not the cause. */
export function npmNetworkFailure(error) {
  if (
    error?.name === 'AbortError' ||
    (error?.exitCode !== undefined && ![1, -4077, 4294963219].includes(error.exitCode))
  )
    return null;
  const text = String(error?.outputTail ?? error?.message ?? '');
  const codes = [...text.matchAll(/\bnpm\s+(?:error|ERR!)\s+code\s+([A-Z0-9_]+)/gi)].map((match) =>
    match[1].toUpperCase(),
  );
  return codes.length && codes.every((code) => transient.has(code)) ? codes.at(-1) : null;
}

/** Reinstall the same locked dependency set, never upgrade it or weaken TLS. */
export async function installNpmDependencies({
  nodeExecutable,
  command,
  signal,
  onRetry = () => {},
  sleep = (ms) => delay(ms, undefined, { signal }),
  root,
  pauseFile,
  progress,
  onRecovery = () => {},
  recover = recoverNpmTarball,
}) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    try {
      await command(nodeExecutable, [
        path.join(path.dirname(nodeExecutable), 'node_modules/npm/bin/npm-cli.js'),
        'ci',
        '--include=dev',
        '--no-audit',
        '--no-fund',
        '--prefer-offline',
        '--fetch-retries=3',
        '--fetch-retry-factor=2',
        '--fetch-retry-mintimeout=2000',
        '--fetch-retry-maxtimeout=15000',
        ...(attempt > 1 ? ['--maxsockets=4'] : []),
      ]);
      return;
    } catch (error) {
      signal?.throwIfAborted();
      const code = npmNetworkFailure(error);
      if (!code) throw error;
      if (attempt === attempts) {
        const failure = new Error(
          `The connection to the npm package registry was interrupted (${code}). Dependency installation failed after ${attempts} attempts. Downloaded packages remain cached. Retry setup when the connection is available.`,
          { cause: error },
        );
        failure.code = 'NPM_NETWORK_UNAVAILABLE';
        failure.npmCode = code;
        throw failure;
      }
      const delayMs = 2000 * 2 ** (attempt - 1);
      onRetry({ attempt: attempt + 1, attempts, delayMs, code });
      if (root) {
        try {
          onRecovery(
            'Recovering the interrupted package with resumable, integrity-checked download…',
          );
          await recover({
            root,
            error,
            nodeExecutable,
            command,
            signal,
            pauseFile,
            progress,
            onLog: onRecovery,
          });
        } catch (recoveryError) {
          signal?.throwIfAborted();
          if (
            recoveryError.retryable === false ||
            ['EACCES', 'EPERM', 'ENOSPC'].includes(recoveryError.code)
          )
            throw recoveryError;
          const causes = [
            recoveryError,
            recoveryError.cause,
            ...(recoveryError.cause?.errors ?? []),
          ];
          const details = [
            ...new Set(
              causes
                .filter(Boolean)
                .map((item) => [item.code, item.message].filter(Boolean).join(': ')),
            ),
          ]
            .join('; ')
            .slice(0, 700);
          onRecovery(
            `Package recovery could not finish (${details}). Cached bytes are preserved; retrying npm.`,
          );
        }
      }
      await sleep(delayMs);
    }
  }
}
