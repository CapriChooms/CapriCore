// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { noLinks, readJson } from '../../packages/installer/src/policy.mjs';
import { writeJsonAtomic } from '../../packages/runtime/src/atomic-json.mjs';
import {
  compareVersions,
  parseVersion,
  releaseVersion,
} from '../../packages/updater/src/releases.mjs';

const limit = 12000;

function version(tag) {
  try {
    const { version, pre } = parseVersion(tag);
    return 'v' + version + (pre.length ? '-' + pre.join('.') : '');
  } catch {
    return null;
  }
}

function notes(body) {
  return typeof body === 'string' ? body.slice(0, limit).trim() : '';
}

/** A version is recorded after presentation. A failed start can retry next launch. */
export class PatchNotes {
  constructor({ root, state, current, previous }) {
    this.file = path.join(state, 'patch-notes.json');
    this.root = root;
    this.current = version(current);
    this.previous = version(previous);
    try {
      noLinks(this.file);
      const record = readJson(this.file, 96 * 1024);
      if (record.schemaVersion === 1) {
        this.seen = version(record.seen);
        const tag = version(record.cached?.tag);
        const body = notes(record.cached?.body);
        if (tag && body) this.cached = { tag, body };
      }
    } catch {
      // Missing or unreadable release metadata must not block Capri startup.
    }
  }

  save() {
    try {
      noLinks(this.file);
      writeJsonAtomic(this.file, { schemaVersion: 1, seen: this.seen, cached: this.cached });
    } catch {
      // A read-only installation can still show the notes during this launch.
    }
  }

  offer() {
    if (!this.current) return null;
    const baseline = this.seen ?? this.previous;
    if (!baseline) {
      this.seen = this.current;
      this.save();
      return null;
    }
    return compareVersions(this.current, baseline) > 0 ? this.current : null;
  }

  shown(tag) {
    if (tag !== this.current || this.offer() !== tag) return false;
    this.seen = tag;
    this.save();
    return true;
  }

  remember(release) {
    if (!release || release.draft) return;
    const tag = version(releaseVersion(release));
    const body = notes(release.body);
    if (!tag || !body) return;
    this.cached = { tag, body };
    this.save();
  }

  localBody() {
    if (!this.current) return '';
    if (this.cached?.tag === this.current) return this.cached.body;
    const tag = this.current.slice(1);
    for (const name of [tag + '.md', 'v' + tag + '.md']) {
      try {
        const file = path.join(this.root, 'docs', 'releases', name);
        noLinks(file);
        const info = statSync(file);
        if (info.isFile() && info.size <= 48 * 1024) {
          const body = notes(readFileSync(file, 'utf8'));
          if (body) return body;
        }
      } catch {
        // Releases without bundled notes can still use release metadata.
      }
    }
    return '';
  }
}
