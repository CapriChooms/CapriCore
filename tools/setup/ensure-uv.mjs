// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureUv } from '../../packages/installer/src/uv-runtime.mjs';
import { mkdirSync } from 'node:fs';
import { installationLock } from '../../packages/installer/src/lock.mjs';
import { noLinks } from '../../packages/installer/src/policy.mjs';

try {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    Number(process.versions.node.split('.')[0]) !== 24
  )
    throw Error(
      'Capri runtime repair requires Windows and Node 24. Run Capri Setup to repair this folder.',
    );
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !path.isAbsolute(args[1])))
    throw Error('Invalid runtime preparation arguments.');
  const root = args.length
    ? args[1]
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const env = Object.fromEntries(
    ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const cache = path.join(root, '.runtime/installer');
  noLinks(cache);
  mkdirSync(cache, { recursive: true });
  const release = installationLock(cache);
  try {
    await ensureUv({
      root,
      env,
      emit: ({ runtimePhase, elapsedMs }) =>
        console.log(`Preparing the verified Capri runtime… [${runtimePhase} ${elapsedMs}ms]`),
    });
  } finally {
    release();
  }
} catch {
  console.error(
    'Could not prepare the pinned uv runtime. Check the network and retry, or run Capri Setup to repair this folder.',
  );
  process.exitCode = 1;
}
