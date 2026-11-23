// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DesktopAiDiscovery, installedAiClis } from '../apps/desktop/desktop-ai-discovery.mjs';

test('CLI discovery inspects only fixed command filenames in PATH and never runs them or reads credentials', () => {
  const inspected = [],
    directory = path.resolve('fixture-bin');
  const result = installedAiClis({
    env: { PATH: directory },
    stat(file) {
      inspected.push(file);
      return { isFile: () => path.basename(file) === 'claude.exe', isSymbolicLink: () => false };
    },
  });
  assert.deepEqual(result, [
    { id: 'claude-code', name: 'Claude Code', installed: true, kind: 'cli' },
  ]);
  assert(inspected.every((file) => path.dirname(file) === directory));
  assert(
    inspected.every((file) =>
      /^(?:claude|codex|gemini)(?:\.exe|\.cmd)?$/.test(path.basename(file)),
    ),
  );
  assert(!JSON.stringify(result).includes(directory));
});

test('installed apps and available model servers are distinct, bounded and cached', async () => {
  const queries = [],
    probes = [];
  let now = 100;
  const discovery = new DesktopAiDiscovery({
    now: () => now,
    clis: () => [],
    discover: async (query) => {
      queries.push(query);
      return query === 'LM Studio' ? [{ name: 'LMStudio' }] : [];
    },
    probe: async (baseUrl) => {
      probes.push(baseUrl);
      return baseUrl.includes(':1234/') ? { state: 'ready', models: ['fixture-model'] } : null;
    },
  });
  const value = await discovery.scan();
  assert.equal(value.apps.find((app) => app.id === 'lmstudio').installed, true);
  assert.equal(value.apps.find((app) => app.id === 'chatgpt').installed, false);
  assert.deepEqual(queries, ['ChatGPT', 'Claude', 'Gemini', 'LM Studio', 'Ollama', 'Lemonade']);
  assert(
    probes.every((url) => /^http:\/\/127\.0\.0\.1:(?:1234|11434|13305)\/(?:api\/)?v1$/.test(url)),
  );
  const calls = queries.length;
  await discovery.scan();
  assert.equal(queries.length, calls);
  value.apps[0].installed = true;
  assert.equal((await discovery.scan()).apps[0].installed, false);
  now += 300001;
  await discovery.scan();
  assert.equal(queries.length, calls * 2);
});

test('discovery shares concurrent work and failures cannot enable an arbitrary provider', async () => {
  let queries = 0;
  const discovery = new DesktopAiDiscovery({
    clis: () => [],
    discover: async () => {
      queries++;
      throw new Error('Private installation path');
    },
    probe: async () => null,
  });
  const results = await Promise.all([discovery.scan(), discovery.scan(true)]);
  assert.equal(queries, 6);
  assert(results[0].apps.every((app) => app.state === 'unknown'));
  assert(!JSON.stringify(results).includes('Private installation'));
  assert.throws(() => discovery.connection('https://attacker.test', 'model'));
  assert.throws(() => discovery.connection('lmstudio', 'model'));
});

test('only an enumerated model on a known ready loopback server can become a saved connection', async () => {
  const discovery = new DesktopAiDiscovery({
    clis: () => [],
    discover: async () => [],
    probe: async (url) =>
      url.includes(':1234/') ? { state: 'ready', models: ['model-one'] } : null,
  });
  await discovery.scan();
  assert.throws(() => discovery.connection('lmstudio', 'invented-model'));
  assert.deepEqual(discovery.connection('lmstudio', 'model-one'), {
    name: 'LM Studio',
    key: '',
    settings: {
      enabled: true,
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'model-one',
      contextTokens: 8192,
      tools: false,
      vision: false,
    },
  });
});
