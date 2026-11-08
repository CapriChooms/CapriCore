import { voiceGpuSupported } from '../../runtime/src/hardware/voice-gpu.mjs';
// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { LANGUAGE_PACKS } from '../../../apps/desktop/renderer/language-settings.mjs';
import {
  speechModelsInstalled,
  recognitionModelsInstalled,
} from '../../../apps/desktop/language-models.mjs';
import { noLinks, readJson, diskFree, assertDiskSpace } from './policy.mjs';
import { estimateSpeechStorage } from './storage-estimate.mjs';
import { runCommand } from './commands.mjs';
import { fetchArtifact, fileHash } from './download.mjs';
import { installationLock } from './lock.mjs';
import { validateVoicePack, importVoicePack } from './voice-pack.mjs';
import { writeJsonAtomic } from '../../runtime/src/atomic-json.mjs';
import { probeHardware } from '../../runtime/src/hardware/probe.mjs';
import { listReleases, githubCredential } from '../../updater/src/github.mjs';
import { downloadUpdate } from '../../updater/src/download.mjs';
import { compareVersions } from '../../updater/src/releases.mjs';
import { processStartedAt } from '../../runtime/src/host/processes.mjs';

export const SPEECH_GPU_UNSUPPORTED =
  'Voice needs NVIDIA CUDA or a supported AMD ROCm GPU on Windows 11 (experimental). This PC can still use text replies and microphone recognition. Integrated graphics and Intel voice acceleration are not supported.';

export function speechComponentSelection(value) {
  if (
    !value ||
    Object.keys(value).some((key) => !['speech', 'recognition'].includes(key)) ||
    !['off', ...LANGUAGE_PACKS.filter((p) => p.speechReady).map((p) => p.id)].includes(
      value.speech,
    ) ||
    !['off', 'auto', 'auto-europe', ...LANGUAGE_PACKS.map((p) => p.id)].includes(
      value.recognition,
    ) ||
    (value.speech === 'off' && value.recognition === 'off')
  )
    throw new Error('Choose a supported voice or recognition language.');
  return { speech: value.speech, recognition: value.recognition };
}

/** Only the named voice attachment from an actual stable Capri release is accepted. */
export function speechPackAsset(releases, tag) {
  const choices = releases
    .filter((r) => {
      try {
        return !r.draft && !r.prerelease && compareVersions(r.tag_name, tag) <= 0;
      } catch {
        return false;
      }
    })
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  for (const release of choices) {
    const asset = release.assets?.find(
      (a) => a.name === 'capri-en-v1.zip' && a.state === 'uploaded',
    );
    if (
      asset &&
      Number.isSafeInteger(asset.id) &&
      asset.id > 0 &&
      Number.isSafeInteger(asset.size) &&
      asset.size > 0 &&
      asset.size <= 200 * 1024 ** 2 &&
      /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')
    )
      return { id: asset.id, bytes: asset.size, sha256: asset.digest.slice(7), name: asset.name };
  }
  throw new Error(
    'The included Capri voice pack is unavailable. Use Capri Setup with its included voice pack.',
  );
}

