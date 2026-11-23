import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Explicit, version/hash-pinned fixes; never overwrite an unknown dependency. */
export function applyOpenClawCompatibility(workspace) {
  const manifest = JSON.parse(
    readFileSync(path.join(workspace, 'integrations/openclaw-compat/patches.json'), 'utf8'),
  );
  const packageRoot = path.join(workspace, 'node_modules/openclaw');
  const installed = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (installed.version !== manifest.version)
    throw new Error('OpenClaw compatibility fixes need review for this installed version');
  const pending = [];
  for (const patch of manifest.patches) {
    const file = path.resolve(packageRoot, patch.file);
    if (!file.startsWith(packageRoot + path.sep)) throw new Error('Invalid OpenClaw patch path');
    const source = readFileSync(file, 'utf8'),
      hash = digest(source);
    if (hash === patch.afterSha256) continue;
    const upgrade = patch.upgrades?.find((item) => item.beforeSha256 === hash);
    if (hash !== patch.beforeSha256 && !upgrade)
      throw new Error(`OpenClaw file differs from the reviewed version: ${patch.file}`);
    let updated = source;
    for (const edit of upgrade?.edits ??
      patch.edits ?? [{ before: patch.before, after: patch.after }]) {
      if (updated.split(edit.before).length !== 2)
        throw new Error(`OpenClaw patch anchor is not unique: ${patch.file}`);
      updated = updated.replace(edit.before, edit.after);
    }
    if (digest(updated) !== patch.afterSha256)
      throw new Error('OpenClaw compatibility patch checksum mismatch');
    pending.push({ file, updated });
  }
  // Verify every file before mutating any, including on a partially applied install.
  for (const { file, updated } of pending) writeFileSync(file, updated);
  return pending.length > 0;
}
