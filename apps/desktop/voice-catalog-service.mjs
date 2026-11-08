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

export function voicePython(root, model) {
  return path.join(
    root,
    model.backend === 'qwen3-tts'
      ? '.runtime/qwen-tts-venv/Scripts/python.exe'
      : '.runtime/voice-training-venv/Scripts/python.exe',
  );
}

/** Cross-family switches must restart Python; its dependency sets are isolated. */
export function voiceBackendChanged(root, previousLanguage, nextLanguage, configRoot = root) {
  if (previousLanguage === 'off' || nextLanguage === 'off') return false;
  return (
    selectedVoiceModel(root, previousLanguage, configRoot).backend !==
    selectedVoiceModel(root, nextLanguage, configRoot).backend
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
    prepare = (options) =>
      import('../../packages/installer/src/voice-catalog-prepare.mjs').then((module) =>
        module.prepareVoiceCatalog(options),
      ),
    ownerStamp = () => processStartedAt(process.pid),
  }) {
    Object.assign(this, { root, configRoot, emit, beforeChange, run, free, prepare, ownerStamp });
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
      const spec =
        model.backend === 'qwen3-tts'
          ? readJson(path.join(this.configRoot, 'config/qwen-tts-upstream.json'))
          : readJson(path.join(this.configRoot, 'config/multilingual-runtime.json')).tts;
      return spec.files.every((item) => {
        const file = voiceDataPath(this.root, spec.directory + '/' + item.file);
        return statSync(file).isFile() && statSync(file).size === item.bytes;
      });
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
      models: this.models.map((model) => ({ ...model, installed: this.installed(model) })),
      defaults: { en: 'chatterbox-turbo', multilingual: 'chatterbox-multilingual-v3' },
    };
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
  publish(patch) {
    Object.assign(this.value, patch);
    const value = this.snapshot();
    this.emit({ type: 'voice-catalog.status', ...value });
    return value;
  }
  install({ modelId, language } = {}) {
    if (this.busy()) throw new Error('Wait for the voice operation to finish.');
    const model = this.models.find(
      (item) => item.id === modelId && item.languages.includes(language),
    );
    if (!model || model.backend !== 'qwen3-tts')
      throw new Error('Use Install and enable in Languages for the Chatterbox voice models.');
    if (this.root !== this.configRoot)
      throw new Error('Installation is unavailable in interface verification.');
    const cache = voiceDataPath(this.root, '.runtime/installer');
    mkdirSync(cache, { recursive: true });
    const unlock = installationLock(cache);
    try {
      assertDiskSpace(this.root, this.free(this.root), model.minimumFreeBytes);
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
      stage: 'dependencies',
      progress: 0,
      error: null,
    });
    this.task = Promise.resolve()
      .then(async () => {
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
            Buffer.from('[]').toString('base64'),
          ],
          {
            cwd: this.root,
            env,
            signal: controller.signal,
            timeoutMs: 2 * 60 * 60 * 1000,
            output: (line) => {
              try {
                const event = JSON.parse(line);
                if (['dependencies', 'models', 'ready'].includes(event.stage))
                  this.publish({
                    stage: event.stage,
                    progress: Number.isFinite(event.progress)
                      ? Math.max(0, Math.min(100, 20 + event.progress * 0.8))
                      : 0,
                  });
              } catch {}
            },
          },
        );
        controller.signal.throwIfAborted();
        if (!this.installed(model)) throw new Error('Voice installation could not be verified.');
        this.publish({ phase: 'ready', stage: null, progress: 100, error: null });
      })
      .catch(() =>
        this.publish({
          phase: controller.signal.aborted ? 'cancelled' : 'error',
          stage: null,
          error: controller.signal.aborted
            ? null
            : 'Voice installation could not finish. Check free disk space and the network, then retry; partial downloads are retained.',
        }),
      )
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
