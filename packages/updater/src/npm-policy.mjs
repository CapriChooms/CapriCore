// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { readJson } from '../../installer/src/policy.mjs';

const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value;

/** Ignore only Capri/workspace version labels, never a third-party version or integrity hash. */
export function npmDependencySignature(pkg, lock) {
  pkg = structuredClone(pkg);
  lock = structuredClone(lock);
  delete pkg.version;
  delete lock.version;
  for (const name of ['', 'apps/desktop', 'packages/runtime']) {
    if (lock.packages && Object.hasOwn(lock.packages, name)) delete lock.packages[name].version;
  }
  return JSON.stringify(sorted({ pkg, lock }));
}

export function npmInstallRequired(root, source) {
  const signature = (directory) =>
    npmDependencySignature(
      readJson(path.join(directory, 'package.json')),
      readJson(path.join(directory, 'package-lock.json'), 4 * 1024 ** 2),
    );
  return signature(root) !== signature(source);
}
