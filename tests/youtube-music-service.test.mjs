// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  YouTubeMusicService,
  validateYouTubeMusicCommand,
} from '../integrations/youtube-music/service.mjs';

test('YouTube Music validates provider commands before any browser access', () => {
  assert.deepEqual(validateYouTubeMusicCommand({ action: 'play', query: '  Hikari' }), {
    action: 'play',
    query: 'Hikari',
  });
  assert.deepEqual(validateYouTubeMusicCommand({ action: 'start' }), { action: 'start' });
  for (const invalid of [
    { action: 'play' },
    { action: 'start', query: 'Invented track' },
    { action: 'play', query: 'song\nname' },
    { action: 'play', query: 'song', url: 'https://example.com' },
    { action: 'play', query: 'song', waitForSearch: true },
    { action: 'open', binding: '111:222:333' },
    { action: 'pause', query: 'another tab' },
    { action: 'volume', value: 20, delta: -5 },
    { action: 'volume', value: 105 },
    { action: 'volume', value: '50' },
    { action: 'volume', delta: NaN },
  ])
    assert.throws(() => validateYouTubeMusicCommand(invalid), /YouTube Music/);
});

test('YouTube Music opens fixed provider URLs only after the browser scan finds no tab', async () => {
  const calls = [];
  async function execute(command) {
    const service = new YouTubeMusicService({
      root: 'fixture',
      platform: 'win32',
      openExternal: async (url) => calls.push(new URL(url)),
      prepare: async () => 'native-fixture',
      run: async (_helper, command) => {
        calls.push(command);
        return command.waitForSearch
          ? { ok: true, status: 'playing', track: command.query }
          : { ok: false, status: 'tab_not_found' };
      },
    });
    try {
      return await service.execute(command.action, command);
    } finally {
      service.close();
    }
  }
  const query = 'C418 $ 音楽 &q=https://example.com?#';
  assert.deepEqual(await execute({ action: 'open' }), {
    ok: true,
    status: 'opened',
  });
  assert.deepEqual(await execute({ action: 'search', query }), {
    ok: true,
    status: 'search_opened',
  });
  assert.deepEqual(await execute({ action: 'play', query }), {
    ok: true,
    status: 'playing',
    track: query,
  });
  assert.deepEqual(
    calls.map((value) =>
      value instanceof URL ? [value.origin, value.pathname, value.searchParams.get('q')] : value,
    ),
    [
      { action: 'open' },
      ['https://music.youtube.com', '/', null],
      { action: 'search', query },
      ['https://music.youtube.com', '/search', query],
      { action: 'play', query },
      ['https://music.youtube.com', '/search', query],
      { action: 'play', query, waitForSearch: true },
    ],
  );
  assert.deepEqual([...calls[3].searchParams], [['q', query]]);
});

test('YouTube Music scans again without opening a duplicate while a newly launched tab loads', async () => {
  let launches = 0;
  let scans = 0;
  const service = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: async () => launches++,
    prepare: async () => 'native-fixture',
    run: async () => {
      scans++;
      return scans < 3
        ? { ok: false, status: 'tab_not_found' }
        : { ok: true, status: 'opened', binding: '131408:11232:639000032111010012:42,987,3' };
    },
  });
  assert.equal((await service.execute('first', { action: 'open' })).status, 'opened');
  assert.equal((await service.execute('immediate', { action: 'open' })).status, 'opened');
  assert.equal(launches, 1);
  assert.equal(scans, 3);
  service.close();
});

test('YouTube Music keeps playback commands in the validated document and never retries a lost binding', async () => {
  const records = [];
  const binding = '131408:11232:639000032111010012:42,987,3';
  const service = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: async (url) => records.push(url),
    prepare: async () => 'native-fixture',
    run: async (executable, command) => {
      assert.equal(executable, 'native-fixture');
      records.push(command);
      if (command.action === 'play')
        return { ok: true, status: 'playing', track: command.query, binding };
      if (command.action === 'search') return { ok: true, status: 'search_opened', binding };
      if (command.action === 'status') return { ok: true, status: 'ready' };
      return { ok: false, status: 'tab_not_found' };
    },
  });
  const play = { action: 'play', query: 'Hikari' };
  const first = service.execute('play-1', play);
  assert.equal(service.execute('play-1', play), first);
  assert.deepEqual(await first, { ok: true, status: 'playing', track: 'Hikari' });
  assert.throws(
    () => service.execute('play-1', { ...play, query: 'Another track' }),
    /operation ID/,
  );
  await service.execute('search-1', { action: 'search', query: 'Fallen Leaves' });
  await service.execute('play-2', { action: 'play', query: 'Fallen Leaves' });
  assert.deepEqual(await service.execute('pause-1', { action: 'pause' }), {
    ok: false,
    status: 'tab_not_found',
  });
  assert.deepEqual(await service.execute('status-1', { action: 'status' }), {
    ok: true,
    status: 'ready',
  });
  assert.deepEqual(records, [
    play,
    { action: 'search', query: 'Fallen Leaves', binding },
    { action: 'play', query: 'Fallen Leaves', binding },
    { action: 'pause', binding },
    { action: 'status' },
  ]);
  service.close();
});

