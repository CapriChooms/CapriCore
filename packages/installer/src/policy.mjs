import { voiceGpuSupported } from '../../runtime/src/hardware/voice-gpu.mjs';
// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { MODEL_CHOICES, selectModelChoice } from '../../runtime/src/hardware/model-catalog.mjs';
import { compareVersions } from '../../updater/src/releases.mjs';
import { estimateInstallStorage } from './storage-estimate.mjs';
import voiceCatalog from '../../../config/tts-catalog.json' with { type: 'json' };
import {
  validateLanguages,
  LANGUAGE_DEFAULTS,
  LANGUAGE_PACKS,
} from '../../../apps/desktop/renderer/language-settings.mjs';

export const PRODUCT = 'capri.desktop';
export const identityFile = (root) => path.join(root, '.capri-install.json');
export function readJson(file, maximum = 65536) {
  const bytes = readFileSync(file);
  if (bytes.length > maximum) throw new Error('Installer metadata exceeds its limit');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
export function noLinks(file) {
  let cursor = path.resolve(file);
  while (true) {
    let info;
    try {
      info = lstatSync(cursor);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (info && (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)))
      throw new Error('Installation paths cannot contain filesystem links');
    const parent = path.dirname(cursor);
    if (cursor === parent) break;
    cursor = parent;
  }
}
export function validateTarget(target, sourceRoot, version, { userHome = homedir() } = {}) {
  if (
    typeof target !== 'string' ||
    !path.isAbsolute(target) ||
    /[\x00-\x1f"<>|?*]/.test(target) ||
    /^\\\\/.test(target)
  )
    throw new Error('Choose an absolute local installation folder');
  const resolved = path.resolve(target),
    source = path.resolve(sourceRoot);
  const normalized = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const a = normalized(resolved),
    b = normalized(source);
  const reserved = [
    path.parse(resolved).root,
    userHome,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ]
    .filter(Boolean)
    .map((value) => normalized(path.resolve(value)));
  if (reserved.includes(a) || a === b || b.startsWith(a + path.sep))
    throw new Error('This folder cannot be used as an installation target');
  if (
    a.startsWith(b + path.sep) &&
    !['.runtime', 'release'].some((name) => a.startsWith(b + path.sep + name + path.sep))
  )
    throw new Error('Choose a folder outside the source tree');
  noLinks(resolved);
  if (existsSync(resolved)) {
    if (!lstatSync(resolved).isDirectory())
      throw new Error('Installation target is not a directory');
    if (readdirSync(resolved).length) {
      if (!existsSync(identityFile(resolved)))
        throw new Error('The selected folder contains unrelated files. Choose an empty folder.');
      const identity = readJson(identityFile(resolved));
      if (
        identity.productId !== PRODUCT ||
        identity.schemaVersion !== 1 ||
        normalized(path.resolve(identity.root ?? '.')) !== a ||
        !/^[a-f0-9-]{36}$/.test(identity.installId ?? '')
      )
        throw new Error('Installation identity does not match this folder');
      if (compareVersions(version, identity.version) < 0)
        throw new Error(
          'A newer Capri version is installed. Downgrades require a separate folder.',
        );
    }
  }
  return resolved;
}
export function validateRequest(input, { sourceRoot, version, hardware, freeBytes } = {}) {
  if (
    !input ||
    input.schemaVersion !== 1 ||
    input.acceptLicense !== true ||
    input.acceptDownloads !== true
  )
    throw new Error('License acceptance and download consent are required');
  const target = validateTarget(input.target, sourceRoot, version);
  const inferenceMode = input.inferenceMode === undefined ? 'local' : input.inferenceMode;
  if (!['local', 'api'].includes(inferenceMode)) throw new Error('Invalid language model source');
  const requestedSource = input.modelSource === undefined ? 'catalog' : input.modelSource;
  if (!['catalog', 'huggingface'].includes(requestedSource))
    throw new Error('Invalid language model catalog');
  const modelSource = inferenceMode === 'api' ? 'catalog' : requestedSource;
  const modelSetupRequired = modelSource === 'huggingface';
  const profile = selectModelChoice(
    inferenceMode === 'api' || modelSetupRequired ? 'minimal' : input.profile,
    hardware,
  );
  for (const key of ['recognition', 'downloadModels', 'desktopShortcut', 'startMenuShortcut'])
    if (typeof input[key] !== 'boolean') throw new Error('Invalid installer option: ' + key);
  if (input.router !== undefined && typeof input.router !== 'boolean')
    throw new Error('Invalid installer option: router');
  const languages = validateLanguages({
    ...LANGUAGE_DEFAULTS,
    interface: input.interfaceLanguage,
    conversation: input.conversationLanguage,
    recognition: input.recognition ? 'follow' : 'off',
    speech: 'off',
  });
  const voicePack = input.voicePack ?? '';
  const voiceMode = input.voiceMode ?? (voicePack ? 'custom' : 'off');
  if (!['off', 'bundled', 'custom', 'qwen'].includes(voiceMode))
    throw new Error('Invalid installer voice option');
  const qwen = voiceMode === 'qwen';
  if (
    qwen &&
    !voiceCatalog.models
      .find(({ id }) => id === 'qwen3-tts-0.6b-base')
      .languages.includes(languages.conversation)
  )
    throw new Error('Qwen3-TTS does not support the selected conversation language');
  if (!voicePack && ['bundled', 'custom'].includes(voiceMode))
    throw new Error('Choose a voice pack for the selected voice option');
  if (voicePack && voiceMode === 'off') throw new Error('Turn on voice to install a voice pack');
  if (
    voicePack &&
    !LANGUAGE_PACKS.some((item) => item.id === input.conversationLanguage && item.speechReady)
  )
    throw new Error(
      'The selected conversation language has no supported spoken voice. Leave the voice pack empty for text replies.',
    );
  if (typeof voicePack !== 'string' || (voicePack && !path.isAbsolute(voicePack)))
    throw new Error('Choose an absolute voice-pack folder');
  // The included reference belongs to Setup, independently of the selected
  // synthesis backend. Qwen needs it without selecting the Chatterbox runtime.
  const bundledVoicePack = input.bundledVoicePack ?? '';
  if (
    typeof bundledVoicePack !== 'string' ||
    (bundledVoicePack && !path.isAbsolute(bundledVoicePack))
  )
    throw new Error('The included voice reference needs an absolute folder.');
  if (bundledVoicePack) noLinks(bundledVoicePack);
  if (voicePack && !qwen && !voiceGpuSupported(hardware))
    throw new Error(
      'This voice needs an NVIDIA GPU or a supported AMD ROCm GPU on Windows 11 (experimental).',
    );
  const downloadModels = inferenceMode === 'local' && !modelSetupRequired && input.downloadModels;
  const { requiredBytes } = estimateInstallStorage(
    {
      ...input,
      voiceMode,
      voicePack,
      profile: profile.id,
      inferenceMode,
      modelSource,
      downloadModels,
    },
    {
      hardware,
      rocmVoice:
        voicePack &&
        !qwen &&
        !hardware.gpus?.some((gpu) => /nvidia/i.test(gpu.vendor ?? gpu.name ?? '')),
    },
  );
  if (freeBytes !== undefined) assertDiskSpace(target, freeBytes, requiredBytes);
  return {
    schemaVersion: 1,
    target,
    profile: profile.id,
    inferenceMode,
    modelSource,
    modelSetupRequired,
    languages,
    voiceMode,
    voicePack,
    bundledVoicePack,
    recognition: input.recognition,
    router: true,
    downloadModels,
    desktopShortcut: input.desktopShortcut,
    startMenuShortcut: input.startMenuShortcut,
    requiredBytes,
  };
}
export function diskFree(target) {
  let existing = path.resolve(target);
  while (!existsSync(existing) && path.dirname(existing) !== existing)
    existing = path.dirname(existing);
  const info = statfsSync(existing);
  return info.bavail * info.bsize;
}
export function assertDiskSpace(target, freeBytes, requiredBytes) {
  if (freeBytes >= requiredBytes) return;
  const gib = (bytes) => (bytes / 2 ** 30).toFixed(2) + ' GiB';
  throw Object.assign(
    new Error(
      `Not enough free space on ${path.parse(target).root}. Required: ${gib(requiredBytes)}. Available: ${gib(freeBytes)}.`,
    ),
    { code: 'CAPRI_DISK_SPACE' },
  );
}
export function planFingerprint(plan, lockBytes) {
  return createHash('sha256').update(JSON.stringify(plan)).update(lockBytes).digest('hex');
}
export function profilesAgree(manifest) {
  return (
    manifest.profiles.length === MODEL_CHOICES.length &&
    manifest.profiles.every((item) =>
      MODEL_CHOICES.some(
        (profile) =>
          profile.id === item.id &&
          profile.model === item.model &&
          profile.ramGiB === item.ramGiB &&
          profile.recommendedVramGiB === item.recommendedVramGiB &&
          Boolean(profile.experimental) === Boolean(item.experimental),
      ),
    )
  );
}
