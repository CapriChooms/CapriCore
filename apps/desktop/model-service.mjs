// SPDX-License-Identifier: GPL-3.0-only
import {
  recommendProfile,
  meetsProfileRam,
} from '../../packages/runtime/src/hardware/profiles.mjs';
import {
  MODEL_CHOICES,
  selectModelChoice,
} from '../../packages/runtime/src/hardware/model-catalog.mjs';
import { recommendModelsForLanguage } from '../../packages/runtime/src/hardware/model-recommendations.mjs';
import {
  modelProfileContext,
  profileOverrides,
} from '../../packages/runtime/src/hardware/model-profile.mjs';
import { probeHardware } from '../../packages/runtime/src/hardware/probe.mjs';
import { profileRamRequirement } from '../../packages/runtime/src/hardware/memory-budget.mjs';
import { pullModel } from '../../packages/runtime/src/providers/pull-model.mjs';
import { ensureNativeLanguageModel } from '../../packages/runtime/src/providers/native-model.mjs';
import { verifyImportedChat } from '../../packages/runtime/src/providers/model-residency.mjs';
import { startLlama } from '../../packages/runtime/src/providers/services.mjs';
import { request } from '../../packages/runtime/src/http.mjs';
import estimates from '../../config/qwen-download-sizes.json' with { type: 'json' };
import { contextChoicesFor } from '../../packages/runtime/src/config/context-policy.mjs';
import {
  HF_DRAFT_CHAT_ERROR,
  validateImportedProfile,
} from '../../packages/runtime/src/hardware/imported-model.mjs';
import languages from '../shared/languages.json' with { type: 'json' };
export class ModelService {
  constructor({
    rt,
    config,
    emit = () => {},
    hardware = probeHardware,
    inventory = () => request(`${rt.ollamaUrl}/api/tags`),
    ensure = () => startLlama(rt),
    pull = pullModel,
    native = ensureNativeLanguageModel,
    probeImported = verifyImportedChat,
    customProfiles = () => [],
    describe = (model, signal) =>
      request(`${rt.ollamaUrl}/api/show`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      }),
  }) {
    Object.assign(this, {
      rt,
      config,
      emit,
      hardware,
      inventory,
      ensure,
      pull,
      native,
      probeImported,
      describe,
      customProfiles,
    });
    this.value = {
      phase: 'idle',
      current: config.model,
      remoteActive: Boolean(rt.remote?.enabled || rt.remote?.setupRequired),
      contextTokens: config.contextTokens,
      contextChoices: contextChoicesFor(config),
      selected: null,
      profiles: [],
      progress: null,
      error: null,
    };
    this.device = null;
    this.prepared = null;
    this.controller = null;
    this.applying = false;
  }
  snapshot() {
    return {
      ...structuredClone(this.value),
      nativeActive: Boolean(this.rt.nativeNpu),
      nativeModel: this.rt.nativeNpu?.model ?? null,
    };
  }
  publish(patch) {
    Object.assign(this.value, patch);
    this.emit({ type: 'models.status', ...this.snapshot() });
    return this.snapshot();
  }
  busy() {
    return Boolean(this.controller || this.applying);
  }
  async catalog() {
    this.device ??= await this.hardware();
    const recommendation = recommendProfile(this.device);
    this.languageRecommendations ??= Object.fromEntries(
      languages.flatMap(({ id }) => {
        const profiles = recommendModelsForLanguage(id, this.device);
        return profiles.length ? [[id, profiles]] : [];
      }),
    );
    let models = [],
      unavailable = false;
    try {
      models = (await this.inventory()).models ?? [];
    } catch {
      unavailable = true;
    }
    const imported = (await this.customProfiles()).map(validateImportedProfile);
    const remoteActive = Boolean(this.rt.remote?.enabled || this.rt.remote?.setupRequired);
    return {
      remoteActive,
      inventoryUnavailable: unavailable,
      recommended: recommendation.profile?.id ?? null,
      languageRecommendations: this.languageRecommendations,
      profiles: [...MODEL_CHOICES, ...imported].map((profile) => {
        const upstream = models.find((model) => model.name === profile.model);
        const downloaded = upstream ?? models.find((model) => model.name === profile.alias);
        const actualSize =
          Number.isSafeInteger(downloaded?.size) && downloaded.size > 0 ? downloaded.size : null;
        return {
          ...profile,
          ramGiB: profileRamRequirement(profile, this.device),
          supported:
            profile.source === 'huggingface' ||
            meetsProfileRam(
              this.device.ramBytes / 2 ** 30,
              profileRamRequirement(profile, this.device),
            ),
          installed: Boolean(downloaded),
          upstreamInstalled: Boolean(upstream),
          sizeBytes: actualSize ?? profile.sizeBytes ?? estimates.models[profile.model],
          sizeEstimated: actualSize === null,
          configured: this.config.model === profile.alias,
          active: !remoteActive && this.config.model === profile.alias,
        };
      }),
    };
  }
  async refresh() {
    if (this.busy()) return this.snapshot();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.publish({ phase: 'checking', error: null });
    try {
      const catalog = await this.catalog();
      signal.throwIfAborted();
      return this.publish({ ...catalog, phase: this.prepared ? 'ready' : 'idle' });
    } catch (error) {
      return this.publish({
        phase: signal.aborted ? 'idle' : 'error',
        error: signal.aborted ? null : error.message,
      });
    } finally {
      this.controller = null;
    }
  }
  async prepare(id) {
    if (this.busy()) throw new Error('Wait for the model operation to finish.');
    const imported = (await this.customProfiles()).find((profile) => profile.id === id);
    if (this.busy()) throw new Error('Wait for the model operation to finish.');
    if (imported) validateImportedProfile(imported);
    if (!imported && !MODEL_CHOICES.some((profile) => profile.id === id))
      throw new Error('Unknown language model.');
    this.controller = new AbortController();
    this.prepared = null;
    const signal = this.controller.signal;
    this.publish({ phase: 'checking', selected: id, progress: null, error: null });
    try {
      this.device ??= await this.hardware();
      const profile = imported ?? selectModelChoice(id, this.device);
      signal.throwIfAborted();
      await this.ensure();
      signal.throwIfAborted();
      const catalog = await this.catalog();
      signal.throwIfAborted();
      this.publish(catalog);
      if (!catalog.profiles.find((item) => item.id === id).upstreamInstalled) {
        if (imported) throw new Error('Repair this model in the Hugging Face library first.');
        this.publish({ phase: 'downloading' });
        let previous = 0;
        await this.pull(this.rt, profile.model, {
          signal,
          pauseFile: null,
          emit: () => {},
          onProgress: (progress) => {
            if (Date.now() - previous > 200 || progress.status === 'success') {
              previous = Date.now();
              this.publish({ phase: 'downloading', progress });
            }
          },
        });
      }
      signal.throwIfAborted();
      this.publish({ phase: 'preparing', progress: null });
      const candidate = {
        ...this.config,
        ...profileOverrides(profile),
        contextTokens: modelProfileContext(this.config, profile),
      };
      await this.native(this.rt, candidate, { signal });
      if (profile.capabilities) {
        const actual = await this.describe(profile.model, signal);
        if (imported) {
          const info = actual.model_info ?? {};
          const architecture = info['general.architecture'];
          if (architecture === 'dflash') throw new Error(HF_DRAFT_CHAT_ERROR);
          const limit = info[`${architecture}.context_length`];
          if (
            !actual.capabilities?.includes('completion') ||
            !actual.template?.trim() ||
            !Number.isInteger(limit) ||
            limit < profile.contextLimit
          )
            throw new Error(
              'The imported model changed. Repair it in the Hugging Face library first.',
            );
        }
        if (!profile.capabilities.every((capability) => actual.capabilities?.includes(capability)))
          throw new Error(
            'The installed model does not provide the required tools or vision capabilities.',
          );
      }
      if (imported) await this.probeImported({ ...candidate, url: this.rt.ollamaUrl }, { signal });
      signal.throwIfAborted();
      const finished = await this.catalog();
      signal.throwIfAborted();
      this.prepared = profile;
      return this.publish({ ...finished, phase: 'ready' });
    } catch (error) {
      this.prepared = null;
      return this.publish({
        phase: signal.aborted ? 'idle' : 'error',
        progress: null,
        error: signal.aborted ? null : error.message,
      });
    } finally {
      this.controller = null;
    }
  }
  cancel() {
    this.controller?.abort(new Error('Model download cancelled'));
    return this.snapshot();
  }
  async apply(commit) {
    if (this.busy()) throw new Error('Wait for the model operation to finish.');
    if (!this.prepared || this.value.phase !== 'ready')
      throw new Error('Prepare the selected model first.');
    const profile = this.prepared;
    this.applying = true;
    this.publish({ phase: 'applying', error: null });
    try {
      await commit(profile);
      return true;
    } catch (error) {
      this.publish({ phase: 'ready', error: error.message });
      throw error;
    } finally {
      this.applying = false;
    }
  }
  close() {
    this.cancel();
  }
}
