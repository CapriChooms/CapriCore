// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputerAgent } from '../apps/desktop/computer-agent.mjs';
import {
  computerModeRequest,
  computerTaskCommand,
} from '../apps/desktop/computer-mode-request.mjs';
import { steamGameCommand } from '../apps/desktop/steam-task-state.mjs';
import { createSteamGameTask, findSteamStoreGame } from '../apps/desktop/steam-game-task.mjs';

const reported =
  'Привет. Короче, открой Стим, найди там портал 2. Если он не скачан, нажми скачать и установи на Z. Если нет, нажми Играть';
const game = { appId: '620', name: 'Portal 2' };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'capri-steam-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = path.join(directory, 'steamapps');
  await mkdir(library);
  const manifest = (flags, bytesToDownload = 0) =>
    writeFile(
      path.join(library, 'appmanifest_620.acf'),
      [
        '"AppState"',
        '{',
        '"appid" "620"',
        '"name" "Portal 2"',
        '"installdir" "Portal 2"',
        `"StateFlags" "${flags}"`,
        `"BytesToDownload" "${bytesToDownload}"`,
        '}',
      ].join('\n'),
    );
  const steam = path.join(directory, 'steam.exe');
  const makeTask = (options) =>
    createSteamGameTask({
      findClient: async () => steam,
      findStoreGame: async () => game,
      launchTimeout: 0,
      dialogTimeout: 80,
      pollInterval: 0,
      ...options,
    });
  const hooks = {
    signal: new AbortController().signal,
    assertAllowed() {},
    observe() {
      assert.fail('The installed branch does not need a window observation');
    },
    click() {
      assert.fail('Unexpected click');
    },
    phase() {},
    onAction() {},
    onGame() {},
  };
  return { manifest, makeTask, hooks, directory, steam };
}

test('the full spoken request preserves the conditional install and drive; mixed commands still use the planner', () => {
  const parse = (text) => steamGameCommand(computerTaskCommand(text));
  assert.deepEqual(computerModeRequest(reported, { fullComputerAccess: true }), {
    enabled: true,
    run: true,
  });
  assert.equal(computerModeRequest(reported), null);
  assert.deepEqual(parse(reported), { name: 'портал 2', installIfMissing: true, drive: 'Z' });
  assert.deepEqual(
    parse(
      'Open Steam, find Portal 2. If it is not installed, install it on drive D:. Otherwise, press Play.',
    ),
    { name: 'Portal 2', installIfMissing: true, drive: 'D' },
  );
  assert.equal(parse(reported + ', потом открой Discord'), null);
  assert.equal(parse(reported.replace('открой Стим', 'не открывай Стим')), null);
  assert.deepEqual(parse('Launch Portal 2 through Steam.'), {
    name: 'Portal 2',
    installIfMissing: false,
  });
});

test('the Steam store resolver checks app ID and matches the exact title without choosing DLC or edition', async () => {
  const reply = (displayName, id, hrefId = id) =>
    `<a data-ds-appid="${id}" href="https://store.steampowered.com/app/${hrefId}/G/"><div class="match_name">${displayName}</div></a>`;
  const terms = [];
  const result = await findSteamStoreGame('портал 2', new AbortController().signal, async (url) => {
    assert.equal(url.hostname, 'store.steampowered.com');
    const query = url.searchParams.get('term');
    terms.push(query);
    return new Response(
      query === 'portal 2'
        ? reply('Portal 2', '999', '9999') +
          reply('Portal 2 Soundtrack', '101') +
          reply('Portal 2', '620')
        : '',
    );
  });
  assert.deepEqual(new Set(terms), new Set(['портал 2', 'portal 2']));
  assert.deepEqual(result, game);
});

test('the exact reported request launches the installed Portal 2 by AppID before the general planner', async (t) => {
  const f = await fixture(t);
  await f.manifest(4);
  const calls = [];
  let running = false;
  let audit;
  const agent = new ComputerAgent({
    control: {
      session: null,
      begin() {
        this.session = { controller: new AbortController() };
      },
      requireSession() {
        assert.ok(this.session);
        return this.session;
      },
      stop() {
        this.session = null;
      },
      execute() {
        assert.fail('No UI inputs are needed to launch the installed game');
      },
    },
    applications: {},
    plan: () => assert.fail('The general planner must not get this Steam task'),
    language: () => 'ru',
    audit: (value) => {
      audit = value;
    },
    steamGameTask: f.makeTask({
      openExternal: async (uri) => {
        calls.push(uri);
        running = true;
      },
      findStoreGame: async () => assert.fail('Use the local manifest for an installed game'),
      gameRunning: async ({ appId, installPath }) => {
        assert.equal(appId, '620');
        assert.equal(installPath, path.join(f.directory, 'steamapps', 'common', 'Portal 2'));
        return running;
      },
    }),
  });
  assert.deepEqual(await agent.run(reported), {
    ok: true,
    verified: true,
    steps: 1,
    status: 'completed',
    summary: 'Запустила Portal 2 через Steam.',
  });
  assert.deepEqual(calls, ['steam://rungameid/620']);
  assert.equal(audit.lastOutcome.reason, 'steam_started');
  assert.equal((await agent.run(reported)).steps, 0);
  assert.equal(calls.length, 1);
});

