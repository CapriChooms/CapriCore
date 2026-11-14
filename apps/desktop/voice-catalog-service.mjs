// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  noLinks,
  readJson,
  diskFree,
  assertDiskSpace,
} from '../../packages/installer/src/policy.mjs';
import { installationLock } from '../../packages/installer/src/lock.mjs';
import { runCommand } from '../../packages/installer/src/commands.mjs';
import { processStartedAt } from '../../packages/runtime/src/host/processes.mjs';
import {
  readVoiceSettings,
  readTrainingSettings,
} from '../../packages/runtime/src/voice-settings.mjs';
import { writeJsonAtomic } from './storage.mjs';
import builtinCatalog from '../../config/tts-catalog.json' with { type: 'json' };
import { privateLogRecord } from '../../packages/runtime/src/privacy-log.mjs';
import { writePrivateBytesAtomic } from '../../packages/runtime/src/safe-file.mjs';
import { probeHardware } from '../../packages/runtime/src/hardware/probe.mjs';
import { voiceRocmSupported } from '../../packages/runtime/src/hardware/voice-gpu.mjs';
import { voiceRuntimeEnvironment } from '../../integrations/voice_runtime/environment.mjs';

export const RUSSIAN_QWEN_ID = 'qwen3-tts-1.7b-capri-ru';
const qwenGpuVersions = { cuda: 'cu128', rocm: 'rocm7.2.1' };

function qwenGpuRuntime(root, backend) {
  try {
    const folder = `.runtime/qwen-tts-${backend}-venv`;
    const receipt = readJson(voiceDataPath(root, `${folder}/${backend}-ready.json`));
    const python = voiceDataPath(root, `${folder}/Scripts/python.exe`);
    if (
      receipt.schemaVersion === 1 &&
      receipt.backend === qwenGpuVersions[backend] &&
      existsSync(python)
    )
      return {
        backend,
        python,
        env: backend === 'rocm' ? { ROCM_SDK_TARGET_FAMILY: 'custom' } : {},
      };
  } catch {}
  return null;
}

export function voiceRuntimeKind(model) {
  if (model.id === RUSSIAN_QWEN_ID) return 'qwen3-tts-ru-lora';
  if (model.backend === 'chatterbox-turbo') return 'turbo';
  if (model.backend === 'qwen3-tts') return 'qwen3-tts';
  return 'multilingual-v3';
}

function voiceFilesInstalled(root, spec) {
  return spec.files.every((item) => {
    const file = voiceDataPath(root, spec.directory + '/' + item.file);
    const info = statSync(file);
    return info.isFile() && info.size === item.bytes;
  });
}

function qwenVoiceSpec(configRoot, model) {
  return readJson(
    path.join(
      configRoot,
      'config',
      model.id === RUSSIAN_QWEN_ID ? 'qwen-ru-voice.json' : 'qwen-tts-upstream.json',
    ),
  );
}

export function qwenVoiceFilesInstalled(root, configRoot, model) {
  const spec = qwenVoiceSpec(configRoot, model);
  const groups = model.id === RUSSIAN_QWEN_ID ? [spec, spec.accent, spec.pack] : [spec];
  return groups.every((group) => voiceFilesInstalled(root, group));
}

function installFailure(error, stage) {
  const detail = String(error?.outputTail ?? error?.message ?? '').slice(-16384);
  const record = privateLogRecord(detail, { service: 'voice-catalog', stage });
  const codes = [
    [/does not match pinned Python|pinned Python.*unavailable/i, 'CAPRI_VOICE_PYTHON_VERSION'],
    [/reference voice.*missing|reference voice.*original Setup/i, 'CAPRI_VOICE_REFERENCE_MISSING'],
    [
      /NVIDIA acceleration packages could not be downloaded or verified/i,
      'CAPRI_VOICE_CUDA_DOWNLOAD',
    ],
    [/AMD ROCm packages could not be downloaded or verified/i, 'CAPRI_VOICE_ROCM_DOWNLOAD'],
    [/speech dependencies could not be installed/i, 'CAPRI_VOICE_DEPENDENCIES'],
    [/speech runtime verification failed/i, 'CAPRI_VOICE_RUNTIME_VERIFICATION'],
    [/speech model download could not finish/i, 'CAPRI_VOICE_MODEL_DOWNLOAD'],
    [/Voice installation could not be verified/i, 'CAPRI_VOICE_MODEL_VERIFICATION'],
  ];
  record.event = 'failure';
  record.code ??=
    codes.find(([pattern]) => pattern.test(detail))?.[1] ?? 'CAPRI_VOICE_INSTALL_FAILED';
  if (Number.isInteger(error?.exitCode)) record.exitCode = error.exitCode;
  return record;
}

