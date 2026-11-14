// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { canClickTarget, hasVisualEvidence } from './computer-click-target.mjs';

const cyberpunkAppId = '1091500';
const cyberpunkUri = 'steam://rungameid/' + cyberpunkAppId;
const redLauncherPath = /(?:^|[\\/])CD Projekt Red[\\/]REDlauncher[\\/]REDlauncher\.exe$/iu;
const exec = promisify(execFile);
const title = String.raw`(?:cyberpunk|киберпанк)(?:['’]s)?(?:\s+(?:2077|twenty seventy[- ]seven|две тысячи семьдесят семь))?`;
const steam = String.raw`(?:steam|стим[еа]?)`;
const direct = String.raw`(?:launch|start|open|play|turn on|запусти|открой|включи)\s+${title}(?:\s+(?:in|on|via|through|в|через)\s+${steam})?`;
const next = String.raw`(?:and(?: then)?|then|и|потом|затем)`;
const openSteam = String.raw`(?:open|go to|launch|открой|перейди в)\s+(?:(?:the app|приложение|клиент)\s+)?${steam}(?:,\s*(?:${next}\s+)?|\s+${next}\s+)`;
const fromLibrary = String.raw`(?:\s+(?:from (?:my |the )?library|из (?:моей )?библиотеки))?`;
const selectAndPlay = String.raw`(?:go to (?:my |the )?library\s+(?:and |then )?)?(?:go to|select|find)\s+${title}\s+and\s+(?:click|press)\s+(?:play|launch)`;
const launchRequest = new RegExp(
  String.raw`^(?:${direct}|${openSteam}(?:${direct}${fromLibrary}|${selectAndPlay}))$`,
  'iu',
);

// Only an explicit launch of this Steam title may bypass the desktop planner.
// A different game, negation or an additional requested action stays on the normal path.
export function cyberpunkSteamLaunch(goal) {
  const request = String(goal)
    .normalize('NFKC')
    .trim()
    .replace(/^(?:(?:hey\s+)?capri|капри)[,\s:]+/iu, '')
    .replace(/^(?:i need to test your ability\.\s*see,\s*)?i want you to\s+/iu, '')
    .replace(/^(?:can you|could you|можешь|please|пожалуйста)[,\s]+/iu, '')
    .replace(
      /^(?:(?:use(?:ful)?\s+(?:uh\s+)?(?:my computer|(?:full\s+)?computer access|full access to my (?:pc|computer)))|(?:используй\s+(?:полный доступ к (?:моему )?(?:пк|компьютеру)|мой\s+(?:компьютер|пк))))\s*(?:(?:,\s*)?then\s+|\s+and\s+|,\s*(?:затем\s+)?|\s+и\s+)/iu,
      '',
    )
    .replace(/\b(?:uh|um)\s+/giu, '')
    .replace(/[.!?]+$/u, '')
    .replace(/(?:[,\s]+(?:please|пожалуйста))$/iu, '')
    .trim();
  return launchRequest.test(request);
}

async function cyberpunkSteamState(signal) {
  const reg = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  try {
    const { stdout } = await exec(
      reg,
      ['query', 'HKCU\\Software\\Valve\\Steam\\Apps\\' + cyberpunkAppId],
      {
        signal,
        windowsHide: true,
        timeout: 3000,
      },
    );
    if (!/^\s*Installed\s+REG_DWORD\s+0x1\s*$/imu.test(stdout)) return 'not-installed';
    return /^\s*Running\s+REG_DWORD\s+0x1\s*$/imu.test(stdout) ? 'running' : 'installed';
  } catch (error) {
    signal.throwIfAborted();
    return error.code === 1 ? 'not-installed' : 'unavailable';
  }
}

