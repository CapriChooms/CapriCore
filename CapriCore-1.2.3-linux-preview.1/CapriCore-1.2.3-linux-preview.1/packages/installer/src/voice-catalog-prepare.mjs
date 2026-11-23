// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdirSync, mkdtempDisposableSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { noLinks, readJson } from './policy.mjs';
import { fetchArtifact } from './download.mjs';
import { runCommand } from './commands.mjs';
import {
  BUNDLED_VOICE_LOCATIONS,
  BUNDLED_VOICE_PROFILE,
  importVoicePack,
  isBundledVoiceProfile,
  validateVoicePack,
} from './voice-pack.mjs';
import { processStartedAt } from '../../runtime/src/host/processes.mjs';
import { readVoiceSettings, voiceOverridePath } from '../../runtime/src/voice-settings.mjs';
import { writeJsonAtomic } from '../../runtime/src/atomic-json.mjs';
import { ensureUv } from './uv-runtime.mjs';

function owned(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /[:\x00-\x1f]/.test(relative))
    throw new Error('The voice profile must stay inside Capri.');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep))
    throw new Error('The voice profile must stay inside Capri.');
  noLinks(file);
  return file;
}

function referenceProfile(folder, expected) {
  try {
    const { profile } = validateVoicePack(folder, expected);
    return profile.references?.neutral ? profile : null;
  } catch {
    return null;
  }
}

function restoreBundledReference(source, root, expected) {
  const destination = owned(root, BUNDLED_VOICE_PROFILE);
  if (source === destination) return;
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true });
  using staging = mkdtempDisposableSync(path.join(parent, 'voice-repair-'));
  const next = path.join(staging.path, importVoicePack(source, staging.path, expected));
  if (!existsSync(destination)) {
    renameSync(next, destination);
    return;
  }
  // Keep the old export, including any files we did not create.
  const backup = destination + '.backup-' + path.basename(staging.path);
  renameSync(destination, backup);
  try {
    renameSync(next, destination);
  } catch (error) {
    renameSync(backup, destination);
    throw error;
  }
}

/** Caller owns the installation lock. Prepare only the small runtime and verified voice reference. */
export async function prepareVoiceCatalog({
  root,
  env,
  signal,
  pauseFile,
  execute = runCommand,
  download = fetchArtifact,
  onReferenceDownload = () => {},
  emit = () => {},
  ownerStamp = () => processStartedAt(process.pid),
} = {}) {
  if (!path.isAbsolute(root)) throw new Error('Voice installation needs an absolute Capri folder.');
  root = path.resolve(root);
  signal?.throwIfAborted();
  const settingsFile = owned(root, 'config/companion-voice.json');
  const base = readJson(settingsFile),
    settings = readVoiceSettings(root);
  const { model: expected, bundledPack } = readJson(owned(root, 'config/voice-upstream.json'));
  const active = owned(root, settings.profileDir);
  const activeReady = Boolean(referenceProfile(active, expected));
  let profileDir = base.profileDir;
  let source;
  if (!activeReady) {
    if (!isBundledVoiceProfile(profileDir))
      throw new Error(
        'Repair the Capri reference voice with its original Setup pack. Existing custom voice settings were preserved.',
      );
    const referenceLocations =
      profileDir === BUNDLED_VOICE_PROFILE
        ? BUNDLED_VOICE_LOCATIONS
        : [...BUNDLED_VOICE_LOCATIONS.slice(1), BUNDLED_VOICE_PROFILE];
    source = referenceLocations
      .map((relative) => path.join(root, relative))
      .find((candidate) => referenceProfile(candidate, expected)?.id === 'capri-en-v1');
  }
  using recovered =
    !activeReady && !source
      ? mkdtempDisposableSync(owned(root, '.runtime/installer/voice-reference-'))
      : null;
  if (recovered) {
    try {
      const archive = await download(bundledPack, owned(root, '.runtime/installer/downloads'), {
        signal,
        pauseFile,
        progress: onReferenceDownload,
      });
      signal?.throwIfAborted();
      await execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          owned(root, 'packages/installer/windows/archive.ps1'),
          '-Archive',
          archive,
          '-Destination',
          recovered.path,
          '-MaximumBytes',
          String(32 * 1024 ** 2),
        ],
        { cwd: root, env, signal, timeoutMs: 2 * 60 * 1000 },
      );
      signal?.throwIfAborted();
      if (referenceProfile(recovered.path, expected)?.id !== 'capri-en-v1')
        throw new Error('The downloaded voice pack failed verification.');
      source = recovered.path;
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error('Could not restore the Capri reference voice: ' + error.message, {
        cause: error,
      });
    }
  }
  await ensureUv({ root, env, signal, execute, download, emit, ownerStamp });
  signal?.throwIfAborted();
  if (!activeReady) {
    if (profileDir === BUNDLED_VOICE_PROFILE) {
      restoreBundledReference(source, root, expected);
    } else {
      profileDir = importVoicePack(source, root, expected, { bundled: true });
      if (profileDir !== base.profileDir) writeJsonAtomic(settingsFile, { ...base, profileDir });
    }
    const override = voiceOverridePath(root, 'companion-voice');
    if (existsSync(override)) unlinkSync(override);
  }
  return { profileDir: activeReady ? settings.profileDir : profileDir };
}