export function voiceDataPath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /[:\x00-\x1f]/.test(relative))
    throw new Error('Invalid voice data path.');
  const base = path.resolve(root),
    file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) throw new Error('Invalid voice data path.');
  noLinks(file);
  return file;
}

export function readVoiceSelections(root, models) {
  const file = voiceDataPath(root, 'data/speech/voice-selections.json');
  if (!existsSync(file)) return {};
  const value = readJson(file);
  if (
    value.schemaVersion !== 1 ||
    !value.languages ||
    typeof value.languages !== 'object' ||
    Array.isArray(value.languages)
  )
    throw new Error('The saved voice selection is invalid.');
  for (const [language, modelId] of Object.entries(value.languages)) {
    if (!models.some((model) => model.id === modelId && model.languages.includes(language)))
      throw new Error('The saved voice selection needs a compatible model.');
  }
  return value.languages;
}

export function selectedVoiceModel(root, language, configRoot = root) {
  const file = path.join(configRoot, 'config/tts-catalog.json');
  const models = existsSync(file) ? readJson(file).models : builtinCatalog.models;
  const selected =
    readVoiceSelections(root, models)[language] ??
    (language === 'en' ? 'chatterbox-turbo' : 'chatterbox-multilingual-v3');
  const model = models.find((item) => item.id === selected && item.languages.includes(language));
  if (!model) throw new Error('Selected voice model does not support this language.');
  return model;
}

export function voiceRuntimes(root, model) {
  if (model.backend !== 'qwen3-tts')
    return [
      {
        python: path.join(root, '.runtime/voice-training-venv/Scripts/python.exe'),
        env: voiceRuntimeEnvironment(root),
      },
    ];
  return [
    ...(model.id === RUSSIAN_QWEN_ID ? [qwenGpuRuntime(root, 'cuda')] : []),
    qwenGpuRuntime(root, 'rocm'),
    {
      backend: 'cpu',
      python: path.join(root, '.runtime/qwen-tts-venv/Scripts/python.exe'),
      env: {},
    },
  ].filter(Boolean);
}

export function voiceRuntime(root, model, deviceKey = 'auto') {
  const runtimes = voiceRuntimes(root, model);
  if (deviceKey === 'auto' || model.backend !== 'qwen3-tts') return runtimes[0];
  const runtime = runtimes.find(({ backend }) => backend === deviceKey.split(':', 1)[0]);
  if (!runtime)
    throw new Error(
      'The selected voice GPU runtime is missing. Install acceleration or choose another device in Model devices.',
    );
  return runtime;
}

export function voicePython(root, model) {
  return voiceRuntime(root, model).python;
}

/** Cross-family switches must restart Python; its dependency sets are isolated. */
export function voiceBackendChanged(root, previousLanguage, nextLanguage, configRoot = root) {
  if (previousLanguage === 'off' || nextLanguage === 'off') return false;
  const previous = selectedVoiceModel(root, previousLanguage, configRoot);
  const next = selectedVoiceModel(root, nextLanguage, configRoot);
  return (
    previous.backend !== next.backend ||
    (previous.id === RUSSIAN_QWEN_ID) !== (next.id === RUSSIAN_QWEN_ID)
  );
}

