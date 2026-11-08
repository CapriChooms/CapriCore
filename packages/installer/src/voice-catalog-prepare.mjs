// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { noLinks, readJson } from './policy.mjs';
import { fetchArtifact } from './download.mjs';
import { runCommand } from './commands.mjs';
import { validateVoicePack, importVoicePack } from './voice-pack.mjs';
import { processStartedAt } from '../../runtime/src/host/processes.mjs';
import { readVoiceSettings, voiceOverridePath } from '../../runtime/src/voice-settings.mjs';
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

/** Caller owns the installation lock. Prepare only the small runtime and verified voice reference. */
export async function prepareVoiceCatalog({
  root,
  env,
  signal,
  execute = runCommand,
  download = fetchArtifact,
  emit = () => {},
  ownerStamp = () => processStartedAt(process.pid),
} = {}) {
  if (!path.isAbsolute(root)) throw new Error('Voice installation needs an absolute Capri folder.');
  root = path.resolve(root);
  signal?.throwIfAborted();
  const settingsFile = owned(root, 'config/companion-voice.json');
  const base = readJson(settingsFile),
    settings = readVoiceSettings(root);
  const expected = readJson(owned(root, 'config/voice-upstream.json')).model;
  const active = owned(root, settings.profileDir);
  let source,
    activeReady = false;
  try {
    validateVoicePack(active, expected);
    activeReady = true;
  } catch {
    source = [
      'data/voices/capri/en/exports/capri-en-v1',
      'data/speech/bundled-voice',
      '.runtime/installer/bundled-voice',
      '.bundled-voice',
    ]
      .map((relative) => owned(root, relative))
      .find((candidate) => {
        try {
          validateVoicePack(candidate, expected);
          return true;
        } catch {
          return false;
        }
      });
    if (!source)
      throw new Error(
        'The Capri reference voice is missing. Repair with Capri Setup including its voice pack.',
      );
    if (
      base.profileDir !== 'data/voices/capri/en/exports/capri-en-v1' ||
      validateVoicePack(source, expected).profile.id !== 'capri-en-v1'
    )
      throw new Error(
        'Repair the Capri reference voice with its original Setup pack. Existing custom voice settings were preserved.',
      );
  }
  await ensureUv({ root, env, signal, execute, download, emit, ownerStamp });
  signal?.throwIfAborted();
  if (!activeReady) {
    importVoicePack(source, root, expected);
    const override = voiceOverridePath(root, 'companion-voice');
    if (existsSync(override)) unlinkSync(override);
  }
  return { profileDir: activeReady ? settings.profileDir : base.profileDir };
}
