// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readJson, noLinks } from './policy.mjs';
import { fetchArtifact } from './download.mjs';
import { electronBundleReady } from '../../runtime/src/host/electron-bundle.mjs';

/** Electron 45+ installs its npm package without desktop binaries. Never lazy-download on launch. */
export async function ensureElectronRuntime(
  root,
  { command, download = fetchArtifact, emit = () => {} },
) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg.devDependencies?.electron && !pkg.dependencies?.electron) return false;
  const spec = readJson(path.join(root, 'config/installer.json')).artifacts.electron;
  const directory = path.join(root, 'node_modules/electron');
  noLinks(directory);
  if (readJson(path.join(directory, 'package.json')).version !== spec.version)
    throw new Error('The desktop runtime version differs from the pinned installer manifest.');
  const entry = path.join(directory, 'path.txt');
  noLinks(entry);
  if (electronBundleReady(directory, spec.version)) {
    writeFileSync(entry, 'electron.exe');
    return false;
  }
  emit({ phase: 'dependencies', message: 'Restoring the verified Capri desktop runtime…' });
  const cache = path.join(root, '.runtime/installer');
  noLinks(cache);
  const archive = await download(spec, path.join(cache, 'downloads'));
  const parent = path.join(cache, 'staging');
  noLinks(parent);
  mkdirSync(parent, { recursive: true });
  const staged = mkdtempSync(path.join(parent, 'electron-repair-'));
  const dist = path.join(directory, 'dist');
  const previous = path.join(staged, 'previous');
  let installed = false;
  try {
    writeFileSync(path.join(staged, 'package.json'), JSON.stringify({ version: spec.version }));
    await command('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'packages/installer/windows/archive.ps1'),
      '-Archive',
      archive,
      '-Destination',
      path.join(staged, 'dist'),
      '-MaximumBytes',
      String(1024 ** 3),
    ]);
    if (!electronBundleReady(staged, spec.version))
      throw new Error('The downloaded desktop runtime is incomplete. Retry the update.');
    noLinks(dist);
    if (existsSync(dist)) renameSync(dist, previous);
    try {
      renameSync(path.join(staged, 'dist'), dist);
      writeFileSync(entry, 'electron.exe');
      if (!electronBundleReady(directory, spec.version))
        throw new Error('The desktop runtime is incomplete.');
      installed = true;
    } catch (error) {
      if (existsSync(previous)) {
        if (existsSync(dist)) renameSync(dist, path.join(staged, 'failed'));
        renameSync(previous, dist);
      }
      throw error;
    }
    return true;
  } finally {
    // Remove only this freshly allocated staging directory; failed swaps retain recovery bytes.
    if (installed || !existsSync(previous)) {
      if (path.dirname(staged) !== parent) throw new Error('Invalid desktop staging folder.');
      noLinks(staged);
      rmSync(staged, { recursive: true, force: true });
    }
  }
}
