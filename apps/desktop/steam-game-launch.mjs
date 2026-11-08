// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const cyberpunkAppId = '1091500';
const cyberpunkUri = 'steam://rungameid/' + cyberpunkAppId;
const exec = promisify(execFile);
const title = String.raw`(?:cyberpunk|киберпанк)(?:['’]s)?(?:\s+(?:2077|twenty seventy[- ]seven|две тысячи семьдесят семь))?`;
const steam = String.raw`(?:steam|стим[еа]?)`;
const direct = String.raw`(?:launch|start|open|play|turn on|запусти|открой|включи)\s+${title}(?:\s+(?:in|on|via|through|в|через)\s+${steam})?`;
const next = String.raw`(?:and(?: then)?|then|и|потом|затем)`;
const openSteam = String.raw`(?:open|go to|launch|открой|перейди в)\s+${steam}(?:,\s*(?:${next}\s+)?|\s+${next}\s+)`;
const selectAndPlay = String.raw`(?:go to (?:my |the )?library\s+(?:and |then )?)?(?:go to|select|find)\s+${title}\s+and\s+(?:click|press)\s+(?:play|launch)`;
const launchRequest = new RegExp(
  String.raw`^(?:${direct}|${openSteam}(?:${direct}|${selectAndPlay}))$`,
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
      /^(?:(?:use(?:ful)?\s+(?:uh\s+)?(?:my computer|(?:full\s+)?computer access|full access to my (?:pc|computer)))|(?:используй\s+полный доступ к (?:моему )?(?:пк|компьютеру)))\s*(?:(?:,\s*)?then\s+|\s+and\s+|,\s*(?:затем\s+)?|\s+и\s+)/iu,
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

export function steamGameLauncher({ openExternal, readState = cyberpunkSteamState }) {
  return async ({ signal, assertAllowed }) => {
    signal.throwIfAborted();
    const state = await readState(signal);
    signal.throwIfAborted();
    if (state !== 'installed') return state;
    assertAllowed();
    try {
      await openExternal(cyberpunkUri);
    } catch {
      signal.throwIfAborted();
      return 'client-unavailable';
    }
    signal.throwIfAborted();
    return 'submitted';
  };
}
