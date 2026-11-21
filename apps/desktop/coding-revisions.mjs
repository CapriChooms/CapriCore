// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { diffLines } from 'diff';

const fileLimit = 512 * 1024;
const batchLimit = 2 * 1024 * 1024;
const recentLimit = 4 * 1024 * 1024;
const reviewTimeout = 120000;
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const sizeOf = ({ files }) =>
  files.reduce((total, file) => total + bytes(file.before) + bytes(file.after), 0);

function compare(before, after) {
  const parts = diffLines(before, after, { timeout: 35, maxEditLength: 2000 });
  if (parts) return { parts, approximate: false };
  return {
    parts: [
      { removed: true, value: before, count: lines(before).length },
      { added: true, value: after, count: lines(after).length },
    ],
    approximate: true,
  };
}

function lines(text) {
  if (!text) return [];
  const rows = text.split(/\r?\n/);
  if (rows.at(-1) === '') rows.pop();
  return rows;
}

function updatedFile(file, result) {
  const after = result?.text ?? file.after;
  const { parts } = compare(file.before, after);
  return {
    ...file,
    after,
    hash: result?.hash ?? file.hash,
    additions: parts.reduce((count, part) => count + (part.added ? part.count : 0), 0),
    deletions: parts.reduce((count, part) => count + (part.removed ? part.count : 0), 0),
  };
}

async function prepare(service, edits, signal) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 8)
    throw Error('Choose between one and eight files for a coding change.');
  const workspace = service.config.workspace;
  const paths = new Set();
  const files = [];
  let total = 0;
  for (const edit of edits) {
    signal?.throwIfAborted();
    const { kind, path: relative, text, hash } = edit ?? {};
    if (
      !['create', 'edit'].includes(kind) ||
      typeof relative !== 'string' ||
      !relative.trim() ||
      typeof text !== 'string' ||
      text.includes('\0') ||
      bytes(text) > fileLimit
    )
      throw Error('Invalid coding change.');
    const create = kind === 'create';
    const target = service.resolve(relative, { existing: !create });
    const key = target.toLowerCase();
    if (paths.has(key)) throw Error('A file can only be changed once per batch.');
    paths.add(key);
    if (service.config.workspace !== workspace) throw Error('The coding project changed.');
    let before = '';
    if (create) {
      if (existsSync(target))
        throw Error('This file already exists. Read it and use edit instead of create.');
      let parent = path.dirname(target);
      for (; !existsSync(parent); parent = path.dirname(parent)) {
        // A missing ancestor must still resolve within the project grant.
        service.resolve(path.relative(workspace, parent), { existing: false });
      }
      if (!lstatSync(parent).isDirectory()) throw Error('Choose a project directory.');
    } else {
      const current = await service.execute({ action: 'read', path: relative }, signal);
      if (current.dirty)
        throw Error('Save your unsaved editor changes before asking Capri to edit this file.');
      if (!hash || hash !== current.hash)
        throw Error('The file changed. Read it again before editing.');
      before = current.text;
      if (before === text) continue;
    }
    total += bytes(before) + bytes(text);
    if (total > batchLimit)
      throw Error('This coding batch is too large. Split it into smaller changes.');
    files.push(updatedFile({ path: relative, kind, before, after: text, hash }));
  }
  signal?.throwIfAborted();
  if (service.config.workspace !== workspace) throw Error('The coding project changed.');
  return files;
}

async function commit(service, prepared, workspace, signal) {
  const files = [];
  for (const file of prepared) {
    try {
      signal?.throwIfAborted();
      if (service.config.workspace !== workspace) throw Error('The coding project changed.');
      if (file.kind === 'create') {
        const target = service.resolve(file.path, { existing: false });
        const parent = path.dirname(target);
        mkdirSync(parent, { recursive: true });
        if (!lstatSync(service.resolve(path.relative(workspace, parent))).isDirectory())
          throw Error('Choose a project directory.');
      }
      const result = await service.execute(
        {
          action: file.kind,
          path: file.path,
          text: file.after,
          ...(file.kind === 'edit' ? { hash: file.hash } : {}),
        },
        signal,
      );
      files.push(updatedFile(file, result));
    } catch (error) {
      if (!files.length) throw error;
      return { files, error: error.message };
    }
  }
  return { files };
}

