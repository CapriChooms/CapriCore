// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const ELECTRON_RUNTIME_FILES = [
  'electron.exe',
  'icudtl.dat',
  'resources.pak',
  'v8_context_snapshot.bin',
  'locales/en-US.pak',
];

const framework = 'Electron.app/Contents/Frameworks/Electron Framework.framework';
const macRuntimeFiles = [
  'Electron.app/Contents/MacOS/Electron',
  'Electron.app/Contents/Info.plist',
  framework + '/Electron Framework',
  framework + '/Resources/icudtl.dat',
  framework + '/Resources/resources.pak',
  framework + '/Resources/v8_context_snapshot.arm64.bin',
];

export function sourceElectronExecutable(packageDirectory, platform) {
  const name =
    platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : platform === 'linux'
        ? 'electron'
        : 'electron.exe';
  return path.join(packageDirectory, 'dist', name);
}

/** Inspect without requiring Electron: recent versions download lazily on require(). */
export function electronBundleReady(packageDirectory, expectedVersion, platform = 'win32') {
  try {
    const version = JSON.parse(
      readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
    ).version;
    if (!version || (expectedVersion && version !== expectedVersion)) return false;
    if (
      readFileSync(path.join(packageDirectory, 'dist/version'), 'utf8').trim().replace(/^v/, '') !==
      version
    )
      return false;
    const files = platform === 'darwin' ? macRuntimeFiles : ELECTRON_RUNTIME_FILES;
    return files.every((name) => {
      const file =
        name === 'electron.exe'
          ? sourceElectronExecutable(packageDirectory, platform)
          : path.join(packageDirectory, 'dist', name);
      const entry = statSync(file);
      return entry.isFile() && entry.size > 0;
    });
  } catch {
    return false;
  }
}
