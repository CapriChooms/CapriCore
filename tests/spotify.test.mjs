import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, settings } from '../packages/runtime/src/index.mjs';
import { invokeSpotify } from '../integrations/spotify/cli.mjs';
import plugin, { modelResult } from '../integrations/spotify/index.mjs';
import {
  validateCommand,
  normalizeSpotifyUri,
  spotifyLinkTitle,
  SpotifyWorker,
  SpotifyService,
  ACTIONS,
} from '../integrations/spotify/service.mjs';
import { spotifySourceHash } from '../integrations/spotify/native-build.mjs';

test('CLI uses the authenticated owner webchat route and does not bypass a denied tool', async (t) => {
  const parent = path.join(root, '.runtime/test-data');
  mkdirSync(parent, { recursive: true });
  const stateDir = mkdtempSync(path.join(parent, 'spotify-cli-'));
  writeFileSync(path.join(stateDir, 'gateway-token'), 'fixture');
  let denied = false;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:19876/tools/invoke');
    assert.equal(options.headers.authorization, 'Bearer fixture');
    assert.equal(options.headers['x-openclaw-message-channel'], 'webchat');
    assert.deepEqual(JSON.parse(options.body), {
      tool: 'spotify_control',
      args: { action: 'status' },
      sessionKey: settings.sessionKey,
    });
    return denied
      ? new Response(null, { status: 404 })
      : Response.json({ ok: true, result: { details: { ok: true, data: { running: true } } } });
  });
  const status = () => invokeSpotify({ action: 'status' }, { stateDir, gatewayPort: 19876 });
  assert.deepEqual(await status(), { running: true });
  denied = true;
  await assert.rejects(status, /HTTP 404/);
  assert.equal(fetch.mock.callCount(), 2);
});

test('Spotify commands are narrow, typed and never accept an arbitrary executable or URL', () => {
  assert.deepEqual(validateCommand({ action: 'volume', delta: -15 }), {
    action: 'volume',
    delta: -15,
  });
  for (const input of [
    null,
    { action: 'exec', command: 'anything' },
    { action: 'status', query: 'unrelated' },
    { action: 'volume', value: 101 },
    { action: 'volume', value: NaN },
    { action: 'volume', value: 30, delta: 5 },
    { action: 'mute', enabled: 'true' },
    { action: 'search', query: 'bad\ninput' },
    { action: 'play', query: 'song', resultId: '0123456789abcdef' },
    { action: 'play' },
    { action: 'repeat', mode: 'forever' },
    { action: 'play', uri: 'https://example.com/track/7mykoq6R3BArsSpNDjFQTm' },
    { action: 'play', uri: 'file:///C:/Windows/System32/calc.exe' },
  ])
    assert.throws(() => validateCommand(input));
  assert.equal(
    normalizeSpotifyUri('https://open.spotify.com/intl-en/track/7mykoq6R3BArsSpNDjFQTm?si=share'),
    'spotify:track:7mykoq6R3BArsSpNDjFQTm',
  );
  assert.equal(
    normalizeSpotifyUri('spotify:album:4GzPICfeGh5OqKjhUtpRQA'),
    'spotify:album:4GzPICfeGh5OqKjhUtpRQA',
  );
});
test('Spotify mutations are serial and a retried tool call ID is not performed twice', async () => {
  let running = 0,
    peak = 0;
  const seen = [];
  const worker = {
    async send(command) {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setImmediate(r));
      seen.push(command);
      running--;
      return { ok: true };
    },
    close() {},
  };
  const service = new SpotifyService(worker);
  const first = service.execute('one', { action: 'next' });
  const duplicate = service.execute('one', { action: 'next' });
  const second = service.execute('two', { action: 'volume', value: 25 });
  assert.equal(first, duplicate);
  await Promise.all([first, duplicate, second]);
  assert.equal(peak, 1);
  assert.deepEqual(seen, [{ action: 'next' }, { action: 'volume', value: 25 }]);
  assert.throws(() => service.execute('one', { action: 'previous' }));
});
test('queued Spotify actions honor cancellation before dispatch and errors do not trigger a retry', async () => {
  let release;
  const seen = [];
  const worker = {
    send(command) {
      seen.push(command);
      return seen.length === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.reject(new Error('native failed'));
    },
    close() {},
  };
  const service = new SpotifyService(worker),
    abort = new AbortController();
  const first = service.execute('one', { action: 'status' });
  await new Promise((r) => setImmediate(r));
  const queued = service.execute('two', { action: 'next' }, abort.signal);
  abort.abort();
  release({ ok: true });
  await first;
  await assert.rejects(queued, /cancelled/);
  assert.equal(seen.length, 1);
  const failed = service.execute('three', { action: 'next' });
  await assert.rejects(failed, /native failed/);
  await assert.rejects(service.execute('three', { action: 'next' }), /native failed/);
  assert.equal(seen.length, 2);
});
test('worker uses an owned executable, private stdio and an environment without Gateway credentials', async () => {
  const parent = path.join(root, '.runtime/test-data');
  mkdirSync(parent, { recursive: true });
  const fixture = mkdtempSync(path.join(parent, 'spotify-'));
  const native = path.join(fixture, 'integrations/spotify/native');
  mkdirSync(native, { recursive: true });
  const source = 'fixture source';
  writeFileSync(path.join(native, 'SpotifyBridge.cs'), source);
  writeFileSync(path.join(native, 'SpotifyAudio.cs'), 'fixture audio source');
  writeFileSync(path.join(native, 'SpotifyAccessibility.cs'), 'fixture accessibility source');
  writeFileSync(path.join(native, 'ExportAutomation.cs'), 'fixture export source');
  const hash = spotifySourceHash(fixture);
  const compiled = path.join(fixture, '.runtime/spotify-bridge'),
    artifact = hash.slice(0, 16) + '/Capri.Spotify.exe';
  mkdirSync(path.dirname(path.join(compiled, artifact)), { recursive: true });
  writeFileSync(path.join(compiled, artifact), 'fixture');
  writeFileSync(
    path.join(compiled, 'build.json'),
    JSON.stringify({ sourceSha256: hash, artifact }),
  );
  let launch;
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const worker = new SpotifyWorker({
    root: fixture,
    spawnImpl: (...args) => {
      launch = args;
      return child;
    },
  });
  const pending = worker.send({ action: 'status' });
  assert.ok(launch[0].endsWith('Capri.Spotify.exe'));
  assert.deepEqual(launch[1], []);
  assert.equal(launch[2].windowsHide, true);
  assert.ok(!Object.keys(launch[2].env).some((name) => /OPENCLAW|TOKEN/i.test(name)));
  child.stdout.write(
    '{"type":"ready","protocol":1}\n{"type":"result","request":1,"ok":true,"data":{"playing":false}}\n',
  );
  assert.equal((await pending).data.playing, false);
  worker.close();
  writeFileSync(path.join(native, 'SpotifyBridge.cs'), 'changed source');
  assert.throws(() => worker.start(), /rebuilding/);
});
test('plugin exposes only the scoped Spotify tool and owns its cleanup lifecycle', () => {
  const tools = [],
    services = [];
  plugin.register({
    source: path.join(root, 'integrations/spotify/index.mjs'),
    registerTool: (t) => tools.push(t),
    registerService: (s) => services.push(s),
    on() {},
  });
  assert.equal(tools.length, 1);
  const context = {
    agentId: 'capri',
    senderIsOwner: true,
    messageChannel: 'webchat',
    sessionKey: 'fixture',
    sessionId: 'fixture',
    sandboxed: false,
  };
  assert.equal(tools[0].contextVersion, 2);
  assert.equal(tools[0].create({ ...context, senderIsOwner: false }), null);
  assert.equal(tools[0].create({ ...context, messageChannel: 'telegram' }), null);
  const tool = tools[0].create(context);
  assert.equal(tool.name, 'spotify_control');
  assert.deepEqual(tool.parameters.properties.action.enum, ACTIONS);
  assert.ok(!ACTIONS.includes('shell'));
  assert.equal(services.length, 1);
  services[0].stop();
});