export async function applyCodingEdits(service, edits, signal) {
  const workspace = service.config.workspace;
  return commit(service, await prepare(service, edits, signal), workspace, signal);
}

function metadata({ id, summary, at, state, files }) {
  return {
    id,
    summary,
    at,
    state,
    files: files.map(({ path, kind, additions, deletions }) => ({
      path,
      kind,
      additions,
      deletions,
    })),
  };
}

function preview(file) {
  const { parts, approximate } = compare(file.before, file.after);
  const result = [];
  let oldLine = 1,
    newLine = 1,
    truncated = approximate;
  for (const part of parts) {
    const rows = lines(part.value);
    const type = part.added ? 'added' : part.removed ? 'removed' : 'context';
    for (let index = 0; index < rows.length; index++) {
      if (type === 'context' && index >= 3 && index < rows.length - 3) {
        if (index === 3) result.push({ type: 'gap', text: '…' });
      } else if (result.length < 240) {
        const text = rows[index];
        if (text.length > 2400) truncated = true;
        result.push({
          type,
          text: text.length > 2400 ? `${text.slice(0, 2400)}…` : text,
          ...(type !== 'added' ? { oldLine } : {}),
          ...(type !== 'removed' ? { newLine } : {}),
        });
      } else truncated = true;
      if (type !== 'added') oldLine++;
      if (type !== 'removed') newLine++;
    }
  }
  return { path: file.path, lines: result.slice(0, 240), truncated };
}

export class CodingRevisions {
  constructor(service, { changed = () => {}, review = () => {} } = {}) {
    Object.assign(this, { service, changed, review });
    this.recent = [];
    this.pending = null;
  }

  snapshot() {
    return {
      pending: this.pending ? metadata(this.pending) : null,
      recent: this.recent.map(metadata),
    };
  }

  reset() {
    this.pending?.resolve(false);
    this.pending = null;
    this.recent = [];
    this.changed(this.snapshot());
  }

  diff(id, relative) {
    const batch = [this.pending, ...this.recent].find((item) => item?.id === id);
    const file = batch?.files.find(({ path }) => path === relative);
    if (!file) throw Error('This coding change is no longer available.');
    return preview(file);
  }

  decide(id, apply) {
    if (!this.pending || this.pending.id !== id || typeof apply !== 'boolean')
      throw Error('This coding change is no longer awaiting review.');
    const batch = this.pending;
    this.pending = null;
    batch.resolve(apply);
    this.changed(this.snapshot());
    return this.snapshot();
  }

  async apply(edits, { summary = '', signal } = {}) {
    const workspace = this.service.config.workspace;
    let files = await prepare(this.service, edits, signal);
    if (!files.length) return { files };
    const batch = {
      id: randomUUID(),
      summary: String(summary).slice(0, 1200),
      at: Date.now(),
      files,
    };
    if (this.service.config.reviewWrites) {
      if (this.pending) throw Error('Review the current coding changes first.');
      const decision = Promise.withResolvers();
      const abort = () => decision.resolve(false);
      const timer = setTimeout(abort, reviewTimeout);
      timer.unref?.();
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { ...batch, state: 'pending', resolve: decision.resolve };
      try {
        this.changed(this.snapshot());
        this.review();
        if (signal?.aborted) abort();
        if (!(await decision.promise)) {
          signal?.throwIfAborted();
          throw Object.assign(Error('The coding changes were not approved.'), {
            code: 'CAPRI_CODING_REVIEW_DECLINED',
          });
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (this.pending?.id === batch.id) {
          this.pending = null;
          this.changed(this.snapshot());
        }
      }
      if (this.service.config.workspace !== workspace) throw Error('The coding project changed.');
      files = await prepare(this.service, edits, signal);
    }
    const result = await commit(this.service, files, workspace, signal);
    if (result.files.length) {
      this.recent.unshift({
        ...batch,
        files: result.files,
        state: result.error ? 'partial' : 'applied',
      });
      let total = 0;
      this.recent = this.recent
        .slice(0, 16)
        .filter((item) => (total += sizeOf(item)) <= recentLimit);
      this.changed(this.snapshot());
    }
    return result;
  }
}