/** Component-only repair: no source replacement, npm install, model pull or user-language mutation. */
export async function installSpeechComponents(
  selection,
  {
    root,
    node,
    signal,
    emit = () => {},
    execute = runCommand,
    download = fetchArtifact,
    hardware = probeHardware,
    free = diskFree,
    credential = githubCredential,
    releases = listReleases,
    downloadPack = downloadUpdate,
    voiceReady = speechModelsInstalled,
    recognitionReady = recognitionModelsInstalled,
    ownerStamp = () => processStartedAt(process.pid),
  } = {},
) {
  selection = speechComponentSelection(selection);
  if (!path.isAbsolute(root))
    throw new Error('Speech installation requires an absolute Capri folder.');
  signal?.throwIfAborted();
  const cache = path.join(root, '.runtime/installer');
  noLinks(cache);
  mkdirSync(cache, { recursive: true });
  const unlock = installationLock(cache);
  let stage = 'checking';
  const report = (patch) => emit({ stage, ...patch });
  try {
    const config = readJson(path.join(root, 'config/companion-asr.json'));
    const needVoice = selection.speech !== 'off' && !voiceReady(root, selection.speech);
    const needAsr =
      selection.recognition !== 'off' && !recognitionReady(root, selection.recognition, config);
    if (!needVoice && !needAsr) return;
    let rocmVoice = false;
    if (needVoice) {
      const detected = await hardware();
      signal?.throwIfAborted();
      if (!voiceGpuSupported(detected))
        throw Object.assign(new Error(SPEECH_GPU_UNSUPPORTED), {
          code: 'CAPRI_VOICE_GPU_UNSUPPORTED',
        });
      rocmVoice = !detected.gpus?.some((gpu) => /nvidia/i.test(gpu.vendor ?? gpu.name ?? ''));
    }
    const { requiredBytes } = estimateSpeechStorage(
      {
        speechLanguage: needVoice ? selection.speech : 'off',
        recognition: needAsr ? selection.recognition : 'off',
      },
      { rocmVoice },
    );
    assertDiskSpace(root, free(root), requiredBytes);
    const env = {
      ...process.env,
      PATH: [
        path.dirname(node),
        path.join(root, '.runtime/uv'),
        path.join(root, '.runtime/git/cmd'),
        process.env.PATH ?? process.env.Path ?? '',
      ].join(path.delimiter),
      UV_NO_CONFIG: '1',
      UV_CACHE_DIR: path.join(root, '.runtime/uv-cache'),
      TEMP: path.join(root, '.runtime/tmp'),
      TMP: path.join(root, '.runtime/tmp'),
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    for (const name of [
      'NODE_OPTIONS',
      'NODE_PATH',
      'PYTHONPATH',
      'CAPRI_INSTALL_PAUSE_FILE',
      'CAPRI_DESKTOP_VERIFICATION_DIR',
    ])
      delete env[name];
    noLinks(env.TEMP);
    mkdirSync(env.TEMP, { recursive: true });
    const stamp = ownerStamp();
    if (!/^[0-9]+$/.test(stamp ?? ''))
      throw new Error('The speech installer owner could not be verified. Restart Capri and retry.');
    const scripts = {
      'packages/installer/windows/archive.ps1': 'archive',
      'tools/setup/setup-voice-training.ps1': 'voice',
      'tools/setup/setup-multilingual-voice.ps1': 'multilingual',
      'tools/setup/setup-streaming-asr.ps1': 'recognition-en',
      'tools/setup/setup-multilingual-asr.ps1': 'recognition-multi',
      'tools/setup/setup-fast-multilingual-asr.ps1': 'recognition-fast-multi',
    };
    const ps = (name, args = []) =>
      execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'tools/setup/owned-speech.ps1'),
          '-Component',
          scripts[name],
          '-OwnerPid',
          String(process.pid),
          '-OwnerStamp',
          stamp,
          '-ArgumentsBase64',
          Buffer.from(JSON.stringify(args), 'utf8').toString('base64'),
        ],
        {
          cwd: root,
          env,
          signal,
          output: (message) => report({ message }),
        },
      );
    const step = async (name, task) => {
      signal?.throwIfAborted();
      stage = name;
      report({ progress: null, message: null });
      await task();
      signal?.throwIfAborted();
    };
    const manifest = readJson(path.join(root, 'config/installer.json'));
    const runtime = async (name, relative) => {
      const spec = manifest.artifacts[name],
        executable = path.join(root, relative),
        stamp = path.join(cache, name + '.json');
      noLinks(executable);
      noLinks(stamp);
      try {
        if (
          readJson(stamp).sha256 === spec.sha256 &&
          readJson(stamp).executableSha256 === (await fileHash(executable))
        )
          return;
      } catch {}
      const archive = await download(spec, path.join(cache, 'downloads'), {
        signal,
        progress: (progress) => report({ progress }),
      });
      const destination = path.join(root, '.runtime', spec.directory);
      noLinks(destination);
      await ps('packages/installer/windows/archive.ps1', [
        '-Archive',
        archive,
        '-Destination',
        destination,
      ]);
      if (!existsSync(executable))
        throw new Error('A required speech runtime could not be installed.');
      writeJsonAtomic(stamp, {
        sha256: spec.sha256,
        version: spec.version,
        executableSha256: await fileHash(executable),
      });
    };
    await step('python', () => runtime('uv', '.runtime/uv/uv.exe'));
    if (needAsr)
      await step('recognition', () =>
        ps(
          'tools/setup/' +
            (selection.recognition === 'en'
              ? 'setup-streaming-asr.ps1'
              : selection.recognition === 'auto-europe'
                ? 'setup-fast-multilingual-asr.ps1'
                : 'setup-multilingual-asr.ps1'),
        ),
      );
    if (needVoice) {
      await step('voice-pack', async () => {
        const settings = readJson(path.join(root, 'config/companion-voice.json'));
        const expected = readJson(path.join(root, 'config/voice-upstream.json')).model;
        let folder = path.resolve(root, settings.profileDir);
        if (!folder.startsWith(root + path.sep))
          throw new Error('The voice profile must stay inside Capri.');
        try {
          validateVoicePack(folder, expected);
          return;
        } catch {}
        folder = [
          path.join(root, 'data/voices/capri/en/exports/capri-en-v1'),
          path.join(root, 'data/speech/bundled-voice'),
          path.join(root, '.runtime/installer/bundled-voice'),
          path.join(root, '.bundled-voice'),
        ].find((candidate) => {
          try {
            validateVoicePack(candidate, expected);
            return true;
          } catch {
            return false;
          }
        });
        if (!folder) {
          let token = null;
          try {
            const candidate = await credential(root);
            if (typeof candidate === 'string' && candidate && !/[\x00-\x20\x7f]/.test(candidate))
              token = candidate;
          } catch (error) {
            signal?.throwIfAborted();
            if (error?.name === 'AbortError') throw error;
            // Public voice packs do not depend on decrypting optional saved GitHub access.
          }
          signal?.throwIfAborted();
          const available = await releases({ token, signal, allowAnonymousFallback: true });
          const asset = speechPackAsset(
            available,
            readJson(path.join(root, 'config/release.json')).tag,
          );
          const archive = await downloadPack(asset, path.join(cache, 'downloads'), {
            token,
            signal,
            progress: (progress) => report({ progress }),
          });
          const parent = path.join(cache, 'speech-packs');
          noLinks(parent);
          mkdirSync(parent, { recursive: true });
          folder = mkdtempSync(path.join(parent, 'pack-'));
          await ps('packages/installer/windows/archive.ps1', [
            '-Archive',
            archive,
            '-Destination',
            folder,
            '-MaximumBytes',
            String(256 * 1024 ** 2),
          ]);
        }
        settings.profileDir = importVoicePack(folder, root, expected);
        writeJsonAtomic(path.join(root, 'config/companion-voice.json'), settings);
      });
      await step('voice-runtime', async () => {
        await runtime('git', '.runtime/git/cmd/git.exe');
        await ps(
          'tools/setup/setup-voice-training.ps1',
          selection.speech === 'en' ? [] : ['-DependenciesOnly'],
        );
      });
      if (selection.speech !== 'en')
        await step('voice-models', () =>
          ps('tools/setup/setup-multilingual-voice.ps1', ['-Language', selection.speech]),
        );
    }
    await step('verify', async () => {
      if (selection.speech !== 'off' && !voiceReady(root, selection.speech))
        throw new Error(
          'Voice files are still incomplete. Retry installation or save a diagnostic report.',
        );
      if (selection.recognition !== 'off' && !recognitionReady(root, selection.recognition, config))
        throw new Error(
          'Recognition files are still incomplete. Retry installation or save a diagnostic report.',
        );
    });
  } finally {
    unlock();
  }
}
