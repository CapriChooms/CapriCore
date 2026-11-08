// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { processStartedAt } from '../packages/runtime/src/host/processes.mjs';

const parent = path.join(root, '.runtime/desktop-launcher-tests');
mkdirSync(parent, { recursive: true });
function fixture() {
  const folder = mkdtempSync(path.join(parent, 'fixture-'));
  cpSync(path.join(root, 'packages/runtime/src'), path.join(folder, 'packages/runtime/src'), {
    recursive: true,
  });
  mkdirSync(path.join(folder, 'config'), { recursive: true });
  cpSync(path.join(root, 'config/core.json'), path.join(folder, 'config/core.json'));
  writeFileSync(path.join(folder, 'config/core.local.json'), '{}');
  const records = {
    'data/openclaw/openclaw.json': JSON.stringify({
      agents: { defaults: { model: { primary: 'capri-api/fixture/model' }, skipBootstrap: false } },
      models: { providers: { 'capri-api': { apiKey: '${CAPRI_REMOTE_PROXY_TOKEN}' } } },
    }),
    'data/openclaw/gateway-token': 'synthetic-local-fixture-token\n',
    'data/workspace/USER.md': '# User\n\nSynthetic fixture preference.\n',
    'data/workspace/MEMORY.md': '# Memory\n\nSynthetic fixture memory.\n',
    'data/desktop/inference-api.json': '{"enabled":true,"profileId":"fixture-profile"}',
    'data/secrets/inference-api-profiles.json': '{"schemaVersion":1,"profiles":[]}',
  };
  for (const [name, text] of Object.entries(records)) {
    const file = path.join(folder, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const snapshot = () =>
    Object.fromEntries(
      Object.keys(records).map((name) => {
        const file = path.join(folder, name);
        return [
          name,
          {
            hash: createHash('sha256').update(readFileSync(file)).digest('hex'),
            mtime: statSync(file).mtimeMs,
          },
        ];
      }),
    );
  return {
    folder,
    snapshot,
    launcher: () =>
      import(pathToFileURL(path.join(folder, 'packages/runtime/src/desktop-launcher.mjs')).href),
  };
}

test(
  'a verified running desktop is restored without initializing config, memory or credentials',
  { skip: process.platform !== 'win32' || process.arch !== 'x64' },
  async (t) => {
    const f = fixture();
    const marker = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      projectRoot: f.folder,
    };
    assert(marker.startedAt);
    mkdirSync(path.join(f.folder, 'data/run'), { recursive: true });
    writeFileSync(path.join(f.folder, 'data/run/desktop.json'), JSON.stringify(marker));
    const before = f.snapshot();
    const previous = process.env.CAPRI_LAUNCH_NONCE;
    process.env.CAPRI_LAUNCH_NONCE = '1'.repeat(32);
    t.after(() => {
      if (previous === undefined) delete process.env.CAPRI_LAUNCH_NONCE;
      else process.env.CAPRI_LAUNCH_NONCE = previous;
    });
    const { startDesktop } = await f.launcher();
    const result = await startDesktop();
    assert.deepEqual(result, { ...marker, alreadyRunning: true });
    assert.deepEqual(f.snapshot(), before);
    assert.equal(existsSync(path.join(f.folder, 'data/workspace/PERSONALITY.md')), false);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(f.folder, 'data/run/desktop.show'), 'utf8')),
      { show: true, launchNonce: '1'.repeat(32) },
    );
  },
);

test(
  'a missing desktop runtime cannot initialize owner files before reporting a repair error',
  { skip: process.platform !== 'win32' || process.arch !== 'x64' },
  async () => {
    const f = fixture(),
      before = f.snapshot();
    const { startDesktop } = await f.launcher();
    await assert.rejects(startDesktop(), /desktop download is incomplete/);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(existsSync(path.join(f.folder, 'data/workspace/PERSONALITY.md')), false);
  },
);
