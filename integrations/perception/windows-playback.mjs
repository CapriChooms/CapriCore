// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const windowId = /^window:([1-9]\d{0,9}):\d{1,10}$/u;
const maxCaptureAgeMs = 4500;
const maxTimelineMs = 7 * 86400000;
const pendingBuilds = new Map();

async function localFile(file) {
  const entry = await lstat(file).catch(() => null);
  return entry?.isFile() === true;
}

function nativeEnvironment(windows, folder) {
  return { SystemRoot: windows, WINDIR: windows, TEMP: folder, TMP: folder };
}

async function build(root) {
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const framework = path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319');
  const gac = path.join(windows, 'Microsoft.NET/assembly/GAC_MSIL');
  const winMetadata = path.join(windows, 'System32/WinMetadata');
  const file = path.join(root, 'integrations/perception/native/MediaPlayback.cs');
  const digest = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  const folder = path.join(root, '.runtime/native-helpers/media-playback', digest.slice(0, 16));
  const executable = path.join(folder, 'Capri.MediaPlayback.exe');
  await mkdir(folder, { recursive: true });
  if (!(await localFile(executable))) {
    const temporary = path.join(folder, randomBytes(8).toString('hex') + '.exe');
    try {
      const facades = await Promise.all(
        ['System.Runtime', 'System.Runtime.InteropServices.WindowsRuntime'].map(async (name) => {
          const directory = path.join(gac, name);
          const versions = await readdir(directory);
          for (const version of versions) {
            const dll = path.join(directory, version, name + '.dll');
            if (await localFile(dll)) return dll;
          }
          throw new Error('Required Windows media reference is unavailable');
        }),
      );
      const references = [
        'System.Web.Extensions.dll',
        path.join(framework, 'System.Runtime.WindowsRuntime.dll'),
        ...facades,
        ...['Foundation', 'Media', 'Storage'].map((name) =>
          path.join(winMetadata, `Windows.${name}.winmd`),
        ),
      ];
      await exec(
        path.join(framework, 'csc.exe'),
        [
          '/nologo',
          '/target:exe',
          '/platform:x64',
          '/optimize+',
          '/out:' + temporary,
          ...references.map((reference) => '/r:' + reference),
          file,
        ],
        {
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 4096,
          env: nativeEnvironment(windows, folder),
        },
      );
      try {
        await rename(temporary, executable);
      } catch (error) {
        if (!(await localFile(executable))) throw error;
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  return { executable, env: nativeEnvironment(windows, folder) };
}

function prepare(root) {
  if (!pendingBuilds.has(root))
    pendingBuilds.set(
      root,
      build(root).catch(() => null),
    );
  return pendingBuilds.get(root);
}

/** Query only the opted-in foreground window, once per scheduled visual sample. */
export function createWindowsPlaybackReader(root) {
  let active = false;
  return async (nativeId, { capturedAt, signal } = {}) => {
    const hwnd = typeof nativeId === 'string' && windowId.exec(nativeId)?.[1];
    const age = Date.now() - capturedAt;
    if (
      process.platform !== 'win32' ||
      active ||
      !hwnd ||
      Number(hwnd) > 0xffffffff ||
      !Number.isSafeInteger(capturedAt) ||
      age < 0 ||
      age > maxCaptureAgeMs ||
      signal?.aborted
    )
      return null;
    active = true;
    try {
      const deadline = AbortSignal.timeout(1900);
      const cancel = signal ? AbortSignal.any([deadline, signal]) : deadline;
      const ready = await new Promise((resolve) => {
        const stop = () => resolve(null);
        cancel.addEventListener('abort', stop, { once: true });
        void prepare(root).then((build) => {
          cancel.removeEventListener('abort', stop);
          resolve(build);
        });
      });
      if (!ready || cancel.aborted || Date.now() - capturedAt > maxCaptureAgeMs) return null;
      const { stdout } = await exec(ready.executable, [hwnd, String(capturedAt)], {
        windowsHide: true,
        signal: cancel,
        timeout: 1500,
        maxBuffer: 2048,
        env: ready.env,
      });
      const value = JSON.parse(stdout);
      if (!value || typeof value.title !== 'string' || !value.title || value.title.length > 180)
        return null;
      const millis = (number) =>
        Number.isSafeInteger(number) && number >= 0 && number <= maxTimelineMs ? number : null;
      const durationMs = millis(value.durationMs) || null;
      const positionMs = millis(value.positionMs);
      return {
        title: value.title,
        durationMs,
        positionMs:
          durationMs !== null && positionMs !== null && positionMs <= durationMs
            ? positionMs
            : null,
      };
    } catch {
      return null;
    } finally {
      active = false;
    }
  };
}
