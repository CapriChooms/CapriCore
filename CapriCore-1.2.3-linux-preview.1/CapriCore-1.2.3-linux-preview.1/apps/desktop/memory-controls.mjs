// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  lstatSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { runCli } from '../../packages/runtime/src/client.mjs';
import { settings } from '../../packages/runtime/src/config/settings.mjs';

/** Called with the Gateway stopped. Do not delete its database: it also owns sessions. */
export async function clearSavedMemory(rt, cli = runCli) {
  const workspace = realpathSync(rt.workspace);
  const files = [];
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name),
        info = lstatSync(file);
      if (info.isSymbolicLink()) continue;
      const resolved = realpathSync(file);
      if (!resolved.startsWith(workspace + path.sep))
        throw new Error('Memory path escapes the workspace.');
      if (info.isDirectory()) visit(file);
      else if (info.isFile() && /\.md$/i.test(entry.name)) files.push(file);
    }
  };
  const folder = path.join(workspace, 'memory');
  if (existsSync(folder)) {
    if (lstatSync(folder).isSymbolicLink())
      throw new Error('Linked memory folders cannot be cleared.');
    visit(folder);
  }
  for (const name of ['USER.md', 'MEMORY.md']) {
    const file = path.join(workspace, name);
    if (existsSync(file) && lstatSync(file).isSymbolicLink())
      throw new Error('Linked memory files cannot be cleared.');
  }
  // The supported maintenance command clears the derived index and cache only.
  await cli(['memory', 'reset', '--agent', settings.agentId, '--yes'], rt);
  for (const file of files) unlinkSync(file);
  for (const name of ['USER.md', 'MEMORY.md'])
    writeFileSync(path.join(workspace, name), '', 'utf8');
}