export class VoiceCatalogService {
  constructor({
    root,
    configRoot = root,
    emit = () => {},
    beforeChange = async () => {},
    run = runCommand,
    free = diskFree,
    hardware = probeHardware,
    prepare = (options) =>
      import('../../packages/installer/src/voice-catalog-prepare.mjs').then((module) =>
        module.prepareVoiceCatalog(options),
      ),
    ownerStamp = () => processStartedAt(process.pid),
  }) {
    Object.assign(this, {
      root,
      configRoot,
      emit,
      beforeChange,
      run,
      free,
      hardware,
      prepare,
      ownerStamp,
    });
    this.models = readJson(path.join(configRoot, 'config/tts-catalog.json')).models;
    this.applying = false;
    this.task = null;
    this.controller = null;
    this.value = {
      phase: 'idle',
      stage: null,
      progress: null,
      installingModelId: null,
      installingLanguage: null,
      error: null,
      errorCode: null,
      lastFailure: null,
    };
  }
  installed(model) {
    try {
      const companion = readVoiceSettings(this.root, { configRoot: this.configRoot });
      const profile = voiceDataPath(this.root, companion.profileDir);
      if (
        !existsSync(path.join(profile, 'voice-profile.json')) ||
        !existsSync(voicePython(this.root, model))
      )
        return false;
      if (model.id === 'chatterbox-turbo') {
        const training = readTrainingSettings(this.root, { configRoot: this.configRoot });
        return existsSync(voiceDataPath(this.root, training.modelDir + '/model-receipt.json'));
      }
      if (model.backend === 'qwen3-tts')
        return qwenVoiceFilesInstalled(this.root, this.configRoot, model);
      return voiceFilesInstalled(
        this.root,
        readJson(path.join(this.configRoot, 'config/multilingual-runtime.json')).tts,
      );
    } catch {
      return false;
    }
  }
  snapshot() {
    const selections = readVoiceSelections(this.root, this.models);
    return {
      schemaVersion: 1,
      ...this.value,
      phase: this.applying ? 'applying' : this.value.phase,
      selections,
      russianQwenCudaReady: Boolean(qwenGpuRuntime(this.root, 'cuda')),
      qwenRocmReady: Boolean(qwenGpuRuntime(this.root, 'rocm')),
      qwenRocmSupported: this.qwenRocmSupported === true,
      models: this.models.map((model) => ({ ...model, installed: this.installed(model) })),
      defaults: { en: 'chatterbox-turbo', multilingual: 'chatterbox-multilingual-v3' },
    };
  }
  async refresh() {
    this.qwenRocmSupported ??= await Promise.resolve()
      .then(() => this.hardware())
      .then(voiceRocmSupported)
      .catch(() => false);
    return this.snapshot();
  }
  async select({ language, modelId } = {}) {
    if (this.busy()) throw new Error('Wait for the voice operation to finish.');
    const model = this.models.find(
      (item) => item.id === modelId && item.languages.includes(language),
    );
    if (!model) throw new Error('This voice model does not support the selected language.');
    if (!this.installed(model)) throw new Error('Install this voice model before selecting it.');
    this.applying = true;
    try {
      await this.beforeChange();
      const languages = readVoiceSelections(this.root, this.models);
      languages[language] = modelId;
      writeJsonAtomic(voiceDataPath(this.root, 'data/speech/voice-selections.json'), {
        schemaVersion: 1,
        languages,
      });
    } finally {
      this.applying = false;
    }
    const value = this.snapshot();
    this.emit({ type: 'voice-catalog.status', ...value });
    return value;
  }
  busy() {
    return Boolean(this.applying || this.task);
  }
  diagnostics() {
    return {
      phase: this.value.phase,
      stage: this.value.stage,
      modelId: this.value.installingModelId,
      language: this.value.installingLanguage,
      progress: this.value.progress,
      lastFailure: this.value.lastFailure,
    };
  }
  publish(patch) {
    Object.assign(this.value, patch);
    const value = this.snapshot();
    this.emit({ type: 'voice-catalog.status', ...value });
    return value;
  }
  install({ modelId, language, cuda = false, rocm = false } = {}) {
    if (this.busy()) throw new Error('Wait for the voice operation to finish.');
    const model = this.models.find(
      (item) => item.id === modelId && item.languages.includes(language),
    );
    if (!model || model.backend !== 'qwen3-tts')
      throw new Error('Use Install and enable in Languages for the Chatterbox voice models.');
    if (
      typeof cuda !== 'boolean' ||
      typeof rocm !== 'boolean' ||
      (cuda && rocm) ||
      (cuda && (modelId !== RUSSIAN_QWEN_ID || !this.installed(model)))
    )
      throw new Error('Install the Russian Qwen voice before adding NVIDIA acceleration.');
    if (rocm && !this.installed(model))
      throw new Error('Download the Qwen voice model before installing AMD ROCm acceleration.');
    const acceleration = cuda ? 'cuda' : rocm ? 'rocm' : null;
    if (this.root !== this.configRoot)
      throw new Error('Installation is unavailable in interface verification.');
    if (modelId === RUSSIAN_QWEN_ID) {
      let included = false;
      try {
        included = voiceFilesInstalled(this.root, qwenVoiceSpec(this.configRoot, model).pack);
      } catch {}
      if (!included)
        throw new Error('Run the Capri test installer that includes the Russian LoRA voice.');
    }
    const cache = voiceDataPath(this.root, '.runtime/installer');
    mkdirSync(cache, { recursive: true });
    const unlock = installationLock(cache);
    try {
      assertDiskSpace(
        this.root,
        this.free(this.root),
        acceleration ? 12 * 1024 ** 3 : model.minimumFreeBytes,
      );
    } catch (error) {
      unlock();
      throw error;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.publish({
      phase: 'installing',
      installingModelId: modelId,
      installingLanguage: language,
      cuda,
      rocm,
      stage: 'python',
      progress: null,
      error: null,
      errorCode: null,
      lastFailure: null,
    });
    this.task = Promise.resolve()
      .then(async () => {
        if (rocm && !(await this.refresh()).qwenRocmSupported)
          throw new Error('AMD ROCm acceleration requires a supported Radeon GPU on Windows 11.');
        controller.signal.throwIfAborted();
        await this.beforeChange();
        controller.signal.throwIfAborted();
        const env = {};
        for (const key of [
          'SystemRoot',
          'WINDIR',
          'PATH',
          'USERPROFILE',
          'LOCALAPPDATA',
          'APPDATA',
          'ProgramFiles',
          'PROGRAMFILES(X86)',
          'COMSPEC',
        ])
          if (process.env[key]) env[key] = process.env[key];
        Object.assign(env, {
          // Windows PowerShell uses PATHEXT to recognize native executables.
          // Without it `& python.exe --version` returns a Process object rather
          // than captured output, causing a false interpreter-version failure.
          PATHEXT: '.COM;.EXE;.BAT;.CMD',
          UV_NO_CONFIG: '1',
          UV_CACHE_DIR: path.join(this.root, '.runtime/uv-cache'),
          TEMP: path.join(this.root, '.runtime/tmp'),
          TMP: path.join(this.root, '.runtime/tmp'),
          HF_HUB_DISABLE_TELEMETRY: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONNOUSERSITE: '1',
        });
        noLinks(env.TEMP);
        mkdirSync(env.TEMP, { recursive: true });
        await this.prepare({ root: this.root, env, signal: controller.signal, execute: this.run });
        controller.signal.throwIfAborted();
        const stamp = this.ownerStamp();
        if (!/^[0-9]+$/.test(stamp ?? ''))
          throw new Error('The speech installer owner could not be verified.');
        const script = voiceDataPath(this.root, 'tools/setup/owned-speech.ps1');
        await this.run(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            '-Component',
            'qwen',
            '-OwnerPid',
            String(process.pid),
            '-OwnerStamp',
            stamp,
            '-ArgumentsBase64',
            Buffer.from(
              JSON.stringify([
                ...(modelId === RUSSIAN_QWEN_ID ? ['-Russian'] : []),
                ...(cuda ? ['-Cuda'] : []),
                ...(rocm ? ['-Rocm'] : []),
              ]),
            ).toString('base64'),
          ],
          {
            cwd: this.root,
            env,
            signal: controller.signal,
            timeoutMs: 2 * 60 * 60 * 1000,
            output: (line) => {
              try {
                const { stage, progress, received, total } = JSON.parse(line);
                if (
                  acceleration &&
                  [
                    `${acceleration}-connect`,
                    `${acceleration}-download`,
                    `${acceleration}-retry`,
                  ].includes(stage)
                ) {
                  if (
                    Number.isSafeInteger(received) &&
                    Number.isSafeInteger(total) &&
                    total > 0 &&
                    received >= 0 &&
                    received <= total
                  )
                    this.publish({ stage, progress: { received, total } });
                } else if (
                  [
                    'python',
                    'dependencies',
                    'models',
                    'verify',
                    `${acceleration}-prepare`,
                  ].includes(stage)
                ) {
                  this.publish({
                    stage,
                    progress: stage === 'models' && Number.isFinite(progress) ? progress : null,
                  });
                }
              } catch {}
            },
          },
        );
        controller.signal.throwIfAborted();
        if (!this.installed(model) || (acceleration && !qwenGpuRuntime(this.root, acceleration)))
          throw new Error('Voice installation could not be verified.');
        this.publish({ phase: 'ready', stage: null, progress: 100, error: null });
      })
      .catch((error) => {
        const failure = controller.signal.aborted ? null : installFailure(error, this.value.stage);
        if (failure) {
          try {
            writePrivateBytesAtomic(
              path.join(this.root, 'logs/voice-catalog.jsonl'),
              Buffer.from(JSON.stringify({ ...failure, time: new Date().toISOString() }) + '\n'),
            );
          } catch {
            /* Diagnostic storage must not prevent retry or lock cleanup. */
          }
        }
        let message = 'Voice installation failed. Retry or save a diagnostic report.';
        if (rocm && !this.qwenRocmSupported)
          message = 'AMD ROCm acceleration requires a supported Radeon GPU on Windows 11.';
        else if (acceleration && this.value.stage?.startsWith(`${acceleration}-`))
          message = rocm
            ? 'Could not download or verify AMD ROCm packages. Retry to resume the download.'
            : 'Could not download or verify NVIDIA packages. Retry to resume the download.';
        else if (acceleration && this.value.stage === 'verify')
          message = rocm
            ? 'Could not start AMD ROCm acceleration. Check your Radeon GPU and AMD driver.'
            : 'Could not start NVIDIA acceleration. Check your GPU and NVIDIA driver.';
        this.publish({
          phase: controller.signal.aborted ? 'cancelled' : 'error',
          stage: null,
          lastFailure: failure,
          errorCode: failure?.code ?? null,
          error: controller.signal.aborted ? null : message,
        });
      })
      .finally(() => {
        this.task = null;
        this.controller = null;
        unlock();
      });
    return this.snapshot();
  }
  cancel() {
    this.controller?.abort(new Error('Voice installation cancelled.'));
    return this.snapshot();
  }
  async close() {
    this.cancel();
    await this.task;
  }
}
