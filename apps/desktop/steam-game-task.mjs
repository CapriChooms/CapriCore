// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { canClickTarget } from './computer-click-target.mjs';
import { isSteamClient, steamGamePage } from './steam-task-state.mjs';
import {
  isSteamExecutable,
  matchSteamTitle,
  readSteamLibraries,
  readSteamManifest,
  resolveSteamLibraryGame,
  romanizeSteamTitle,
} from './steam-library.mjs';

const exec = promisify(execFile);
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const normalized = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
const driveOf = (library) => /^[a-z](?=:)/iu.exec(library)?.[0].toUpperCase() ?? null;

async function windowsSteamExecutable(signal) {
  try {
    const { stdout } = await exec(
      path.win32.join(systemRoot, 'System32', 'reg.exe'),
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe'],
      { signal, windowsHide: true, timeout: 3000 },
    );
    const file = stdout.match(/^\s*SteamExe\s+REG_SZ\s+(.+?)\s*$/imu)?.[1];
    if (!file || !isSteamExecutable(file)) return null;
    const steam = path.normalize(file);
    return (await stat(steam)).isFile() ? steam : null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

export async function steamGameProcessRunning({ appId, installPath }, signal) {
  if (!/^[1-9]\d{0,9}$/u.test(appId) || !installPath) return false;
  try {
    const { stdout } = await exec(
      path.win32.join(systemRoot, 'System32', 'WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$app = 'HKCU:\\Software\\Valve\\Steam\\Apps\\' + $env:CAPRI_STEAM_GAME_ID; " +
          'if ((Get-ItemPropertyValue -LiteralPath $app -Name Running -ErrorAction SilentlyContinue) -ne 1) { return }; ' +
          "$root = [IO.Path]::GetFullPath($env:CAPRI_STEAM_GAME_FOLDER).TrimEnd('\\') + '\\'; " +
          '$match = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -and ' +
          '$_.Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1; ' +
          "if ($match) { [Console]::Out.Write('running') }",
      ],
      {
        env: { ...process.env, CAPRI_STEAM_GAME_ID: appId, CAPRI_STEAM_GAME_FOLDER: installPath },
        signal,
        windowsHide: true,
        timeout: 3500,
      },
    );
    return stdout.trim() === 'running';
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

const titleEntities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decodeTitle = (text) =>
  text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|amp|quot|apos|lt|gt|nbsp);/giu, (entity, value) => {
    if (!value.startsWith('#')) return titleEntities[value.toLowerCase()];
    const hex = value[1].toLowerCase() === 'x';
    const codepoint = Number.parseInt(value.slice(hex ? 2 : 1), hex ? 16 : 10);
    return codepoint <= 0x10ffff ? String.fromCodePoint(codepoint) : entity;
  });

export async function findSteamStoreGame(title, signal, fetchImpl = fetch) {
  const terms = new Set([normalized(title), romanizeSteamTitle(normalized(title))]);
  const games = await Promise.all(
    [...terms].map(async (term) => {
      const url = new URL('https://store.steampowered.com/search/suggest');
      url.search = new URLSearchParams({ term, f: 'games', l: 'english', cc: 'US' });
      try {
        const response = await fetchImpl(url, {
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
        });
        if (!response.ok) return [];
        const body = await response.text();
        return [
          ...body
            .slice(0, 64 * 1024)
            .matchAll(/<a\s+([^>]+)>\s*<div class="match_name">([^<>]{1,300})<\/div>/giu),
        ].flatMap(([, attributes, name]) => {
          const appId = attributes.match(/\bdata-ds-appid="([1-9]\d{0,9})"/u)?.[1];
          const linkedId = attributes.match(
            /\bhref="https:\/\/store\.steampowered\.com\/app\/([1-9]\d{0,9})\//u,
          )?.[1];
          return appId && linkedId === appId ? [{ appId, name: decodeTitle(name) }] : [];
        });
      } catch {
        signal.throwIfAborted();
        return [];
      }
    }),
  );
  return matchSteamTitle(title, games.flat());
}

const installLabel =
  /^(?:install|download|установить|установка|скачать|installer|instalar|installieren)$/iu;
const role = (target, suffix) => target.role?.endsWith('.' + suffix);
const unique = ([first, ...others]) => (others.length ? null : (first ?? null));

function steamDownloadAction(view, game, drive) {
  if (!view) return {};
  const targets = view.targets.filter((target) => !target.surface && target.source !== 'vision');
  const equalName = (text) => normalized(text) === normalized(game.name);
  const windowTitle = normalized(view.window.untrustedTitle);
  const dialog =
    view.window.modal ||
    /^(?:install|installation|установка|установить|installer|instalar)(?:\s|:|$)/iu.test(
      windowTitle,
    );
  const confirmedTitle =
    equalName(windowTitle.replace(/^(?:install|установка|установить)\s*[:—–-]?\s*/iu, '')) ||
    targets.some((target) => equalName(target.untrustedLabel));
  const action = unique(
    targets.filter(
      (target) =>
        role(target, 'Button') &&
        installLabel.test(normalized(target.untrustedLabel)) &&
        target.clickKind === 'control' &&
        canClickTarget(target),
    ),
  );
  if (!dialog) {
    const visual = unique(
      view.targets.filter(
        (target) =>
          !target.surface &&
          target.steamRole === 'install' &&
          installLabel.test(normalized(target.untrustedLabel)) &&
          canClickTarget(target),
      ),
    );
    return { open: steamGamePage({ name: game.name }, view) ? (action ?? visual) : null };
  }
  if (!confirmedTitle) return { dialog };
  if (!drive) return { dialog, confirm: action };
  const driveLabels = (target) =>
    [
      ...`${target.untrustedLabel ?? ''} ${target.untrustedValue ?? ''}`.matchAll(
        /(?:^|[\s([\-])([a-z]):(?=[\\/\s)\]]|$)/giu,
      ),
    ].map(([, letter]) => letter.toUpperCase());
  const exactDrive = (target) => {
    const letters = driveLabels(target);
    return letters.length > 0 && letters.every((letter) => letter === drive);
  };
  const options = targets.filter(
    (target) => role(target, 'ListItem') || role(target, 'RadioButton'),
  );
  const pickers = targets.filter(
    (target) => role(target, 'ComboBox') && target.clickKind === 'control',
  );
  const selected = options.filter(
    (target) => target.selected === true && driveLabels(target).length,
  );
  if (selected.length === 1 && exactDrive(selected[0])) return { dialog, confirm: action };
  const picker = unique(pickers);
  if (picker && !selected.length && exactDrive(picker)) return { dialog, confirm: action };
  const option = unique(
    options.filter((target) => target.clickKind === 'control' && exactDrive(target)),
  );
  return { dialog, driveTarget: option ?? picker };
}

export function createSteamGameTask({
  openExternal,
  findClient = windowsSteamExecutable,
  findStoreGame = findSteamStoreGame,
  gameRunning = steamGameProcessRunning,
  launchTimeout = 25_000,
  dialogTimeout = 12_000,
  pollInterval = 500,
}) {
  return async (request, { signal, assertAllowed, observe, click, phase, onAction, onGame }) => {
    signal.throwIfAborted();
    const steam = await findClient(signal);
    const libraries = await readSteamLibraries(steam);
    if (!libraries.length) return { status: 'steam_client_missing' };
    const local = await resolveSteamLibraryGame(steam, request.name, signal, libraries);
    const game =
      local ?? (request.installIfMissing ? await findStoreGame(request.name, signal) : null);
    if (!game || !/^[1-9]\d{0,9}$/u.test(game.appId)) return { status: 'steam_game_not_found' };
    const name = game.name;
    const send = async (uri) => {
      signal.throwIfAborted();
      assertAllowed();
      phase('acting');
      try {
        await openExternal(uri);
      } catch {
        signal.throwIfAborted();
        return false;
      }
      onAction();
      return true;
    };
    const waitFor = async (check, timeout) => {
      const end = performance.now() + timeout;
      do {
        signal.throwIfAborted();
        const result = await check();
        signal.throwIfAborted();
        if (result) return result;
        if (performance.now() < end) await delay(pollInterval, undefined, { signal });
      } while (performance.now() < end);
      return null;
    };
    if (local?.installed) {
      if (await gameRunning(local, signal)) return { status: 'steam_already_running', name };
      if (!(await send('steam://rungameid/' + game.appId)))
        return { status: 'steam_client_unavailable', name };
      phase('verifying');
      const started = await waitFor(() => gameRunning(local, signal), launchTimeout);
      return { status: started ? 'steam_started' : 'steam_launch_unconfirmed', name };
    }
    if (!request.installIfMissing) return { status: 'steam_not_installed', name };

    onGame(name);
    const drive = request.drive;
    const destinations = drive
      ? libraries.filter((library) => driveOf(library) === drive)
      : libraries;
    if (!destinations.length) return { status: 'steam_library_missing', name, drive };
    if (local?.downloading) {
      return {
        status: destinations.includes(local.library)
          ? 'steam_download_started'
          : 'steam_download_other_drive',
        name,
        drive,
      };
    }
    // Navigate to the library item first. The game install URL can choose a
    // default location; it cannot express the owner's requested drive.
    if (!(await send('steam://nav/games/details/' + game.appId)))
      return { status: 'steam_client_unavailable', name };
    const trustedView = async (vision) => {
      const observation = await observe(vision);
      const executable = observation?.executable;
      if (!isSteamClient(executable)) return null;
      const relative = path.relative(path.dirname(steam), executable);
      return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..'
        ? observation.view
        : null;
    };
    let visualAttempts = 0;
    const nextAction = async (allowVision = false) => {
      phase('observing');
      const nativeView = await trustedView(false);
      const action = steamDownloadAction(nativeView, game, drive);
      if (nativeView && allowVision && !action.dialog && !action.open && visualAttempts < 2) {
        visualAttempts++;
        return steamDownloadAction(await trustedView(true), game, drive);
      }
      return action;
    };
    const first = await waitFor(async () => {
      const action = await nextAction(true);
      return action.dialog || action.open ? action : null;
    }, dialogTimeout);
    if (!first) return { status: 'steam_install_unavailable', name, drive };
    if (first.open && !(await click(first.open)))
      return { status: 'steam_install_unavailable', name, drive };
    const usedDriveControls = new Set();
    const confirmed = await waitFor(async () => {
      const { confirm, driveTarget } = await nextAction();
      if (confirm) return click(confirm);
      if (driveTarget) {
        const key = driveTarget.role + ':' + driveTarget.untrustedLabel;
        if (!usedDriveControls.has(key)) {
          usedDriveControls.add(key);
          await click(driveTarget);
        }
      }
      return false;
    }, dialogTimeout);
    if (!confirmed) return { status: 'steam_install_needs_confirmation', name, drive };
    phase('verifying');
    const status = await waitFor(async () => {
      const entries = await Promise.all(
        libraries.map((library) => readSteamManifest(library, game.appId)),
      );
      const receipt = entries.find((entry) => entry && (entry.installed || entry.downloading));
      if (!receipt) return null;
      if (!destinations.includes(receipt.library)) return 'steam_download_other_drive';
      return receipt.installed ? 'steam_installed' : 'steam_download_started';
    }, dialogTimeout);
    return { status: status ?? 'steam_download_unconfirmed', name, drive };
  };
}

export function steamTaskReply({ status, name, drive }, language) {
  const disk = drive ? ` ${drive}:` : '';
  const messages = {
    steam_started: [`Запустила ${name} через Steam.`, `${name} is running.`],
    steam_already_running: [`${name} уже запущена.`, `${name} is already running.`],
    steam_launch_unconfirmed: [
      `Отправила команду запуска ${name}, но окно игры не появилось. Проверь, ждёт ли Steam первого запуска или обновления.`,
      `I sent the launch command for ${name}, but its game window hasn’t appeared. Check Steam for a first-run prompt or update.`,
    ],
    steam_client_missing: [
      'Не удалось найти установленный Steam.',
      'I couldn’t find Steam on this PC.',
    ],
    steam_client_unavailable: [
      'Steam не принял команду. Проверь, открывается ли клиент.',
      'Steam didn’t accept the command. Check that the client opens.',
    ],
    steam_game_not_found: [
      'Не удалось однозначно найти игру. Скажи точное название из библиотеки Steam.',
      'I couldn’t identify the game. Give me the exact title from your Steam library.',
    ],
    steam_not_installed: [
      `Steam ещё не установил ${name}.`,
      `${name} isn’t installed in Steam yet.`,
    ],
    steam_library_missing: [
      `На диске${disk} нет библиотеки Steam. Добавь её через «Настройки → Хранилище».`,
      `Steam has no library on drive${disk}. Add one in Settings → Storage.`,
    ],
    steam_install_unavailable: [
      `Не нашла кнопку установки ${name} в библиотеке. Проверь, доступна ли игра в твоём аккаунте Steam.`,
      `I couldn’t find Install for ${name} in the library. Check that it’s available on your Steam account.`,
    ],
    steam_install_needs_confirmation: [
      `Проверь окно установки ${name}${drive ? `, выбери диск${disk}` : ''} и нажми «Установить».`,
      `Check the install dialog for ${name}${drive ? `, select drive${disk}` : ''}, then click Install.`,
    ],
    steam_download_other_drive: [
      `Steam уже начал установку ${name} на другом диске. Проверь загрузки Steam.`,
      `Steam already has ${name} queued on another drive. Check Steam Downloads.`,
    ],
    steam_download_unconfirmed: [
      `Steam пока не подтвердил загрузку ${name}. Проверь очередь загрузок.`,
      `Steam hasn’t confirmed the download for ${name}. Check Steam Downloads.`,
    ],
    steam_download_started: [
      `Steam начал загрузку ${name}${drive ? ` на диск${disk}` : ''}.`,
      `Steam is downloading ${name}${drive ? ` to drive${disk}` : ''}.`,
    ],
    steam_installed: [
      `Steam установил ${name}${drive ? ` на диск${disk}` : ''}.`,
      `Steam installed ${name}${drive ? ` on drive${disk}` : ''}.`,
    ],
  };
  return messages[status][language === 'ru' ? 0 : 1];
}
