// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
const pending = new Map();
/** Lazy source-addressed native helpers; no compiler, process or polling on normal startup. */
export function prepareNativeHelper(root, name, references = []) {
  const key = root + '\0' + name;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    if (!/^[a-z][a-z-]+$/.test(name)) throw new Error('Invalid native helper name.');
    const source = path.join(root, 'apps/desktop/native', name + '.cs');
    const hash = createHash('sha256')
      .update(await readFile(source))
      .digest('hex')
      .slice(0, 16);
    const folder = path.join(root, '.runtime/native-helpers', name, hash);
    await mkdir(folder, { recursive: true });
    const target = path.join(folder, 'Capri.' + name + '.exe');
    if (existsSync(target)) return target;
    const temporary = target + '.' + randomBytes(8).toString('hex') + '.exe';
    const framework = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319',
    );
    try {
      await promisify(execFile)(
        path.join(framework, 'csc.exe'),
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/out:' + temporary,
          '/r:System.Web.Extensions.dll',
          ...references.map(
            (value) => '/r:' + (value.startsWith('WPF/') ? path.join(framework, value) : value),
          ),
          source,
        ],
        { windowsHide: true, timeout: 20000, env: { ...process.env, TEMP: folder, TMP: folder } },
      );
      await rename(temporary, target);
      return target;
    } finally {
      await rm(temporary, { force: true });
    }
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
