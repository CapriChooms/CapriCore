// SPDX-License-Identifier: GPL-3.0-only
import { LANGUAGE_PACKS } from './language-settings.mjs';

export function voiceModelInstallLanguage(model, language) {
  // English Multilingual still needs the shared multilingual weights, not Turbo.
  return model?.backend === 'chatterbox-multilingual-v3' && language === 'en'
    ? model.installLanguage
    : language;
}

export function voiceModelInstallState(catalog, speech, model, language) {
  if (catalog?.phase === 'installing') return catalog;
  if (speech?.phase === 'installing') return speech;
  if (model?.backend === 'qwen3-tts')
    return catalog?.installingModelId === model.id &&
      (!catalog.installingLanguage || catalog.installingLanguage === language)
      ? catalog
      : { phase: 'idle' };
  return speech?.selection?.speech === voiceModelInstallLanguage(model, language)
    ? speech
    : { phase: 'idle' };
}

export function voiceModelInstallProgress(install) {
  if (install?.phase !== 'installing') return null;
  const progress = install.progress;
  if (progress?.total > 0) {
    const received = progress.received ?? progress.completed;
    return Number.isFinite(received)
      ? Math.max(0, Math.min(100, (100 * received) / progress.total))
      : null;
  }
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
}

export class VoiceModelPanel {
  constructor({ api, ui, host, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.className = 'settings-card';
    this.panel.innerHTML = `
      <h3>Voice models · Hugging Face</h3>
      <label for="voice-model-language">Voice language</label><select id="voice-model-language"></select>
      <label for="voice-model-choice">Voice model</label><select id="voice-model-choice"></select>
      <p id="voice-model-details" class="settings-help"></p>
      <div class="settings-actions"><button id="voice-model-install" type="button">Download voice model</button><button id="voice-model-install-cancel" type="button" hidden>Cancel download</button><button id="voice-model-select" type="button">Use this voice model</button></div>
      <p id="voice-model-install-status" role="status" aria-live="polite"></p>
      <button id="voice-model-cpu-alternative" type="button" data-untranslated hidden></button>
      <h4>Capri voice training</h4>
      <p class="settings-help">Train a compatible model using reviewed Capri recordings on this PC. Listen to the new voice before applying it.</p>
      <p id="voice-model-training-help" class="settings-help"></p>
      <button id="voice-model-import" type="button">Import reviewed recordings</button>
      <div class="settings-actions"><button id="voice-model-train" type="button">Train Capri voice</button><button id="voice-model-cancel" type="button" hidden>Cancel training</button></div>
      <p id="voice-model-status" role="status" aria-live="polite"></p>
      <div class="settings-actions"><button id="voice-model-preview" type="button" hidden>Listen to trained voice</button><button id="voice-model-apply" type="button" hidden>Apply trained voice</button></div>`;
    host.append(this.panel);
    this.get = (name) => this.panel.querySelector('#voice-model-' + name);
    this.get('language').replaceChildren(
      ...LANGUAGE_PACKS.filter((p) => p.speechReady).map(
        (p) => new Option(ui.languageName(p.id), p.id),
      ),
    );
    this.get('language').onchange = () => this.choices();
    this.get('choice').onchange = () => this.details();
    this.get('cpu-alternative').onclick = () => {
      const model = this.value.models.find(
        (item) =>
          item.backend === 'qwen3-tts' &&
          item.devices.includes('cpu') &&
          item.languages.includes(this.get('language').value),
      );
      if (!model) return;
      this.get('choice').value = model.id;
      this.details();
    };
    const action = (name, work) =>
      (this.get(name).onclick = async () => {
        this.get(name).disabled = true;
        try {
          await work();
        } catch (error) {
          onError(error.message);
        } finally {
          this.get(name).disabled = false;
          this.details();
        }
      });
    const selection = () => ({
      modelId: this.get('choice').value,
      language: this.get('language').value,
    });
    action('select', async () => this.show(await api.selectVoiceModel(selection())));
    action('install', async () => {
      const model = this.value.models.find((item) => item.id === selection().modelId);
      if (model.backend === 'qwen3-tts') this.show(await api.installVoiceModel(selection()));
      else
        this.speechStatus(
          await api.installSpeech({
            speech: voiceModelInstallLanguage(model, selection().language),
            recognition: 'off',
          }),
        );
    });
    action('install-cancel', async () => {
      if (this.value.phase === 'installing') this.show(await api.cancelVoiceModelInstall());
      else this.speechStatus(await api.cancelSpeechInstall());
    });
    action('import', async () => this.trainingStatus(await api.importVoiceTrainingDataset()));
    action('train', async () => this.trainingStatus(await api.startVoiceTraining(selection())));
    action('cancel', async () => this.trainingStatus(await api.cancelVoiceTraining()));
    action('apply', async () => this.trainingStatus(await api.applyVoiceTraining()));
    action('preview', async () => {
      const audio = await api.previewVoiceTraining();
      await this.stopPreview();
      const context = (this.audio = new AudioContext());
      const bytes = Uint8Array.from(atob(audio.audioBase64), (char) => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      if (this.audio !== context) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (this.audio === context) void this.stopPreview();
      };
      source.start();
    });
  }
  async stopPreview() {
    const audio = this.audio;
    this.audio = null;
    if (audio) await audio.close();
  }
  show(value) {
    const previousChoice = this.get('choice').value;
    this.value = value;
    this.choices(previousChoice);
  }
  choices(previousChoice) {
    if (!this.value) return;
    const language = this.get('language').value;
    this.get('choice').replaceChildren(
      ...this.value.models
        .filter((model) => model.languages.includes(language))
        .map((model) => {
          const option = new Option(model.name ?? model.id, model.id);
          option.dataset.untranslated = '';
          return option;
        }),
    );
    this.get('choice').value =
      (previousChoice &&
      this.value.models.some((m) => m.id === previousChoice && m.languages.includes(language))
        ? previousChoice
        : null) ??
      this.value.selections[language] ??
      (language === 'en' ? this.value.defaults.en : this.value.defaults.multilingual);
    this.details();
  }
  details() {
    if (!this.value) return;
    for (const option of this.get('language').options)
      option.textContent = this.ui.languageName(option.value);
    const model = this.value.models.find((item) => item.id === this.get('choice').value);
    const language = this.get('language').value;
    const installing = this.value.phase === 'installing' || this.speech?.phase === 'installing';
    const busy =
      ['training', 'importing'].includes(this.training?.phase) ||
      this.training?.phase === 'applying' ||
      this.value.phase === 'applying' ||
      installing;
    this.get('select').disabled = busy || !model?.installed;
    this.get('language').disabled = busy;
    this.get('choice').disabled = busy;
    this.get('install').disabled = busy || !model || model.installed;
    this.get('install').hidden = Boolean(model?.installed);
    this.get('install-cancel').hidden = !installing;
    this.get('import').disabled = busy;
    this.get('details').textContent = model
      ? `${model.repository} · ${this.ui.text(model.installed ? 'Installed' : 'Not installed')} · ${this.ui.text(model.training ? 'Fine-tuning supported' : 'Capri reference voice')} · ${model.devices.join(' / ')}${model.downloadBytes ? ` · ${this.ui.text('Model weights')} ≈ ${(model.downloadBytes / 1e9).toFixed(2)} GB` : ''}${model.minimumFreeBytes ? ` · ${this.ui.text('Required free space')} ≈ ${(model.minimumFreeBytes / 1e9).toFixed(1)} GB` : ''}${model.backend === 'qwen3-tts' ? '. ' + this.ui.text('CPU speech is experimental and can be slower than real time.') : ''}`
      : '';
    const trainable = model?.id === 'chatterbox-turbo' && language === 'en';
    this.get('train').disabled = busy || !trainable || !this.training?.available;
    this.get('training-help').textContent = this.ui.text(
      !trainable
        ? 'This model needs a compatible training recipe. Capri reference conditioning is used for supported voices.'
        : (this.training?.reason ??
            'Training requires reviewed Capri recordings and a compatible GPU.'),
    );
    this.get('cancel').hidden = !['training', 'importing'].includes(this.training?.phase);
    this.get('preview').hidden = this.training?.phase !== 'review';
    this.get('apply').hidden = this.training?.phase !== 'review';
    this.get('preview').disabled = busy;
    this.get('apply').disabled = busy;
    const install = voiceModelInstallState(this.value, this.speech, model, language);
    const stages = {
      checking: 'Checking speech components…',
      python: 'Preparing speech installer…',
      'voice-pack': 'Preparing Capri’s included voice…',
      dependencies: 'Installing voice dependencies…',
      'voice-runtime': 'Installing voice dependencies…',
      'voice-models': 'Downloading multilingual voice…',
      verify: 'Checking voice files…',
    };
    this.get('install-status').textContent = this.ui.text(
      install.error ??
        (install.phase === 'installing'
          ? (stages[install.stage] ?? 'Downloading voice model…')
          : install.phase === 'ready'
            ? 'Voice model installed.'
            : ''),
    );
    const progress = voiceModelInstallProgress(install);
    if (progress !== null) this.get('install-status').textContent += ` ${Math.round(progress)}%`;
    this.get('cpu-alternative').textContent =
      this.ui.text('Voice model') + ' · Qwen3-TTS · CPU (BETA)';
    this.get('cpu-alternative').title = this.ui.text(
      'CPU speech is experimental and can be slower than real time.',
    );
    this.get('cpu-alternative').hidden =
      busy ||
      install.errorCode !== 'CAPRI_VOICE_GPU_UNSUPPORTED' ||
      !this.value.models.some(
        (item) =>
          item.backend === 'qwen3-tts' &&
          item.devices.includes('cpu') &&
          item.languages.includes(language),
      );
  }
  speechStatus(value) {
    this.speech = value;
    this.details();
    if (value.phase === 'ready') void this.refresh().catch((error) => this.onError(error.message));
  }
  trainingStatus(value) {
    this.training = value;
    this.refreshLocale();
  }
  refreshLocale() {
    for (const option of this.get('language').options) {
      option.dataset.untranslated = 'true';
      option.textContent = this.ui.languageName(option.value);
    }
    const value = this.training;
    if (value)
      this.get('status').textContent =
        this.ui.text(value.error ?? value.stage ?? (value.phase === 'idle' ? '' : value.phase)) +
        (value.epoch ? ` · ${value.epoch}/${value.epochs ?? '?'}` : '');
    this.details();
  }
  async refresh(language) {
    if (language && this.get('language').querySelector(`option[value="${language}"]`))
      this.get('language').value = language;
    const [catalog, training] = await Promise.all([
      this.api.voiceCatalog(),
      this.api.voiceTrainingStatus(),
    ]);
    this.show(catalog);
    this.trainingStatus(training);
  }
}
