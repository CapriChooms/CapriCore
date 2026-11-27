// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { readFileSync } from 'node:fs';
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

function platformMatches(values, current) {
  if (!Array.isArray(values)) return true;
  return (
    !values.includes('!' + current) &&
    (values.includes(current) || values.every((value) => value.startsWith('!')))
  );
}

function lockedArchives(root) {
  if (!root) return new Set();
  const { packages } = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return new Set(
    Object.values(packages ?? {})
      .filter(
        (entry) =>
          /^https?:\/\/\S+\.tgz$/u.test(entry.resolved ?? '') &&
          platformMatches(entry.os, process.platform) &&
          platformMatches(entry.cpu, process.arch),
      )
      .map((entry) => entry.resolved),
  );
}

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
  onPackages = () => {},
  recover = recoverNpmTarball,
  reuseInstalled = false,
}) {
  const npm = path.join(path.dirname(nodeExecutable), 'node_modules/npm/bin/npm-cli.js');
  if (reuseInstalled) {
    try {
      await command(nodeExecutable, [npm, 'ls', '--all', '--offline', '--parseable'], {
        output: () => {},
        timeoutMs: 90000,
      });
      // Reapply the same reviewed patches that npm ci applies in postinstall.
      await command(nodeExecutable, [path.join(root, 'packages/runtime/bin/patch-openclaw.mjs')]);
      return;
    } catch {
      signal?.throwIfAborted();
      // A partial dependency tree still goes through the full locked install.
    }
  }
  const attempts = 3;
  const archives = lockedArchives(root);
  const seen = new Set();
  let reported = 0,
    lastReport = -Infinity;
  const publish = (force = false) => {
    const now = Date.now();
    if (seen.size === reported || (!force && now - lastReport < 300)) return;
    reported = seen.size;
    lastReport = now;
    onPackages({ processed: reported, total: archives.size });
  };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    let lifecycleStarted = false;
    try {
      await command(
        nodeExecutable,
        [
          npm,
          'ci',
          '--include=dev',
          '--no-audit',
          '--no-fund',
          '--prefer-offline',
          '--loglevel=info',
          '--fetch-timeout=90000',
          '--fetch-retries=1',
          '--fetch-retry-factor=2',
          '--fetch-retry-mintimeout=2000',
          '--fetch-retry-maxtimeout=15000',
          ...(attempt > 1 ? ['--maxsockets=4'] : []),
        ],
        {
          idleTimeoutMs: 3 * 60 * 1000,
          onOutput(message) {
            if (/^npm info run\s/u.test(message)) lifecycleStarted = true;
            const fetch = /^npm http fetch GET 2\d\d (\S+) \d+ms(?:\s|$)/u.exec(message);
            const cache = /^npm http cache (\S+) \d+ms(?:\s|$)/u.exec(message);
            const url = (fetch ?? cache)?.[1].replace(/^.*@(?=https?:\/\/)/u, '');
            if (!url || !archives.has(url)) return false;
            seen.add(url);
            publish();
            // npm keeps the full HTTP transcript in its debug file.
            return true;
          },
        },
      );
      publish(true);
      return;
    } catch (error) {
      signal?.throwIfAborted();
      publish(true);
      const idle = error.code === 'CAPRI_INSTALL_IDLE';
      if (idle && lifecycleStarted)
        throw Object.assign(
          new Error(
            'npm stopped reporting progress after starting a package setup script. See the npm log for the last package and retry setup.',
            { cause: error },
          ),
          { code: 'NPM_LIFECYCLE_STALLED' },
        );
      const code = idle ? 'ETIMEDOUT' : npmNetworkFailure(error);
      if (!code) throw error;
      if (attempt === attempts) {
        const failure = new Error(
          idle
            ? `npm stopped reporting package progress after ${attempts} attempts. Downloaded packages remain cached. Check the connection and retry setup.`
            : `The connection to the npm package registry was interrupted (${code}). Dependency installation failed after ${attempts} attempts. Downloaded packages remain cached. Retry setup when the connection is available.`,
          { cause: error },
        );
        failure.code = 'NPM_NETWORK_UNAVAILABLE';
        failure.npmCode = code;
        throw failure;
      }
      const delayMs = 2000 * 2 ** (attempt - 1);
      onRetry({ attempt: attempt + 1, attempts, delayMs, code });
      if (root && !idle) {
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
