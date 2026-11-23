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

function capriWorkspaceLocations(pkg, packages) {
  if (!Array.isArray(pkg.workspaces) || !Array.isArray(packages['']?.workspaces)) return [];
  const locked = new Set(packages[''].workspaces);
  return pkg.workspaces.filter((location) => {
    if (typeof location !== 'string' || !locked.has(location)) return false;
    const match = /^(apps|packages)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(location);
    if (!match) return false;
    const name = match[1] === 'apps' ? `capri-${match[2]}` : `@capri/${match[2]}`;
    const workspace = packages[location];
    const alias = packages['node_modules/' + name];
    return (
      workspace?.name === name &&
      !workspace.link &&
      !Object.hasOwn(workspace, 'integrity') &&
      !Object.hasOwn(workspace, 'resolved') &&
      alias?.link === true &&
      alias.resolved === location &&
      !Object.hasOwn(alias, 'integrity')
    );
  });
}

/** Normalize release versions only for verified local Capri workspaces. */
export function npmDependencySignature(pkg, lock) {
  pkg = structuredClone(pkg);
  lock = structuredClone(lock);
  delete pkg.version;
  delete lock.version;
  const packages = lock.packages ?? {};
  for (const location of ['', ...capriWorkspaceLocations(pkg, packages)]) {
    if (packages[location]) delete packages[location].version;
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
