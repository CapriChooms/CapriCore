// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readJson, noLinks, identityFile, diskFree } from '../../installer/src/policy.mjs';
import { updateSourcePath, updatePayloadFiles, installerRequired } from './payload-policy.mjs';
import { installationLock } from '../../installer/src/lock.mjs';
import { runCommand } from '../../installer/src/commands.mjs';
import { installNpmDependencies } from '../../installer/src/npm-install.mjs';
import { ensureElectronRuntime } from '../../installer/src/electron-runtime.mjs';
import { npmInstallRequired } from './npm-policy.mjs';
import { writeJsonAtomic } from '../../runtime/src/atomic-json.mjs';
import {
  compareVersions,
  parseVersion,
  REPOSITORY,
  LEGACY_PREVIEW_TAG,
  LEGACY_PREVIEW_VERSION,
} from './releases.mjs';

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** E1's released installer and source archive both used an unsuffixed tag. */
export function installedUpdateVersion(root, tag) {
  if (tag !== LEGACY_PREVIEW_TAG) return tag;
  const main = path.join(root, 'apps/desktop/main.mjs');
  try {
    noLinks(main);
    const info = statSync(main);
    if (
      info.isFile() &&
      info.size === 303663 &&
      hash(main) === '2080df1ceecbe4e3a09a3f0007f4c9c6393760e647a9b9a1bd093dc2b4122083'
    )
      return LEGACY_PREVIEW_VERSION;
  } catch {
    // An unverified installation keeps its recorded version.
  }
  return tag;
}
const supportFile =
  /^(?:[^/]+\.cmd|README\.md|ROADMAP\.md|CONTRIBUTING\.md|SECURITY\.md|LICENSE|THIRD_PARTY_NOTICES\.md)$/i;