test('launch reports chosen game, rejects an unconfirmed process and never installs on a play-only request', async (t) => {
  const f = await fixture(t);
  const calls = [];
  const request = { name: 'Portal 2', installIfMissing: false };
  const task = f.makeTask({
    openExternal: async (uri) => calls.push(uri),
    gameRunning: async () => false,
  });
  assert.equal((await task(request, f.hooks)).status, 'steam_game_not_found');
  assert.equal(
    (await f.makeTask({ findClient: async () => null })(request, f.hooks)).status,
    'steam_client_missing',
  );
  await f.manifest(2);
  assert.equal((await task(request, f.hooks)).status, 'steam_not_installed');
  assert.deepEqual(calls, []);
  await f.manifest(4);
  assert.equal((await task(request, f.hooks)).status, 'steam_launch_unconfirmed');
  assert.deepEqual(calls, ['steam://rungameid/620']);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(task(request, { ...f.hooks, signal: cancelled.signal }), {
    name: 'AbortError',
  });
  assert.equal(calls.length, 1);
});

test('missing game confirms the exact Steam dialog and selected drive before checking the matching download manifest', async (t) => {
  const f = await fixture(t);
  const drive = /^[a-z]:/iu.test(f.directory) ? f.directory[0].toUpperCase() : null;
  const otherDrive = drive === 'E' ? 'D' : 'E';
  const actions = [];
  let stage = 'page';
  const control = (role, label, targetId, other = {}) => ({
    role: 'ControlType.' + role,
    clickKind: 'control',
    untrustedLabel: label,
    targetId,
    ...other,
  });
  const open = control('Button', 'Install', 'open');
  const confirm = control('Button', 'Install', 'confirm');
  const run = f.makeTask({ openExternal: async (uri) => actions.push(uri) });
  const result = await run(
    { name: 'Portal 2', installIfMissing: true, drive },
    {
      ...f.hooks,
      observe: async (vision) => {
        const page = stage === 'page';
        let drives = [];
        if (drive)
          drives =
            stage === 'picker'
              ? [
                  control('ListItem', 'Other (' + otherDrive + ':)', 'other', { selected: true }),
                  control('ListItem', 'Steam Library (' + drive + ':)', 'choose'),
                ]
              : [
                  control('ComboBox', '', 'picker', {
                    untrustedValue: (stage === 'selected' ? drive : otherDrive) + ':\\',
                  }),
                ];
        return {
          executable: f.steam,
          view: {
            window: {
              applicationKind: 'steam',
              ...(page ? {} : { modal: true, untrustedTitle: 'Install – Portal 2' }),
            },
            steamLibrary: page && vision ? { page: 'game', gameTitle: 'Portal 2' } : null,
            targets: page ? [open] : [...drives, confirm],
          },
        };
      },
      click: async ({ targetId }) => {
        actions.push(targetId);
        if (targetId === 'open') stage = 'dialog';
        if (targetId === 'picker') stage = 'picker';
        if (targetId === 'choose') stage = 'selected';
        if (targetId === 'confirm') {
          assert.ok(!drive || stage === 'selected');
          await f.manifest(2, 1200);
        }
        return true;
      },
    },
  );
  assert.deepEqual(result, { status: 'steam_download_started', name: 'Portal 2', drive });
  assert.deepEqual(actions, [
    'steam://nav/games/details/620',
    'open',
    ...(drive ? ['picker', 'choose'] : []),
    'confirm',
  ]);
  actions.length = 0;
  assert.equal(
    (await run({ name: 'Portal 2', installIfMissing: true, drive: otherDrive }, f.hooks)).status,
    'steam_library_missing',
  );
  assert.deepEqual(actions, []);
});

test('unrelated Steam modal cannot trigger the confirmation for another game', async (t) => {
  const f = await fixture(t);
  const task = f.makeTask({ dialogTimeout: 0, openExternal: async () => {} });
  const result = await task(
    { ...game, installIfMissing: true, drive: null },
    {
      ...f.hooks,
      observe: async () => ({
        executable: f.steam,
        view: {
          window: {
            applicationKind: 'steam',
            modal: true,
            untrustedTitle: 'Install – Another Game',
          },
          targets: [
            {
              role: 'ControlType.Button',
              clickKind: 'control',
              untrustedLabel: 'Install',
              targetId: 'wrong',
            },
          ],
        },
      }),
    },
  );
  assert.equal(result.status, 'steam_install_needs_confirmation');
});
