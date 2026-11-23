// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root } from '../packages/runtime/src/host/paths.mjs';
import { writeJsonAtomic } from '../packages/runtime/src/atomic-json.mjs';
import { spotifySourceHash, NATIVE_SOURCES } from '../integrations/spotify/native-build.mjs';
import { configureSpotify, spotifyAccess } from '../integrations/spotify/configuration.mjs';
import { SpotifySettings } from '../apps/desktop/spotify-settings.mjs';

function fixture() {
  const parent = path.join(root, '.runtime/test-data');
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(path.join(parent, 'spotify-settings-'));
  const config = {
    tools: { allow: ['memory_search'], deny: ['exec', 'spotify_control'] },
    agents: {
      defaults: { thinkingDefault: 'low', model: { primary: 'ollama/capri-qwen3.5:9b' } },
      entries: { capri: { tools: { allow: ['memory_search'], deny: ['shell'] } } },
    },
    plugins: { allow: ['other'], entries: { other: { enabled: true } }, load: { paths: [] } },
  };
  const rt = {
    configPath: path.join(folder, 'private/config.json'),
  };
  writeJsonAtomic(rt.configPath, config);
  const native = path.join(folder, 'integrations/spotify/native');
  mkdirSync(native, { recursive: true });
  for (const name of [...NATIVE_SOURCES, 'ExportAutomation.cs'])
    writeFileSync(path.join(native, name), '// fixture ' + name);
  const prepare = () => {
    const hash = spotifySourceHash(folder),
      artifact = hash.slice(0, 16) + '/Capri.Spotify.exe';
    const build = path.join(folder, '.runtime/spotify-bridge');
    mkdirSync(path.dirname(path.join(build, artifact)), { recursive: true });
    writeFileSync(path.join(build, artifact), 'never executed');
    writeJsonAtomic(path.join(build, 'build.json'), { sourceSha256: hash, artifact });
  };
  return { root: folder, rt, agentId: 'capri', node: process.execPath, config, prepare };
}
test('Spotify permission changes preserve other tools, model, plugins and reasoning', () => {
  const f = fixture(),
    on = configureSpotify(f.config, { ...f, enabled: true });
  assert.equal(spotifyAccess(on, f.root, f.agentId), true);
  assert.deepEqual(on.agents.defaults, f.config.agents.defaults);
  assert.deepEqual(on.plugins.entries.other, f.config.plugins.entries.other);
  assert.deepEqual(on.tools.deny, ['exec']);
  assert.deepEqual(on.agents.entries.capri.tools.deny, ['shell']);
  assert.equal(f.config.plugins.entries['capri-spotify'], undefined);
  const off = configureSpotify(on, { ...f, enabled: false });
  assert.equal(spotifyAccess(off, f.root, f.agentId), false);
  assert.deepEqual(off.tools.allow, ['memory_search']);
  assert.deepEqual(off.plugins.allow, ['other']);
  assert.deepEqual(off.plugins.load.paths, []);
  assert.equal(spotifyAccess({ ...on, agents: {} }, f.root, f.agentId), false);
  on.agents.entries.capri.tools.deny.push('spotify_control');
  assert.equal(spotifyAccess(on, f.root, f.agentId), false);
});
test('a failed native build cannot grant Spotify access or stop the running core', async () => {
  const f = fixture();
  const settings = new SpotifySettings({
    ...f,
    execute: async (_node, args, options) => {
      assert.equal(args[0], path.join(f.root, 'integrations/spotify/provision.mjs'));
      assert.equal(options.env.CAPRI_NODE_PATH, process.execPath);
      assert.equal(options.env.OPENCLAW_GATEWAY_TOKEN, undefined);
      assert.equal(options.windowsHide, true);
      throw new Error('compiler fixture');
    },
  });
  assert.equal(settings.snapshot().enabled, false);
  await assert.rejects(
    settings.setEnabled(true, {
      beforeCommit: () => assert.fail('Cannot stop core before compiling'),
      restart: () => assert.fail('Cannot restart after failed compile'),
    }),
    /compiler fixture/,
  );
  assert.deepEqual(JSON.parse(readFileSync(f.rt.configPath)), f.config);
  assert.equal(settings.busy(), false);
});
test('Spotify is committed after shutdown and rolled back if relaunch fails', async () => {
  const f = fixture(),
    steps = [];
  const settings = new SpotifySettings({
    ...f,
    execute: async () => {
      steps.push('compile');
      f.prepare();
    },
  });
  await assert.rejects(
    settings.setEnabled(true, {
      beforeCommit: async () => {
        steps.push('stop');
        assert.deepEqual(JSON.parse(readFileSync(f.rt.configPath)), f.config);
      },
      restart: async () => {
        steps.push('restart');
        assert.equal(settings.snapshot().enabled, true);
        throw new Error('relaunch fixture');
      },
    }),
    /relaunch fixture/,
  );
  assert.deepEqual(steps, ['compile', 'stop', 'restart']);
  assert.deepEqual(JSON.parse(readFileSync(f.rt.configPath)), f.config);
  assert.equal(settings.snapshot().prepared, true);
  await settings.setEnabled(true, { beforeCommit: async () => {}, restart: async () => {} });
  assert.equal(settings.snapshot().enabled, true);
  await settings.setEnabled(false, { beforeCommit: async () => {}, restart: async () => {} });
  assert.equal(settings.snapshot().enabled, false);
});
test('Spotify connection checks use the local bridge without requiring a gateway or chat session', async () => {
  const f = fixture(),
    seen = [];
  f.prepare();
  let running = true;
  const settings = new SpotifySettings({
    ...f,
    readStatus: async (signal) => {
      assert.equal(signal.aborted, false);
      seen.push('status');
      return {
        ok: true,
        data: { running, title: 'private fixture' },
      };
    },
  });
  await assert.rejects(settings.check(), /Enable Spotify/);
  assert.equal(seen.length, 0);
  writeJsonAtomic(f.rt.configPath, configureSpotify(f.config, { ...f, enabled: true }));
  const value = await settings.check();
  assert.equal(value.connection, 'connected');
  assert.equal(JSON.stringify(value).includes('private fixture'), false);
  running = false;
  assert.equal((await settings.check()).connection, 'not-running');
  running = undefined;
  await assert.rejects(settings.check(), /Spotify connection could not be verified/);
  assert.equal(settings.snapshot().connection, null);
  assert.deepEqual(seen, ['status', 'status', 'status']);
});

test('closing the connection check releases Settings while the read-only probe is pending', async () => {
  const f = fixture();
  f.prepare();
  writeJsonAtomic(f.rt.configPath, configureSpotify(f.config, { ...f, enabled: true }));
  let signal;
  const settings = new SpotifySettings({
    ...f,
    readStatus: (value) => {
      signal = value;
      return new Promise(() => {});
    },
  });
  const checking = settings.check();
  await Promise.resolve();
  assert.equal(settings.busy(), true);
  settings.close();
  await assert.rejects(checking, /Spotify setup cancelled/);
  assert.equal(signal.aborted, true);
  assert.equal(settings.busy(), false);
  assert.equal(settings.snapshot().connection, null);
});
