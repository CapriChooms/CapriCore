// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertPrivatePath, writePrivateBytesAtomic } from '../safe-file.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Verified upstream backports, including npm's otherwise immutable bundled deps. */
export function applyDependencySecurityPatches(workspace, { manifest } = {}) {
  const base = path.resolve(workspace);
  manifest ??= JSON.parse(
    readFileSync(path.join(base, 'config/dependency-security-patches.json'), 'utf8'),
  );
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.targets) ||
    manifest.targets.length === 0 ||
    manifest.targets.length > 32
  )
    throw new Error('Invalid dependency security patch manifest.');
  const pending = [];
  const receipts = [];
  const seen = new Set();
  for (const patch of manifest.targets) {
    if (!['minimatch', 'glob'].includes(patch.package) || !Array.isArray(patch.edits))
      throw new Error('Invalid dependency security patch.');
    const file = path.resolve(base, patch.file),
      packageFile = path.resolve(base, patch.packageFile);
    const boundary = path.join(base, 'node_modules') + path.sep;
    const identity = process.platform === 'win32' ? file.toLowerCase() : file;
    if (seen.has(identity)) throw new Error('Duplicate dependency security patch target.');
    seen.add(identity);
    if (
      !file.startsWith(boundary) ||
      !packageFile.startsWith(boundary) ||
      !/^[a-f0-9]{64}$/.test(patch.beforeSha256) ||
      !/^[a-f0-9]{64}$/.test(patch.afterSha256)
    )
      throw new Error('Invalid dependency security patch path.');
    assertPrivatePath(file);
    assertPrivatePath(packageFile);
    const installed = JSON.parse(readFileSync(packageFile, 'utf8'));
    if (installed.name !== patch.package || installed.version !== patch.version)
      throw new Error('Dependency security fixes need review for the installed package version.');
    const source = readFileSync(file, 'utf8'),
      hash = digest(source);
    if (hash !== patch.afterSha256) {
      if (hash !== patch.beforeSha256)
        throw new Error(
          'Dependency differs from its reviewed security patch source: ' + patch.file,
        );
      let updated = source;
      for (const edit of patch.edits) {
        const count = edit.count ?? 1;
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          count > 8 ||
          !edit.before ||
          updated.split(edit.before).length !== count + 1
        )
          throw new Error('Dependency security patch anchor mismatch.');
        updated = updated.split(edit.before).join(edit.after);
      }
      if (digest(updated) !== patch.afterSha256)
        throw new Error('Dependency security patch checksum mismatch.');
      pending.push({ file, updated });
    }
    receipts.push({
      file: patch.file,
      package: patch.package,
      upstreamVersion: installed.version,
      advisories: patch.advisories ?? [patch.advisory],
      sha256: patch.afterSha256,
      status: 'backported',
    });
  }
  // Preflight the whole set before modifying any file. Never relabel a package
  // version or conceal version-based npm audit warnings.
  for (const { file, updated } of pending) writePrivateBytesAtomic(file, Buffer.from(updated));
  return { changed: pending.length, targets: receipts };
}
