// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { open, readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertPrivatePath } from '../../../packages/runtime/src/safe-file.mjs';
import { privateLog } from '../../../packages/runtime/src/privacy-log.mjs';
import { responseTimelines } from './response-timeline.mjs';

const validName = (name) =>
  /^[a-zA-Z0-9_.-]{1,140}$/.test(name) &&
  /\.(?:log|jsonl|txt)(?:\.1)?$/.test(name) &&
  !/history|transcript|memory|prompt|screenshot|recording|token|secret|verification|dataset|audition|chat|dialog|(?:sk-|ghp_|hf_)/i.test(
    name,
  );
const normalized = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
const timingFiles = new Set([
  'response-desktop.jsonl',
  'response-desktop.jsonl.1',
  'response-provider.jsonl',
  'response-provider.jsonl.1',
]);

/** Read a fixed catalog item, with an open-handle identity check and a bounded tail. */
async function tail(file, maximumBytes = 64 * 1024) {
  assertPrivatePath(file);
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    normalized(await realpath(file)) !== normalized(path.resolve(file))
  )
    throw Error('Unavailable log');
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.ino !== before.ino || info.dev !== before.dev)
      throw Error('Unavailable log');
    const bytes = Buffer.alloc(Math.min(info.size, maximumBytes));
    const { bytesRead } = await handle.read(
      bytes,
      0,
      bytes.length,
      Math.max(0, info.size - bytes.length),
    );
    let text = bytes.subarray(0, bytesRead).toString('utf8');
    if (info.size > maximumBytes) text = text.slice(text.indexOf('\n') + 1);
    return { text, sourceBytes: info.size, truncated: info.size > maximumBytes };
  } finally {
    await handle.close();
  }
}

/** On-demand only: no polling, models, network, or disk writes in the main process. */
export class DeveloperDiagnostics {
  constructor({ root, installerDirectory = null, now = Date.now }) {
    this.root = path.resolve(root);
    this.installerDirectory = installerDirectory;
    this.now = now;
    this.items = new Map();
  }
  async folders() {
    const roots = [
      { directory: path.join(this.root, 'logs'), group: 'runtime' },
      { directory: path.join(this.root, '.runtime/updates'), group: 'updates' },
    ];
    if (this.installerDirectory)
      roots.push({ directory: path.join(this.installerDirectory, 'logs'), group: 'installer' });
    const sessions = this.installerDirectory && path.join(this.installerDirectory, 'sessions');
    if (sessions)
      try {
        assertPrivatePath(sessions);
        const candidates = (await readdir(sessions, { withFileTypes: true }))
          .filter((d) => d.isDirectory() && /^[a-f0-9]{32}$/i.test(d.name))
          .slice(0, 256);
        const children = await Promise.all(
          candidates.map(async (child) => ({
            name: child.name,
            modified: (await lstat(path.join(sessions, child.name))).mtimeMs,
          })),
        );
        for (const child of children.sort((a, b) => b.modified - a.modified).slice(0, 3))
          roots.push({ directory: path.join(sessions, child.name), group: 'installer' });
      } catch {
        /* Missing installer history is normal. */
      }
    return roots;
  }
  async catalog() {
    const items = [];
    for (const { directory, group } of await this.folders())
      try {
        assertPrivatePath(directory);
        if (normalized(await realpath(directory)) !== normalized(path.resolve(directory))) continue;
        for (const entry of (await readdir(directory, { withFileTypes: true })).slice(0, 256)) {
          if (!entry.isFile() || !validName(entry.name)) continue;
          const file = path.join(directory, entry.name),
            info = await lstat(file);
          if (!info.isFile() || info.nlink !== 1) continue;
          items.push({
            id: createHash('sha256').update(file).digest('hex').slice(0, 24),
            name: entry.name,
            group,
            bytes: info.size,
            modifiedAt: info.mtime.toISOString(),
            file,
          });
        }
      } catch {
        /* A missing or unavailable directory does not hide other logs. */
      }
    items.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
    const selected = items.slice(0, 80);
    // Keep both generations of timing files even when other logs are newer.
    for (const item of items.filter((x) => x.group === 'runtime' && timingFiles.has(x.name)))
      if (!selected.some((x) => x.id === item.id)) selected.push(item);
    this.items = new Map(selected.map((x) => [x.id, x]));
    return selected;
  }
  snapshot() {
    if (this.pending) return this.pending;
    if (this.cached && this.now() - this.cachedAt < 1000) return Promise.resolve(this.cached);
    this.pending = this.collect()
      .then((value) => {
        this.cached = value;
        this.cachedAt = this.now();
        return value;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async collect() {
    const items = await this.catalog(),
      records = [];
    const timing = items.filter((x) => x.group === 'runtime' && timingFiles.has(x.name));
    const signature = JSON.stringify(timing.map((x) => [x.id, x.bytes, x.modifiedAt]));
    let unavailable = 0;
    if (signature !== this.timingSignature) {
      await Promise.all(
        timing.map(async (item) => {
          try {
            const data = await tail(item.file, 512 * 1024);
            for (const line of data.text.split(/\r?\n/))
              try {
                records.push(JSON.parse(line));
              } catch {}
          } catch {
            unavailable++;
          }
        }),
      );
      this.timelines = responseTimelines(records);
      if (!unavailable) this.timingSignature = signature;
    }
    return {
      capturedAt: new Date(this.now()).toISOString(),
      turns: this.timelines ?? [],
      unavailable,
      logs: items.map(({ file, ...item }) => item),
    };
  }
  async read(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw Error('Invalid log selection.');
    if (!this.items.has(id)) await this.catalog();
    const item = this.items.get(id);
    if (!item) throw Error('This log is no longer available. Refresh the list.');
    try {
      const result = await tail(item.file);
      return {
        id,
        name: item.name,
        text: privateLog(result.text),
        sourceBytes: result.sourceBytes,
        truncated: result.truncated,
      };
    } catch {
      throw Error('This log is no longer available. Refresh the list.');
    }
  }
  async folder() {
    const folder = path.join(this.root, 'logs');
    try {
      assertPrivatePath(folder);
      if (
        !(await lstat(folder)).isDirectory() ||
        normalized(await realpath(folder)) !== normalized(folder)
      )
        throw Error();
      return folder;
    } catch {
      throw Error('The logs folder is not available yet.');
    }
  }
}