test('YouTube Music reuses an existing tab after a stale binding and never opens for ambiguous results', async () => {
  const first = '131408:11232:639000032111010012:42,987,3';
  const second = '131409:11232:639000032111010012:42,987,5';
  const calls = [];
  const service = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: () => assert.fail('A tab was found or its identity could not be determined'),
    prepare: async () => 'native-fixture',
    run: async (_helper, command) => {
      calls.push(command);
      if (command.action === 'open') return { ok: true, status: 'opened', binding: first };
      if (command.binding === first) return { ok: false, status: 'tab_not_found' };
      if (command.action === 'search')
        return { ok: true, status: 'search_opened', binding: second };
      return {
        ok: false,
        status: command.query === 'Ambiguous' ? 'ambiguous_tab' : 'control_unverified',
      };
    },
  });
  assert.deepEqual(await service.execute('open', { action: 'open' }), {
    ok: true,
    status: 'opened',
  });
  assert.equal(
    (await service.execute('search', { action: 'search', query: 'Track' })).status,
    'search_opened',
  );
  assert.equal(
    (await service.execute('ambiguous', { action: 'play', query: 'Ambiguous' })).status,
    'ambiguous_tab',
  );
  assert.equal(
    (await service.execute('unverified', { action: 'play', query: 'Unverified' })).status,
    'control_unverified',
  );
  assert.deepEqual(calls, [
    { action: 'open' },
    { action: 'search', query: 'Track', binding: first },
    { action: 'search', query: 'Track' },
    { action: 'play', query: 'Ambiguous', binding: second },
    { action: 'play', query: 'Unverified', binding: second },
  ]);
  service.close();
});

test('YouTube Music verification rebinds after the previous tab changes', async () => {
  const first = '131408:11232:639000032111010012:42,987,3';
  const second = '131409:11232:639000032111010012:42,987,5';
  const calls = [];
  const service = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: () => assert.fail('Verification is read-only'),
    prepare: async () => 'native-fixture',
    run: async (_executable, command) => {
      calls.push(command);
      if (command.binding === first) return { ok: false, status: 'tab_not_found' };
      if (command.action === 'pause') return { ok: true, status: 'paused' };
      return { ok: true, status: 'ready', binding: calls.length === 1 ? first : second };
    },
  });
  assert.equal((await service.execute('verify-1', { action: 'status' })).status, 'ready');
  assert.equal((await service.execute('verify-2', { action: 'status' })).status, 'ready');
  assert.equal((await service.execute('pause', { action: 'pause' })).status, 'paused');
  assert.deepEqual(calls, [
    { action: 'status' },
    { action: 'status', binding: first },
    { action: 'status' },
    { action: 'pause', binding: second },
  ]);
  service.close();
});

test('generic YouTube Music playback uses the already validated tab without a search or new tab', async () => {
  const binding = '131408:11232:639000032111010012:42,987,3';
  const calls = [];
  const service = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: () => assert.fail('Generic playback should use the existing tab'),
    prepare: async () => 'native-fixture',
    run: async (_executable, command) => {
      calls.push(command);
      return command.action === 'status'
        ? { ok: true, status: 'ready', binding }
        : { ok: true, status: 'playing', track: 'Recommendation', playing: true, binding };
    },
  });
  assert.deepEqual(await service.execute('verify', { action: 'status' }), {
    ok: true,
    status: 'ready',
  });
  assert.deepEqual(await service.execute('generic', { action: 'start' }), {
    ok: true,
    status: 'playing',
    track: 'Recommendation',
    playing: true,
  });
  assert.deepEqual(calls, [{ action: 'status' }, { action: 'start', binding }]);
  service.close();
});

test('YouTube Music cancels waiting work and reports browser launch failures', async () => {
  const unavailable = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: async () => {
      throw new Error('browser unavailable');
    },
    prepare: async () => 'native-fixture',
    run: async () => ({ ok: false, status: 'tab_not_found' }),
  });
  assert.deepEqual(await unavailable.execute('open-1', { action: 'open' }), {
    ok: false,
    status: 'browser_open_failed',
  });
  unavailable.close();

  const preparing = Promise.withResolvers();
  const prepared = Promise.withResolvers();
  const service = new YouTubeMusicService({
    root: 'fixture',
    platform: 'win32',
    openExternal: () => assert.fail('Cancelled commands must never open a browser tab'),
    prepare: () => {
      preparing.resolve();
      return prepared.promise;
    },
    run: () => assert.fail('Cancelled commands must never reach the browser driver'),
  });
  const controller = new AbortController();
  const pending = service.execute('pause-1', { action: 'pause' }, controller.signal);
  await preparing.promise;
  const following = service.execute('next-1', { action: 'next' });
  controller.abort();
  service.close();
  prepared.resolve('native-fixture');
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(following, { name: 'AbortError' });
});
