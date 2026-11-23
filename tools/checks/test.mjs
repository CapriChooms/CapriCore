// SPDX-License-Identifier: GPL-3.0-only
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtempDisposableSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, nodePath } from '../../packages/runtime/src/index.mjs';
// Artwork qualification is deliberately separate from device/model-free unit tests.
const optional = new Set(['desktop-avatar.test.mjs', 'desktop-animation.test.mjs']);
const files = readdirSync(new URL('../../tests/', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs') && !optional.has(name))
  .sort()
  .map((name) => 'tests/' + name);
// These integration fixtures deliberately launch real package managers and
// nested native repair helpers. Run them without competing compiler/process
// fixtures so their strict command deadlines measure recovery, not CI load.
const exclusive = new Set([
  'tests/uv-bootstrap.test.mjs',
  'tests/npm-install.test.mjs',
  'tests/application-bridge-upgrade.test.mjs',
  'tests/installer-recovery.test.mjs',
]);
const batches = [
  [files.filter((file) => !exclusive.has(file)), Math.min(4, availableParallelism())],
  [files.filter((file) => exclusive.has(file)), 1],
];
using scratch = mkdtempDisposableSync(path.join(realpathSync.native(tmpdir()), 'capri-test-run-'));
const env = { ...process.env, TEMP: scratch.path, TMP: scratch.path, TMPDIR: scratch.path };
let status = 0;
for (const [batch, concurrency] of batches) {
  if (!batch.length) continue;
  const result = spawnSync(
    nodePath,
    ['--test', '--test-concurrency=' + concurrency, ...batch, ...process.argv.slice(2)],
    { cwd: root, env, stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  status ||= result.status ?? 1;
}
process.exitCode = status;