async function cyberpunkProcessRunning(signal) {
  const tasklist = path.win32.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'tasklist.exe',
  );
  try {
    const { stdout } = await exec(
      tasklist,
      ['/FI', 'IMAGENAME eq Cyberpunk2077.exe', '/FO', 'CSV', '/NH'],
      {
        signal,
        windowsHide: true,
        timeout: 2500,
      },
    );
    return /^"Cyberpunk2077\.exe","[1-9]\d*",/imu.test(stdout);
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

export function isCyberpunkLauncherWindow(identity) {
  return redLauncherPath.test(identity?.executable ?? '');
}

export function cyberpunkLauncherTarget(view, identity) {
  if (
    !isCyberpunkLauncherWindow(identity) ||
    !view.targets.some(
      (target) => !target.surface && /^Cyberpunk 2077$/iu.test(target.untrustedLabel?.trim() ?? ''),
    )
  )
    return null;
  const buttons = view.targets.filter(
    (target) =>
      !target.surface &&
      !target.editable &&
      canClickTarget(target, { exact: !view.screenAvailable }) &&
      /^(?:Play|Играть|Jouer|Spielen|Jugar|Jogar|Gioca|Graj|プレイ|开始游戏|開始遊戲|플레이)$/iu.test(
        target.untrustedLabel?.trim() ?? '',
      ),
  );
  const visual = buttons.filter(hasVisualEvidence);
  const candidates = visual.length ? visual : buttons;
  return candidates.length === 1 ? candidates[0] : null;
}

async function installedRedLauncher(signal) {
  if (!process.env.LOCALAPPDATA) return null;
  const file = path.win32.join(
    process.env.LOCALAPPDATA,
    'Programs/CD Projekt Red/REDlauncher/REDlauncher.exe',
  );
  const powershell = path.win32.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const script = String.raw`
    $env:PSModulePath = Join-Path $PSHOME 'Modules'
    $launcher = Get-Process -Name REDlauncher -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $env:CAPRI_REDLAUNCHER_CANDIDATE -and $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1
    if ($launcher) {
      $signature = Get-AuthenticodeSignature -LiteralPath $launcher.Path
      if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match '(?i)(^|,\s*)CN=CD PROJEKT RED S\.A\.(,|$)') {
        [Console]::Out.Write($launcher.MainWindowHandle.ToInt64())
      }
    }`;
  try {
    const { stdout } = await exec(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...process.env, CAPRI_REDLAUNCHER_CANDIDATE: file },
        signal,
        windowsHide: true,
        timeout: 4000,
      },
    );
    const windowId = stdout.trim();
    return /^[1-9]\d{0,18}$/.test(windowId) ? { executable: file, windowId } : null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

export function steamGameLauncher({
  openExternal,
  readState = cyberpunkSteamState,
  isRunning = cyberpunkProcessRunning,
  findLauncher = installedRedLauncher,
}) {
  return async ({ signal, assertAllowed, confirm }) => {
    signal.throwIfAborted();
    const state = await readState(signal);
    signal.throwIfAborted();
    if (state !== 'installed' && state !== 'running') return state;
    if (await isRunning(signal)) return 'running';
    if (state === 'installed') {
      assertAllowed();
      try {
        await openExternal(cyberpunkUri);
      } catch {
        signal.throwIfAborted();
        return 'client-unavailable';
      }
    }
    signal.throwIfAborted();
    return confirm({
      isRunning: () => isRunning(signal),
      findLauncher: () => findLauncher(signal),
    });
  };
}

export async function confirmCyberpunkLaunch({
  signal,
  isRunning,
  observe,
  click,
  timeoutMs = 12_000,
}) {
  let until = performance.now() + timeoutMs;
  let pressed = false;
  let attempts = 0;
  do {
    signal.throwIfAborted();
    if (await isRunning()) return 'started';
    if (!pressed && attempts < 2) {
      const target = await observe();
      if (target) {
        attempts++;
        try {
          pressed = (await click(target))?.ok === true;
          if (pressed) until = performance.now() + Math.max(timeoutMs, 25_000);
        } catch (error) {
          signal.throwIfAborted();
          if (error.inputPerformed !== false) throw error;
        }
      }
    }
    await delay(600, undefined, { signal });
  } while (performance.now() < until);
  return 'unconfirmed';
}