test('Spotify link metadata uses one fixed public endpoint and never renders returned HTML', async () => {
  let request;
  const title = await spotifyLinkTitle('spotify:track:7mykoq6R3BArsSpNDjFQTm', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({
          provider_name: 'Spotify',
          title: 'Song title',
          html: 'ignored untrusted markup',
        }),
      );
    },
  });
  assert.equal(title, 'Song title');
  assert.equal(request.url.origin, 'https://open.spotify.com');
  assert.equal(request.url.pathname, '/oembed');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.credentials, 'omit');
  await assert.rejects(spotifyLinkTitle('https://example.com/anything'));
  await assert.rejects(
    spotifyLinkTitle('spotify:track:7mykoq6R3BArsSpNDjFQTm', {
      fetchImpl: async () => new Response('x'.repeat(70000)),
    }),
    /too large/,
  );
});

test('model sees the actual Spotify playback state without confusing Windows transport metadata with a different player', () => {
  const native = {
    ok: true,
    data: {
      running: true,
      provider: 'windows-desktop',
      source: 'windows-media-session',
      playing: false,
      title: 'Song',
      artist: 'Artist',
      positionMs: 12400,
      volumePercent: 25,
      muted: false,
    },
  };
  const visible = modelResult('status', native);
  assert.equal(visible.data.app, 'Spotify');
  assert.equal(visible.data.playback, 'paused');
  assert.equal(visible.data.currentTrack.title, 'Song');
  assert.equal(visible.data.positionSeconds, 12);
  assert.ok(!JSON.stringify(visible).includes('windows-media-session'));
  const volume = modelResult('volume', native);
  assert.equal(volume.data.volumePercent, 25);
  assert.ok(!('currentTrack' in volume.data));
  assert.equal(volume.confirmation, 'Spotify volume is now 25%.');
  assert.ok(!visible.confirmation);
  assert.ok(!('muted' in volume.data));
  const pause = modelResult('pause', native);
  assert.equal(pause.data.playback, 'paused');
  assert.ok(!('currentTrack' in pause.data));
  assert.ok(!('volumePercent' in pause.data));
  assert.equal(pause.confirmation, 'Music paused.');
  assert.ok(!modelResult('volume', { ok: false, error: { code: 'failed' } }).confirmation);
  assert.equal(
    native.data.source,
    'windows-media-session',
    'Native details must remain intact for diagnostics',
  );
});