const mutable = new Set([
  'config/companion-voice.json',
  'config/companion-asr.json',
  'config/voice-training.json',
  'config/request-router.json',
]);
function sourcePath(name) {
  return updateSourcePath(name);
}
export function managedInstallation(root) {
  if (!path.isAbsolute(root)) throw new Error('An absolute installation folder is required');
  root = path.resolve(root);
  noLinks(root);
  if (existsSync(path.join(root, '.git')))
    throw new Error(
      'Development checkout: download the installer to update a separate installation.',
    );
  const identity = readJson(identityFile(root));
  if (
    identity.schemaVersion !== 1 ||
    identity.productId !== 'capri.desktop' ||
    typeof identity.root !== 'string' ||
    path.resolve(identity.root).toLowerCase() !== root.toLowerCase() ||
    !/^[a-f0-9-]{36}$/.test(identity.installId ?? '')
  )
    throw new Error('Invalid managed installation');
  parseVersion(identity.version);
  return identity;
}
export function verifyPayload(source, tag) {
  noLinks(source);
  const manifest = readJson(path.join(source, 'SOURCE_MANIFEST.json'), 2 * 1024 ** 2);
  if (
    manifest?.schemaVersion !== 1 &&
    Number.isSafeInteger(manifest?.schemaVersion) &&
    manifest.schemaVersion > 1
  )
    throw installerRequired('manifest_schema');
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 10000
  )
    throw new Error('Invalid source update manifest');
  const actual = new Set(updatePayloadFiles(source));
  const seen = new Set();
  let total = 0;
  let needsInstaller = false;
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file))
      throw new Error('Invalid source update manifest entry');
    const key = typeof file.path === 'string' ? file.path.toLowerCase() : '';
    if (seen.has(key)) throw new Error('Invalid source update manifest entry');
    try {
      sourcePath(file.path);
    } catch (error) {
      if (error.code !== 'UPDATE_INSTALLER_REQUIRED') throw error;
      needsInstaller = true;
    }
    noLinks(path.join(source, file.path));
    if (
      seen.has(key) ||
      !actual.delete(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '') ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > 20 * 1024 ** 2
    )
      throw new Error('Invalid source update manifest entry');
    seen.add(key);
    total += file.bytes;
    const target = path.join(source, file.path),
      info = statSync(target);
    if (!info.isFile() || info.size !== file.bytes || hash(target) !== file.sha256)
      throw new Error('Update source checksum verification failed');
  }
  if (actual.size || total > 512 * 1024 ** 2)
    throw new Error('Update payload differs from its manifest');
  const release = readJson(path.join(source, 'config/release.json'));
  if (
    release.schemaVersion !== 1 ||
    release.repository !== REPOSITORY ||
    release.tag !== tag ||
    readJson(path.join(source, 'package.json')).version !== parseVersion(tag).version
  )
    throw new Error('Update release identity does not match GitHub');
  for (const name of [
    'package.json',
    'package-lock.json',
    'config/release.json',
    'packages/installer/windows/register.ps1',
  ])
    if (!manifest.files.some((file) => file.path === name))
      throw new Error('Update is missing required source files');
  if (needsInstaller) throw installerRequired('unsupported_source_path');
  return manifest.files;
}
function replaceFile(source, target) {
  noLinks(target);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + randomUUID() + '.update';
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function backupPath(name) {
  if (
    name === '.capri-install.json' ||
    name === 'Capri.exe' ||
    name === 'uninstall.exe' ||
    name === '.runtime/installer/source-files.json'
  )
    return name;
  if (typeof name === 'string' && name.startsWith('Support/') && supportFile.test(name.slice(8))) {
    sourcePath(name.slice(8));
    return name;
  }
  return sourcePath(name);
}
export function runtimeUpgradeRequired(root, source) {
  const before = readJson(path.join(root, 'config/installer.json'));
  const after = readJson(path.join(source, 'config/installer.json'));
  return ['node', 'ollama', 'llama', 'uv', 'git', 'electron'].some(
    (name) => before.artifacts[name]?.sha256 !== after.artifacts[name]?.sha256,
  );
}
function restore(root, backup, journal) {
  for (const item of [...journal.entries].reverse()) {
    const name = backupPath(item.path),
      target = path.join(root, name);
    noLinks(target);
    if (item.existed) {
      const saved = path.join(backup, 'files', name);
      noLinks(saved);
      if (hash(saved) !== item.sha256) throw new Error('The update backup failed verification');
      replaceFile(saved, target);
    } else if (existsSync(target)) unlinkSync(target);
  }
}
/** A failed/interrupted update restores owned source files. Private data is never a transaction target. */
export async function applyUpdate(
  { root, source, tag },
  { execute = runCommand, emit = () => {}, register = true } = {},
) {
  root = path.resolve(root);
  source = path.resolve(source);
  const identity = managedInstallation(root);
  const files = verifyPayload(source, tag);
  const updateRoot = path.join(root, '.runtime/updates');
  noLinks(updateRoot);
  mkdirSync(updateRoot, { recursive: true });
  const cache = path.join(root, '.runtime/installer');
  noLinks(cache);
  mkdirSync(cache, { recursive: true });
  const releaseLock = installationLock(cache);
  let journal, backup;
  const active = path.join(updateRoot, 'active.json');
  noLinks(active);
  const env = {
    ...process.env,
    CAPRI_NODE_PATH: process.execPath,
    npm_config_cache: path.join(root, '.runtime/npm-cache'),
    PATH: [path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ''].join(
      path.delimiter,
    ),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  for (const key of [
    'CAPRI_PROJECT_ROOT',
    'OPENCLAW_STATE_DIR',
    'OPENCLAW_CONFIG_PATH',
    'OPENCLAW_WORKSPACE_DIR',
    'OPENCLAW_GATEWAY_TOKEN',
    'NODE_OPTIONS',
    'NODE_PATH',
    'PYTHONPATH',
    'UV_INDEX',
    'UV_EXTRA_INDEX_URL',
    'UV_INDEX_URL',
    'UV_DEFAULT_INDEX',
    'UV_FIND_LINKS',
    'UV_NO_INDEX',
    'UV_INDEX_STRATEGY',
  ])
    delete env[key];
  const command = (file, args) =>
    execute(file, args, { cwd: root, env, timeoutMs: 60 * 60 * 1000 });
  const ps = (script, args = []) =>
    command('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, script),
      ...args,
    ]);
  let dependenciesStarted = false;
  let npmChanged = false;
  const syncDependencies = async (changed, { forceNpm = false } = {}) => {
    if (forceNpm || npmChanged) {
      emit({ phase: 'dependencies' });
      await installNpmDependencies({
        nodeExecutable: process.execPath,
        command,
        root,
        onRecovery: (message) => emit({ phase: 'dependencies', message }),
        onRetry: ({ attempt, attempts, delayMs, code }) =>
          emit({
            phase: 'dependencies',
            message: `npm connection interrupted (${code}). Retrying ${attempt}/${attempts} in ${delayMs / 1000}s; cached packages will be reused.`,
          }),
      });
    } else {
      // Apply reviewed compatibility fixes even when the dependency lock is unchanged.
      await command(process.execPath, [path.join(root, 'packages/runtime/bin/patch-openclaw.mjs')]);
    }
    await ensureElectronRuntime(root, { command, emit });
    const uv = path.join(root, '.runtime/uv/uv.exe');
    for (const [lock, venv] of [
      ['config/asr-requirements.lock.txt', 'asr-venv'],
      ['config/router-requirements.lock.txt', 'router-venv'],
    ]) {
      const python = path.join(root, '.runtime', venv, 'Scripts/python.exe');
      if (changed.has(lock) && existsSync(python)) {
        emit({ phase: 'dependencies' });
        await command(uv, [
          'pip',
          'sync',
          '--python',
          python,
          path.join(root, lock),
          '--default-index',
          'https://pypi.org/simple',
        ]);
      }
    }
    if (
      [
        'config/requirements-voice-training.lock',
        'config/requirements-voice-blackwell.lock',
        'config/voice-blackwell-overrides.txt',
        'config/voice-runtime.json',
        'tools/setup/setup-voice-training.ps1',
        'tools/setup/select-voice-runtime.py',
      ].some((file) => changed.has(file)) &&
      existsSync(path.join(root, '.runtime/voice-training-venv/Scripts/python.exe'))
    )
      await ps('tools/setup/setup-voice-training.ps1', ['-DependenciesOnly']);
  };
  try {
    if (existsSync(active)) {
      const pending = readJson(active);
      if (pending.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(pending.id ?? ''))
        throw new Error('Invalid interrupted update receipt');
      const saved = path.join(updateRoot, 'backups', pending.id);
      noLinks(saved);
      const previous = readJson(path.join(saved, 'journal.json'), 2 * 1024 ** 2);
      if (previous.phase !== 'complete' && previous.phase !== 'rolled-back') {
        emit({ phase: 'recovering' });
        restore(root, saved, previous);
        if (previous.dependenciesStarted)
          await syncDependencies(new Set([...previous.changed, 'package-lock.json']), {
            forceNpm: previous.npmDependenciesChanged !== false,
          });
        previous.phase = 'rolled-back';
        writeJsonAtomic(path.join(saved, 'journal.json'), previous);
      }
      unlinkSync(active);
    }
    const installedTag = existsSync(path.join(root, 'config/release.json'))
      ? readJson(path.join(root, 'config/release.json')).tag
      : 'v' + identity.version + '-0';
    const nextVersion = installedUpdateVersion(source, tag);
    const currentVersion = installedUpdateVersion(root, installedTag);
    if (compareVersions(nextVersion, currentVersion) <= 0)
      throw new Error('This release is already installed or is older.');
    // Runtime replacement requires the full installation wizard; never replace the running Node binary.
    if (runtimeUpgradeRequired(root, source))
      throw new Error(
        'This release changes bundled runtimes. Use its full installer to upgrade this installation.',
      );
    npmChanged = npmInstallRequired(root, source);
    const changed = new Set(
      files
        .filter(
          (file) =>
            !existsSync(path.join(root, file.path)) ||
            hash(path.join(root, file.path)) !== file.sha256,
        )
        .map((file) => file.path),
    );
    const updates = files.filter(
      (file) =>
        changed.has(file.path) &&
        !(mutable.has(file.path) && existsSync(path.join(root, file.path))),
    );
    const needed =
      updates.reduce((sum, file) => sum + file.bytes * 2, 0) +
      (npmChanged ? 2 * 1024 ** 3 : 64 * 1024 ** 2);
    if (diskFree(root) < needed)
      throw new Error('Not enough free space for the update and its backup.');
    const id = randomUUID();
    backup = path.join(updateRoot, 'backups', id);
    mkdirSync(backup, { recursive: true });
    journal = {
      schemaVersion: 1,
      id,
      tag,
      phase: 'backing-up',
      changed: [...changed],
      dependenciesStarted: false,
      npmDependenciesChanged: npmChanged,
      entries: [],
    };
    const owned = [
      ...updates.map((file) => file.path),
      ...(register
        ? files.filter((file) => supportFile.test(file.path)).map((file) => 'Support/' + file.path)
        : []),
      '.capri-install.json',
      '.runtime/installer/source-files.json',
      'Capri.exe',
      'uninstall.exe',
    ];
    for (const name of owned) {
      const target = path.join(root, name);
      noLinks(target);
      const existed = existsSync(target),
        saved = path.join(backup, 'files', name);
      if (existed) {
        mkdirSync(path.dirname(saved), { recursive: true });
        copyFileSync(target, saved);
      }
      journal.entries.push({ path: name, existed, ...(existed ? { sha256: hash(saved) } : {}) });
    }
    writeJsonAtomic(path.join(backup, 'journal.json'), journal);
    writeJsonAtomic(active, { schemaVersion: 1, id });
    emit({ phase: 'installing' });
    journal.phase = 'installing';
    writeJsonAtomic(path.join(backup, 'journal.json'), journal);
    for (const file of updates)
      replaceFile(path.join(source, file.path), path.join(root, file.path));
    dependenciesStarted = true;
    journal.dependenciesStarted = true;
    writeJsonAtomic(path.join(backup, 'journal.json'), journal);
    await syncDependencies(changed);
    writeJsonAtomic(identityFile(root), {
      ...identity,
      version: parseVersion(tag).version,
      releaseTag: tag,
    });
    // Keep the previous owned-file list as well: a later uninstall may remove old source, but not private files.
    const receipt = path.join(cache, 'source-files.json');
    const old = existsSync(receipt) ? (readJson(receipt, 2 * 1024 ** 2).files ?? []) : [];
    const all = new Map(old.map((item) => [item.path, item]));
    for (const item of files) all.set(item.path, item);
    writeJsonAtomic(receipt, { files: [...all.values()] });
    if (register) {
      emit({ phase: 'registering' });
      const registration = path.join(cache, 'registration.json');
      const links = existsSync(registration) ? (readJson(registration).shortcuts ?? []) : [];
      await ps('packages/installer/windows/register.ps1', [
        '-InstallRoot',
        root,
        ...(links.some((file) => /Desktop/i.test(file)) ? ['-DesktopShortcut'] : []),
        ...(links.some((file) => /Programs|Start Menu/i.test(file)) ? ['-StartMenuShortcut'] : []),
      ]);
    }
    journal.phase = 'complete';
    writeJsonAtomic(path.join(backup, 'journal.json'), journal);
    unlinkSync(active);
    emit({ phase: 'complete' });
    return { tag, backup, changed: updates.length };
  } catch (error) {
    if (journal && backup && journal.phase !== 'complete') {
      emit({ phase: 'recovering' });
      try {
        restore(root, backup, journal);
        if (dependenciesStarted)
          await syncDependencies(new Set([...journal.changed, 'package-lock.json']), {
            forceNpm: journal.npmDependenciesChanged !== false,
          });
        journal.phase = 'rolled-back';
        writeJsonAtomic(path.join(backup, 'journal.json'), journal);
        if (existsSync(active)) unlinkSync(active);
      } catch {
        throw new Error(
          'Update failed and automatic recovery could not finish. Keep this folder and run the previous installer to repair it.',
        );
      }
      throw new Error(
        'The update failed. Previous source files were restored. Try again or use the full installer.',
      );
    }
    throw error;
  } finally {
    releaseLock();
  }
}
