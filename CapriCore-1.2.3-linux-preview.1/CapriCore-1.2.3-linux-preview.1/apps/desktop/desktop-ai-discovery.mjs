// SPDX-License-Identifier: GPL-3.0-only
import http from 'node:http';
import path from 'node:path';
import { lstatSync } from 'node:fs';

const APPS = [
  { id: 'chatgpt', name: 'ChatGPT', query: 'ChatGPT', connection: 'chatgpt' },
  { id: 'claude', name: 'Claude', query: 'Claude', connection: 'claude' },
  { id: 'gemini', name: 'Gemini', query: 'Gemini', connection: 'gemini' },
  { id: 'lmstudio', name: 'LM Studio', query: 'LM Studio', connection: 'local' },
  { id: 'ollama', name: 'Ollama', query: 'Ollama', connection: 'local' },
  { id: 'lemonade', name: 'Lemonade', query: 'Lemonade', connection: 'local' },
];
const SERVERS = [
  { id: 'lmstudio', name: 'LM Studio', endpoints: ['http://127.0.0.1:1234/v1'] },
  { id: 'ollama', name: 'Ollama', endpoints: ['http://127.0.0.1:11434/v1'] },
  {
    id: 'lemonade',
    name: 'Lemonade',
    endpoints: ['http://127.0.0.1:13305/api/v1', 'http://127.0.0.1:13305/v1'],
  },
];
export function installedAiClis({ env = process.env, stat = lstatSync } = {}) {
  const directories = (env.PATH ?? env.Path ?? '')
    .split(path.delimiter)
    .filter((dir) => dir && path.isAbsolute(dir) && !dir.startsWith('\\\\'))
    .slice(0, 64);
  const results = [];
  for (const [id, name, command] of [
    ['claude-code', 'Claude Code', 'claude'],
    ['codex', 'Codex', 'codex'],
    ['gemini-cli', 'Gemini CLI', 'gemini'],
  ]) {
    const installed = directories.some((directory) =>
      ['.exe', '.cmd', ''].some((extension) => {
        try {
          const entry = stat(path.join(directory, command + extension));
          return entry.isFile() && !entry.isSymbolicLink();
        } catch {
          return false;
        }
      }),
    );
    if (installed) results.push({ id, name, installed: true, kind: 'cli' });
  }
  return results;
}
function modelsAt(baseUrl) {
  // Fixed loopback destinations only. Do not inherit proxy settings or follow redirects.
  return new Promise((resolve) => {
    const request = http.get(
      baseUrl + '/models',
      { agent: false, signal: AbortSignal.timeout(1800), headers: { accept: 'application/json' } },
      (response) => {
        if ([401, 403].includes(response.statusCode)) {
          response.resume();
          resolve({ state: 'key-required', models: [] });
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          resolve(null);
          return;
        }
        const parts = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 512 * 1024) response.destroy();
          else parts.push(chunk);
        });
        response.on('error', () => resolve(null));
        response.on('end', () => {
          try {
            const packet = JSON.parse(Buffer.concat(parts).toString('utf8'));
            if (!Array.isArray(packet.data)) throw new Error();
            const models = [
              ...new Set(
                packet.data
                  .map((item) => item.id)
                  .filter((id) => typeof id === 'string' && /^[a-zA-Z0-9:._/-]{1,128}$/.test(id)),
              ),
            ].slice(0, 100);
            resolve({ state: models.length ? 'ready' : 'no-models', models });
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on('error', () => resolve(null));
  });
}
export class DesktopAiDiscovery {
  constructor({ discover, clis = installedAiClis, probe = modelsAt, now = Date.now }) {
    Object.assign(this, { discover, clis, probe, now });
  }
  async scan(refresh = false) {
    if (this.pending) return this.pending;
    if (!refresh && this.cached && this.cached.expires > this.now())
      return structuredClone(this.cached.value);
    const work = (async () => {
      const apps = [];
      for (const app of APPS) {
        try {
          const matches = await this.discover(app.query, refresh);
          // Display names are evidence of installation, not model access or sign-in.
          apps.push({
            id: app.id,
            name: app.name,
            connection: app.connection,
            installed: matches.some((match) =>
              match.name
                ?.toLowerCase()
                .replace(/[\s._-]+/g, '')
                .includes(app.query.toLowerCase().replace(/[\s._-]+/g, '')),
            ),
            kind: 'desktop',
          });
        } catch {
          apps.push({
            id: app.id,
            name: app.name,
            connection: app.connection,
            installed: false,
            state: 'unknown',
            kind: 'desktop',
          });
        }
      }
      const servers = await Promise.all(
        SERVERS.map(async ({ id, name, endpoints }) => {
          for (const baseUrl of endpoints) {
            const value = await this.probe(baseUrl);
            if (value) return { id, name, baseUrl, ...value };
          }
          return { id, name, baseUrl: endpoints[0], state: 'offline', models: [] };
        }),
      );
      const value = { apps: [...apps, ...this.clis()], servers };
      this.cached = { expires: this.now() + 300000, value };
      return structuredClone(value);
    })().finally(() => {
      if (this.pending === work) this.pending = null;
    });
    this.pending = work;
    return work;
  }
  connection(id, model) {
    const server = this.cached?.value.servers.find((item) => item.id === id);
    if (!server || server.state !== 'ready' || !server.models.includes(model))
      throw new Error('Refresh detected AI servers and choose an available model.');
    return {
      name: server.name,
      settings: {
        enabled: true,
        baseUrl: server.baseUrl,
        model,
        contextTokens: 8192,
        tools: false,
        vision: false,
      },
      key: '',
    };
  }
}
