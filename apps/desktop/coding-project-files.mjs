// SPDX-License-Identifier: GPL-3.0-only
import { lstat, opendir, readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import { assertPrivatePath } from '../../packages/runtime/src/safe-file.mjs';

const privateName =
  /^(?:\.git|\.svn|node_modules|\.venv|venv|\.ssh|\.aws|\.azure|\.docker|\.gnupg|\.kube|\.capri|\.env(?:\..*)?|\.envrc|\.npmrc|\.pypirc|\.netrc|\.htpasswd|credentials(?:\..*)?|secrets?(?:\..*)?|passwords?(?:\..*)?|passwd|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|pfx|p12|key))$/i;
const generatedName =
  /^(?:__pycache__|\.cache|\.next|\.nuxt|\.svelte-kit|\.turbo|\.pytest_cache|\.mypy_cache|\.ruff_cache|coverage|dist|target)$/i;
const temporaryEdit = /\.capri-[a-f0-9-]{36}\.tmp$/i;
const maxEntries = 12000;
const maxDepth = 24;
const watchBatch = 128;
const watchHistory = 30;

export const projectRelative = (value) => value.replaceAll('\\', '/');

export function privateProjectPart(part) {
  return (
    part === '..' ||
    privateName.test(part) ||
    /[:\x00-\x1f]/.test(part) ||
    (process.platform === 'win32' &&
      part !== '.' &&
      (/[ .]$|[<>"|?*]/.test(part) ||
        /^(?:aux|con|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))
  );
}

const skipped = (name, directory) =>
  privateProjectPart(name) || temporaryEdit.test(name) || (directory && generatedName.test(name));

// Match each .gitignore relative to its own directory, with the deepest applicable rule last.
class ProjectIgnore {
  constructor(resolve) {
    this.resolve = resolve;
    this.cache = new Map();
  }

  async rules(directory) {
    if (!this.cache.has(directory)) this.cache.set(directory, this.load(directory));
    return this.cache.get(directory);
  }

  async load(directory) {
    try {
      const pathname = this.resolve(path.posix.join(directory, '.gitignore'));
      const info = await lstat(pathname);
      if (info.isFile() && info.nlink === 1 && info.size <= 64 * 1024) {
        const text = await readFile(pathname, 'utf8');
        return { prefix: directory ? directory + '/' : '', matcher: ignore().add(text) };
      }
    } catch {
      // Missing or unreadable ignore rules do not grant access to otherwise private paths.
    }
    return null;
  }

  ignores(relative, directory, rules) {
    let ignored = false;
    for (const { prefix, matcher } of rules) {
      const result = matcher.test(relative.slice(prefix.length) + (directory ? '/' : ''));
      if (result.ignored || result.unignored) ignored = result.ignored;
    }
    return ignored;
  }

  async ancestors(relative, directory) {
    const entries = relative ? relative.split('/') : [];
    const rules = [];
    let prefix = '';
    for (const [index, name] of entries.entries()) {
      const isDirectory = directory || index < entries.length - 1;
      if (skipped(name, isDirectory)) return null;
      const current = await this.rules(prefix);
      if (current) rules.push(current);
      prefix = path.posix.join(prefix, name);
      if (this.ignores(prefix, isDirectory, rules)) return null;
    }
    return rules;
  }
}

/** Bounded breadth-first scan. Yield on filesystem I/O instead of blocking the desktop process. */
export async function scanProjectFiles({ workspace, root, resolve, signal, maxFiles, visit }) {
  const relative = projectRelative(path.relative(workspace, root));
  const isDirectory = (await lstat(root)).isDirectory();
  const ignores = new ProjectIgnore(resolve);
  const rules = await ignores.ancestors(relative, isDirectory);
  if (!rules) return { scanned: 0, limited: false };
  if (!isDirectory) {
    signal?.throwIfAborted();
    await visit(relative, root);
    return { scanned: 1, limited: false };
  }
  const directories = [{ relative, depth: 0, rules }];
  const deadline = performance.now() + 5000;
  let scanned = 0;
  let entries = 0;
  let limited = false;
  for (const directory of directories) {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) return { scanned, limited: true };
    let folder;
    try {
      folder = await opendir(resolve(directory.relative));
    } catch {
      continue;
    }
    const localRules = await ignores.rules(directory.relative);
    const applicable = localRules ? [...directory.rules, localRules] : directory.rules;
    for await (const row of folder) {
      signal?.throwIfAborted();
      if (++entries > maxEntries || performance.now() >= deadline)
        return { scanned, limited: true };
      if (row.isSymbolicLink() || skipped(row.name, row.isDirectory())) continue;
      const item = path.posix.join(directory.relative, row.name);
      if (ignores.ignores(item, row.isDirectory(), applicable)) continue;
      if (row.isDirectory()) {
        if (directory.depth < maxDepth)
          directories.push({ relative: item, depth: directory.depth + 1, rules: applicable });
        else limited = true;
      } else if (row.isFile()) {
        scanned++;
        if ((await visit(item)) || scanned >= maxFiles) return { scanned, limited: true };
      }
    }
  }
  return { scanned, limited };
}

/** Watch saved files without retaining their contents, even during bursts of editor writes. */
export class CodingProjectMonitor {
  constructor({ resolve, onChange }) {
    this.resolve = resolve;
    this.onChange = onChange;
    this.pending = new Set();
    this.recent = new Map();
    this.revision = 0;
  }

  snapshot() {
    return {
      watching: Boolean(this.watcher),
      revision: this.revision,
      changes: [...this.recent.values()].reverse().map((entry) => ({ ...entry })),
    };
  }

  start(workspace) {
    if (workspace && workspace === this.workspace && this.watcher) return;
    const previous = this.watcher;
    this.watcher = null;
    previous?.close();
    this.workspace = workspace;
    clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.recent.clear();
    if (!workspace) return;
    try {
      const watcher = watch(workspace, { recursive: true, persistent: false }, (_event, name) => {
        if (this.watcher !== watcher || typeof name !== 'string' || name.length > 2048) return;
        const relative = projectRelative(name);
        const parts = relative.split('/');
        if (parts.some((part, index) => skipped(part, index < parts.length - 1))) return;
        if (this.pending.size < watchBatch) this.pending.add(relative);
        if (!this.timer && !this.flushing) this.schedule(watcher);
      });
      this.watcher = watcher;
      watcher.on('error', () => {
        if (this.watcher !== watcher) return;
        this.start('');
        this.onChange(this.snapshot());
      });
    } catch {
      // The selected project stays usable when the file system cannot be watched.
    }
  }

  schedule(watcher) {
    this.timer = setTimeout(() => void this.flush(watcher), 120);
    this.timer.unref();
  }

  async flush(watcher) {
    this.timer = null;
    this.flushing = true;
    const matching = new ProjectIgnore((relative) => this.resolve(relative));
    const candidates = [...this.pending];
    this.pending.clear();
    let changed = false;
    try {
      for (const relative of candidates) {
        if (this.watcher !== watcher) return;
        try {
          const file = this.resolve(relative, { existing: false });
          const stat = await lstat(file).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (stat && (!stat.isFile() || stat.nlink !== 1)) continue;
          if (!(await matching.ancestors(relative, !stat))) continue;
          if (this.watcher !== watcher) return;
          this.recent.delete(relative);
          this.recent.set(relative, {
            path: relative,
            kind: stat ? 'changed' : 'removed',
            at: Date.now(),
          });
          if (this.recent.size > watchHistory) this.recent.delete(this.recent.keys().next().value);
          changed = true;
        } catch {
          // Files may disappear, move out of scope or become links before a watcher event settles.
        }
      }
      if (changed && this.watcher === watcher) {
        this.revision++;
        this.onChange(this.snapshot());
      }
    } finally {
      this.flushing = false;
      if (this.watcher && this.pending.size && !this.timer) this.schedule(this.watcher);
    }
  }
}
