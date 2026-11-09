// SPDX-License-Identifier: GPL-3.0-only
import { HuggingFacePanel } from './huggingface-panel.mjs';
import { VoiceModelPanel } from './voice-model-panel.mjs';
import { ModelDevicePanel } from './model-device-panel.mjs';
const states = {
  idle: 'Choose a language model for this PC.',
  checking: 'Checking local models...',
  downloading: 'Downloading language model...',
  preparing: 'Preparing language model...',
  ready: 'The selected model is ready.',
  applying: 'Switching language model...',
  error: 'The model could not be prepared.',
};
const descriptions = {
  minimal: 'Lowest memory use; simpler replies. A practical choice for a basic PC.',
  balanced: 'A balance between memory use, speed and conversation quality.',
  desktop: 'More capable replies; uses more memory than the smaller models.',
  quality: 'Largest Qwen option. Uses more memory; voice needs additional resources.',
};
export class ModelsPanel {
  constructor({ api, ui, onOpen, onError }) {
    Object.assign(this, { api, ui, onOpen, onError });
    this.panel = document.createElement('section');
    Object.assign(this.panel, { id: 'models-panel', className: 'preferences-panel', hidden: true });
    this.panel.dataset.panelCut = '12';
    this.panel.dataset.hitRegion = '';
    this.panel.setAttribute('aria-label', 'Language model');
    this.panel.innerHTML = `
      <div class="settings-heading"><h2>Language model</h2><button type="button" id="models-close" aria-label="Close settings">×</button></div>
      <div class="preferences-content">
        <p class="model-current"><span>Current model</span><strong id="models-current" data-untranslated></strong></p>
        <label for="models-choice">Language model</label><select id="models-choice" aria-describedby="models-unavailable models-requirement"></select>
        <button type="button" id="models-local" class="model-local-primary" aria-describedby="models-local-help" disabled>Use local model</button>
        <p id="models-local-help" class="settings-help" role="status" aria-live="polite"></p>
        <p id="models-unavailable" role="status" aria-live="polite" hidden></p>
        <p id="models-language-recommendation" class="model-current" role="status" hidden data-untranslated><span id="models-language-label"></span><strong id="models-language-picks" dir="auto"></strong></p>
        <div class="model-details"><p id="models-description"></p><p id="models-size"></p><p id="models-requirement"></p><p id="models-installed"></p><p id="models-recommendation"></p></div>
        <p class="settings-help">GB describes model files, not RAM or VRAM use. Downloaded models are marked in the list; estimates can change with upstream versions.</p>
        <p class="settings-help">GPU support depends on your hardware and Ollama. Larger models can be slower on a CPU. All choices keep the same conversation and memory.</p>
        <div class="model-progress-card" hidden role="status" aria-live="polite"><p id="models-status"></p><progress id="models-progress" max="100" hidden></progress><output id="models-transfer" data-untranslated></output><p id="models-error"></p></div>
        <div class="settings-actions"><button type="button" id="models-refresh">Refresh models</button><button type="button" id="models-folder">Open models folder</button><button type="button" id="models-prepare">Download and prepare</button><button type="button" id="models-cancel" hidden>Cancel download</button></div>
        <div class="settings-actions"><button type="button" id="models-apply" hidden>Switch model and restart</button></div>
        <p class="settings-help">Downloading keeps the current model active. Switch when you are ready; Capri will restart and prepare the new model. Downloaded models remain available for switching back.</p>
        <div class="settings-card model-context-card">
          <label for="models-context">Context window</label>
          <p id="models-context-current" class="settings-help"></p>
          <select id="models-context" aria-describedby="models-context-help"></select>
          <p id="models-context-help" class="settings-help">32K is recommended. Larger context uses more RAM and VRAM and may slow replies.</p>
          <div class="settings-actions"><button type="button" id="models-context-apply">Apply and restart</button></div>
        </div>
      </div>`;
    document.getElementById('companion').append(this.panel);
    this.devices = new ModelDevicePanel({
      api,
      ui,
      onError,
      host: this.panel.querySelector('.preferences-content'),
    });
    this.hub = new HuggingFacePanel({
      api,
      ui,
      onError,
      host: this.panel.querySelector('.preferences-content'),
    });
    this.voices = new VoiceModelPanel({
      api,
      ui,
      onError,
      host: this.panel.querySelector('.preferences-content'),
    });
    this.get = (id) => this.panel.querySelector('#models-' + id);
    this.get('close').onclick = () => this.open(false);
    this.get('choice').onchange = () => this.details();
    this.get('local').onclick = () => this.useLocalModel();
    this.get('folder').onclick = async () => {
      const button = this.get('folder');
      button.disabled = true;
      try {
        const selected = this.value?.profiles?.find(
          (profile) => profile.id === this.get('choice').value,
        );
        await api.openModelsFolder(selected?.source === 'huggingface' ? 'huggingface' : 'ollama');
      } catch (error) {
        onError(error.message);
      } finally {
        button.disabled = false;
      }
    };
    this.get('context').onchange = () => this.contextDetails();
    for (const [id, work] of [
      ['refresh', () => api.refreshModels()],
      ['prepare', () => api.prepareModel(this.get('choice').value)],
      [
        'cancel',
        () => {
          this.localSwitchOperation = null;
          return api.cancelModelDownload();
        },
      ],
      ['apply', () => api.applyModel()],
      ['context-apply', () => api.applyContextWindow(Number(this.get('context').value))],
    ])
      this.get(id).onclick = async () => {
        this.get(id).disabled = true;
        try {
          const value = await work();
          if (value && typeof value === 'object') this.show(value);
        } catch (error) {
          onError(error.message);
        } finally {
          if (this.value) this.show(this.value);
        }
      };
  }
  show(value) {
    if (!value) return;
    this.value = value;
    const active = value.profiles?.find((profile) => profile.alias === value.current);
    this.get('current').textContent = value.remoteActive
      ? this.ui.text('API connections')
      : active?.source === 'huggingface'
        ? active.family
        : (value.current?.replace('capri-', '') ?? '');
    const context = this.get('context'),
      draft = context.value;
    context.replaceChildren(
      ...(value.contextChoices ?? []).map((tokens) => {
        const option = document.createElement('option');
        option.value = String(tokens);
        option.textContent = `${tokens / 1024}K`;
        return option;
      }),
    );
    context.value = (value.contextChoices ?? []).includes(Number(draft))
      ? draft
      : String(value.contextTokens);
    this.get('context-current').textContent = this.ui.text('Active context: {size}', {
      size: `${value.contextTokens / 1024}K`,
    });
    this.renderChoices();
    const busy =
      Boolean(this.localSwitchOperation) ||
      ['checking', 'downloading', 'preparing', 'applying'].includes(value.phase);
    this.get('choice').disabled = busy;
    this.get('refresh').disabled = busy;
    this.get('cancel').hidden = !['checking', 'downloading', 'preparing'].includes(value.phase);
    this.get('cancel').disabled = false;
    this.get('status').textContent = this.ui.text(states[value.phase] ?? states.idle);
    this.get('error').textContent = value.error ? this.ui.text(value.error) : '';
    this.panel.querySelector('.model-progress-card').hidden = !busy && !value.error;
    const progress = this.get('progress');
    progress.hidden = !busy;
    const amount = value.progress;
    if (amount?.total && amount.completed !== null)
      progress.value = Math.min(100, (100 * amount.completed) / amount.total);
    else progress.removeAttribute('value');
    this.get('transfer').textContent =
      amount?.total && amount.completed !== null
        ? `${(amount.completed / 1e9).toFixed(2)} / ${(amount.total / 1e9).toFixed(2)} GB`
        : '';
    this.details();
    this.contextDetails();
  }
  setConversationLanguage(language) {
    this.voices.refreshLocale();
    if (language === this.conversationLanguage && this.choicesLocale === this.ui.language) return;
    this.conversationLanguage = language;
    if (!this.value) return;
    this.renderChoices();
    this.details();
  }
  renderChoices() {
    this.choicesLocale = this.ui.language;
    const { profiles, recommended, languageRecommendations } = this.value;
    const select = this.get('choice'),
      choice = select.value;
    const ids = languageRecommendations?.[this.conversationLanguage] ?? [];
    const picks = ids
      .map((id) => profiles.find((profile) => profile.id === id))
      .filter((profile) => profile?.supported && profile.source !== 'huggingface');
    const name = (profile) =>
      (profile.family ?? 'Qwen3.5') +
      (profile.source === 'huggingface'
        ? ''
        : ' · ' + (profile.model.split(':')[1]?.toUpperCase() ?? profile.model));
    const optionFor = (profile) => {
      const option = new Option(
        [
          name(profile),
          this.size(profile),
          ...(profile.experimental ? ['BETA'] : []),
          ...(profile.installed ? [this.ui.text('Downloaded')] : []),
        ].join(' · '),
        profile.id,
      );
      // Keep every model inspectable; unavailable actions explain the restriction below.
      option.title = profile.supported ? '' : this.ui.text('This model needs more system RAM.');
      option.dataset.untranslated = '';
      return option;
    };
    const remaining = profiles.filter((profile) => !picks.includes(profile));
    const label = picks.length
      ? this.ui.text('Recommended for {language}', {
          language: this.ui.languageName(this.conversationLanguage),
        })
      : '';
    this.get('language-recommendation').hidden = !picks.length;
    this.get('language-label').textContent = label;
    this.get('language-picks').textContent = picks.map(name).join(' / ');
    const group = document.createElement('optgroup');
    group.label = label;
    group.append(...picks.map(optionFor));
    select.replaceChildren(...(picks.length ? [group] : []), ...remaining.map(optionFor));
    select.value = profiles.some((profile) => profile.id === choice)
      ? choice
      : (profiles.find((profile) => profile.active)?.id ?? recommended ?? '');
  }
  contextDetails() {
    const busy =
      Boolean(this.localSwitchOperation) ||
      ['checking', 'downloading', 'preparing', 'applying'].includes(this.value?.phase);
    this.get('context').disabled = busy;
    this.get('context-apply').disabled =
      busy ||
      !this.get('context').value ||
      Number(this.get('context').value) === this.value?.contextTokens;
  }
  details() {
    const profile = this.value?.profiles.find((item) => item.id === this.get('choice').value);
    const unavailable = profile?.supported === false;
    this.get('unavailable').hidden = !unavailable;
    this.get('unavailable').textContent = unavailable
      ? this.ui.text('This model needs more system RAM.') +
        ' ' +
        this.ui.text('Recommended system RAM: at least {ram} GB.', { ram: profile.ramGiB })
      : '';
    this.get('size').textContent = profile
      ? this.ui.text(
          profile.sizeEstimated ? 'Approximate download: {size}' : 'Model files: {size}',
          { size: this.size(profile) },
        )
      : '';
    this.get('description').textContent = profile
      ? this.ui.text(descriptions[profile.id] ?? profile.description)
      : '';
    this.get('requirement').textContent = profile
      ? profile.source === 'huggingface'
        ? this.ui.text(
            'RAM and VRAM requirements have not been measured for this model. Context and voice increase memory use.',
          )
        : this.ui.text('Recommended system RAM: at least {ram} GB.', { ram: profile.ramGiB }) +
          (profile.recommendedVramGiB ? ` VRAM ≈ ${profile.recommendedVramGiB} GB` : '')
      : '';
    this.get('installed').textContent = profile
      ? this.ui.text(
          this.value.inventoryUnavailable
            ? 'Cannot check downloaded models. Start the local core and refresh the list.'
            : !profile.supported
              ? 'This model needs more system RAM.'
              : profile.active && !this.setupRequired
                ? 'You are already using this model.'
                : profile.installed
                  ? 'Downloaded on this PC.'
                  : 'This model will be downloaded when you prepare it.',
        )
      : '';
    this.get('recommendation').textContent =
      profile?.id === this.value?.recommended
        ? this.ui.text('Recommended for the detected hardware.')
        : '';
    const busy =
      Boolean(this.localSwitchOperation) ||
      ['checking', 'downloading', 'preparing', 'applying'].includes(this.value?.phase);
    const active =
      profile?.active &&
      !this.value?.remoteActive &&
      !this.setupRequired &&
      profile?.installed &&
      !this.value?.inventoryUnavailable;
    this.get('prepare').disabled = busy || !profile?.supported || active;
    this.get('prepare').textContent = this.ui.text(
      profile?.installed ? 'Prepare model' : 'Download and prepare',
    );
    const configured = profile?.configured && (this.value?.remoteActive || this.setupRequired);
    const prepared = this.value?.phase === 'ready' && this.value.selected === profile?.id;
    const prepareFirst =
      !profile?.installed ||
      this.value?.inventoryUnavailable ||
      (!configured && !prepared && profile?.upstreamInstalled !== true);
    this.get('local').disabled = Boolean(busy || !profile?.supported || active);
    const explanation = busy
      ? 'Wait for the model operation to finish.'
      : !profile
        ? states.idle
        : unavailable
          ? 'This model needs more system RAM.'
          : active
            ? 'You are already using this model.'
            : prepareFirst
              ? 'This model will be downloaded when you prepare it.'
              : prepared
                ? states.ready
                : 'Downloaded on this PC.';
    this.get('local-help').textContent = this.ui.text(explanation);
    this.get('apply').hidden =
      this.value?.phase !== 'ready' ||
      this.value.selected !== profile?.id ||
      profile?.active ||
      unavailable;
    this.get('apply').disabled = busy || unavailable;
  }
  async useLocalModel() {
    if (this.localSwitchOperation || this.get('local').disabled) return false;
    const id = this.get('choice').value;
    const profile = this.value?.profiles.find((item) => item.id === id);
    if (!profile?.supported) return false;
    const operation = {};
    this.localSwitchOperation = operation;
    this.show(this.value);
    try {
      if (
        profile.configured &&
        profile.installed &&
        !this.value.inventoryUnavailable &&
        (this.value.remoteActive || this.setupRequired)
      )
        return await this.api.useInferenceApi(null);
      let prepared = this.value;
      if (prepared.phase !== 'ready' || prepared.selected !== id) {
        prepared = await this.api.prepareModel(id);
        if (this.localSwitchOperation !== operation || this.get('choice').value !== id)
          return false;
        if (prepared && typeof prepared === 'object') this.show(prepared);
      }
      if (
        prepared?.phase !== 'ready' ||
        prepared.selected !== id ||
        this.value.phase !== 'ready' ||
        this.get('choice').value !== id ||
        this.value.selected !== id
      )
        return false;
      return await this.api.applyModel();
    } catch (error) {
      this.onError(error.message);
      return false;
    } finally {
      if (this.localSwitchOperation === operation) {
        this.localSwitchOperation = null;
        this.show(this.value);
      }
    }
  }
  size(profile) {
    const value = new Intl.NumberFormat(this.ui.language, { maximumFractionDigits: 2 }).format(
      profile.sizeBytes / 1e9,
    );
    return (profile.sizeEstimated ? '≈ ' : '') + value + ' GB';
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (!open) void this.voices.stopPreview();
    if (open) {
      if (this.api.inferenceApiStatus) {
        try {
          this.setupRequired = (await this.api.inferenceApiStatus()).setupRequired === true;
        } catch (error) {
          this.onError(error.message);
        }
      }
      this.show(await this.api.refreshModels());
      void this.devices.refresh();
      if (this.api.huggingFaceStatus) await this.hub.refresh();
      if (this.api.voiceCatalog) await this.voices.refresh(this.conversationLanguage);
      this.ui.apply(this.ui.language);
    }
    return true;
  }
}
