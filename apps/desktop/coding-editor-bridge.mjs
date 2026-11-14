// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, readdirSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertPrivatePath } from '../../packages/runtime/src/safe-file.mjs';
export class CodingEditorBridge {
  constructor({
    directory = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Capri/CodingBridge')
      : '',
    fetchImpl = fetch,
  } = {}) {
    Object.assign(this, { directory, fetchImpl });
  }
  endpoint(workspace) {
    if (!this.directory || !existsSync(this.directory)) return null;
    assertPrivatePath(this.directory);
    const canonical = realpathSync(workspace).toLowerCase();
    const matches = [];
    for (const name of readdirSync(this.directory)
      .filter((name) => /^\d+-[a-f0-9]{12}\.json$/.test(name))
      .slice(0, 32)) {
      try {
        const file = path.join(this.directory, name);
        assertPrivatePath(file);
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384) continue;
        const row = JSON.parse(readFileSync(file, 'utf8'));
        if (
          row.protocol !== 1 ||
          !Number.isInteger(row.pid) ||
          row.pid <= 0 ||
          !name.startsWith(row.pid + '-') ||
          !Number.isInteger(row.port) ||
          row.port < 1024 ||
          row.port > 65535 ||
          !/^[a-f0-9]{64}$/.test(row.token) ||
          !Array.isArray(row.workspaces) ||
          !row.workspaces.some((folder) => realpathSync(folder).toLowerCase() === canonical)
        )
          continue;
        process.kill(row.pid, 0);
        matches.push(row);
      } catch {
        /* Stale/invalid rendezvous never authorizes a connection. */
      }
    }
    if (matches.length > 1)
      throw Error(
        'This project is open in multiple editor bridges. Close the duplicate window before editing.',
      );
    return matches[0] ?? null;
  }
  async request(workspace, value, signal) {
    const target = this.endpoint(workspace);
    if (!target) return null;
    const response = await this.fetchImpl(`http://127.0.0.1:${target.port}/project`, {
      method: 'POST',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      headers: { authorization: 'Bearer ' + target.token, 'content-type': 'application/json' },
      body: JSON.stringify({ ...value, workspace }),
    });
    const length = Number(response.headers.get('content-length'));
    if (length > 1024 * 1024) throw Error('The editor response is too large.');
    const decoder = new TextDecoder();
    let raw = '';
    for await (const chunk of response.body) {
      raw += decoder.decode(chunk, { stream: true });
      if (raw.length > 1024 * 1024) throw Error('The editor response is too large.');
    }
    raw += decoder.decode();
    const result = JSON.parse(raw);
    if (!response.ok || result.error)
      throw Error(
        {
          save_unsaved_buffer_first:
            'Save your unsaved editor changes before asking Capri to edit this file.',
          document_changed: 'The editor document changed. Read it again before editing.',
        }[result.error] ?? 'The editor bridge could not complete this operation.',
      );
    return result;
  }
}
