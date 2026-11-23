// SPDX-License-Identifier: GPL-3.0-only
import { appendFile } from 'node:fs/promises';
import { existsSync, lstatSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { assertPrivatePath } from './safe-file.mjs';

/** Bounded, batched diagnostics that never gate the operation they describe. */
export class BoundedDiagnosticLog {
  constructor(file, { record, maximumBytes = 512 * 1024 }) {
    Object.assign(this, { file, record, maximumBytes });
    this.queue = [];
  }

  write(value) {
    const record = this.record(value);
    if (!record || this.queue.length >= 128) return;
    this.queue.push(JSON.stringify(record) + '\n');
    if (!this.timer && !this.pending)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 25).unref();
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      await this.pending;
      if (this.queue.length) return this.flush();
      return;
    }
    if (!this.queue.length) return;
    const bytes = this.queue.splice(0).join('');
    this.pending = (async () => {
      try {
        assertPrivatePath(this.file);
        mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        if (existsSync(this.file)) {
          const info = lstatSync(this.file);
          if (!info.isFile() || info.nlink !== 1) return;
          if (info.size + Buffer.byteLength(bytes) > this.maximumBytes) {
            const previous = this.file + '.1';
            assertPrivatePath(previous);
            if (existsSync(previous)) {
              const old = lstatSync(previous);
              if (!old.isFile() || old.nlink !== 1) return;
              unlinkSync(previous);
            }
            renameSync(this.file, previous);
          }
        }
        await appendFile(this.file, bytes, { mode: 0o600 });
      } catch {
        // Unavailable diagnostics must not interrupt the caller.
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
    if (this.queue.length) return this.flush();
  }
}
