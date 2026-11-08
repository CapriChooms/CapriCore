import {
  LANGUAGE_DEFAULTS,
  LANGUAGE_PACKS,
  INTERFACE_LOCALES,
  languageBehaviorChanged,
  resolveLanguages,
  validateLanguages,
} from './language-settings.mjs';

export class LanguagePanel {
  constructor({ api, ui, onChange, onOpen, onError, confirm }) {
    Object.assign(this, { api, ui, onChange, onOpen, onError, confirm });
    this.value = { ...LANGUAGE_DEFAULTS };
    this.panel = document.getElementById('language-panel');
    this.populate = (id, choices) =>
      document.getElementById(`language-${id}`).replaceChildren(
        ...choices.map(([value, label]) => {
          const option = new Option(label, value);
          option.dir = 'auto';
          option.dataset.untranslated = '';
          return option;
        }),
      );
    this.populate(
      'interface',
      INTERFACE_LOCALES.map((locale) => [locale.id, locale.nativeName]),
    );
    this.populate('speech', [
      ['follow', 'Automatic'],
      ['off', 'Text replies only'],
    ]);
    document.getElementById('language-close').addEventListener('click', () => this.open(false));
    document.getElementById('language-custom').addEventListener('input', () => this.details());
    document.getElementById('language-install-speech').onclick = () =>
      this.installSelected().catch((error) => this.onError(error.message));
    document.getElementById('language-install-cancel').onclick = () =>
      this.api.cancelSpeechInstall().catch((error) => this.onError(error.message));
    document.getElementById('language-install-report').onclick = () =>
      this.api
        .bugReport({ category: 'voice', description: 'Voice installation failed.' })
        .catch((error) => this.onError(error.message));
    for (const key of ['conversation', 'recognition', 'speech'])
      document.getElementById(`language-${key}`).addEventListener('change', () => this.details());
    document.getElementById('language-apply').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      try {
        button.disabled = true;
        await this.apply();
      } catch (error) {
        this.onError(error.message || 'Language settings could not be saved.');
      } finally {
        button.disabled = false;
      }
    });
  }
  draft() {
    const value = {
      ...this.value,
      autoDetect: false,
      customConversation: document.getElementById('language-custom').value,
    };
    for (const key of ['interface', 'conversation', 'recognition', 'speech'])
      value[key] = document.getElementById(`language-${key}`).value;
    if (
      value.speech === 'follow' &&
      value.conversation === this.value.conversation &&
      !['follow', 'off'].includes(this.value.speech)
    )
      value.speech = this.value.speech;
    return value;
  }
  async apply() {
    const draft = validateLanguages(this.draft());
    if (draft.interface !== this.value.interface && !languageBehaviorChanged(this.value, draft)) {
      this.show(await this.api.setLanguages(draft));
      return true;
    }
    if (this.installation?.phase === 'installing') return false;
    if (this.api.speechAvailability) this.speechAvailability = await this.api.speechAvailability();
    const speech = resolveLanguages(draft).speech;
    if (speech !== 'off' && this.speechAvailability?.[speech] === false) {
      const choice = await this.confirm.ask({
        title: 'Selected voice is not installed',
        detail:
          'Capri can install the selected voice automatically in its own folder. No ZIP files, destination folders or terminal commands are needed. Keep Capri open until installation finishes.',
        choices: [
          { id: 'cancel', label: 'Stay here' },
          { id: 'text', label: 'Use text replies' },
          { id: 'install', label: 'Install and enable' },
        ],
      });
      if (choice === 'install') {
        await this.installSelected(draft);
        return false;
      }
      if (choice !== 'text') return false;
      draft.speech = 'off';
    }
    this.show(await this.api.setLanguages(draft));
    return true;
  }
  async beforeClose() {
    if (this.installation?.phase === 'installing') return true;
    if (JSON.stringify(this.draft()) === this.savedDraft) return true;
    const choice = await this.confirm.ask({
      title: 'Unsaved language changes',
      detail: 'Apply your language choices before leaving?',
      choices: [
        { id: 'cancel', label: 'Stay here' },
        { id: 'discard', label: 'Discard changes', danger: true },
        { id: 'save', label: 'Apply and leave' },
      ],
    });
    if (choice === 'cancel') return false;
    if (choice === 'discard') {
      this.show(this.value);
      return true;
    }
    try {
      return (await this.apply()) !== false;
    } catch (error) {
      this.onError(error.message);
      return false;
    }
  }
  details() {
    const conversation = document.getElementById('language-conversation').value;
    document.getElementById('language-voice-help').textContent = this.ui.text(
      'Choose the conversation language above. Automatic uses the matching Capri voice. Missing voices can be installed here with one button. No separate voice ZIP is needed.',
    );
    const packForVoice = LANGUAGE_PACKS.find((p) => p.id === conversation);
    const voiceLabel = packForVoice
      ? this.ui.languageName(packForVoice.id)
      : document.getElementById('language-custom').value.trim() || this.ui.text('Other language');
    const engine = packForVoice?.speechReady
      ? conversation === 'en'
        ? 'Capri English'
        : 'multilingual Capri'
      : 'text only';
    const speech = document.getElementById('language-speech');
    const installed =
      !packForVoice?.speechReady || this.speechAvailability?.[conversation] !== false;
    speech.options[0].text = `${this.ui.text('Automatic')} — ${voiceLabel} / ${this.ui.text(engine)}${installed ? '' : ' / ' + this.ui.text('Not installed')}`;
    speech.options[1].text = this.ui.text('Text replies only');
    speech.title = speech.selectedOptions[0]?.text ?? '';
    document.getElementById('language-custom-label').hidden = conversation !== 'custom';
    document.getElementById('language-custom').hidden = conversation !== 'custom';
    const resolved = resolveLanguages({
      conversation,
      recognition: document.getElementById('language-recognition').value,
      speech: document.getElementById('language-speech').value,
    });
    const pack = LANGUAGE_PACKS.find((p) => p.id === resolved.recognition);
    const automaticPack = LANGUAGE_PACKS.find((p) => p.id === conversation);
    const automaticRecognizer = automaticPack?.recognizer.startsWith('parakeet')
      ? 'Parakeet'
      : 'Whisper';
    document.getElementById('language-recognition').options[0].textContent =
      this.ui.text('Automatic') +
      ' · ' +
      (automaticPack ? this.ui.languageName(conversation) + ' / ' : '') +
      automaticRecognizer;
    const unavailable =
      this.availability &&
      resolved.recognition !== 'off' &&
      !this.availability[resolved.recognition];
    const missingVoice =
      resolved.speech !== 'off' &&
      this.speechAvailability &&
      !this.speechAvailability[resolved.speech];
    const installButton = document.getElementById('language-install-speech');
    const busy = this.installation?.phase === 'installing';
    installButton.hidden = (!missingVoice && !unavailable) || busy;
    installButton.textContent = this.ui.text('Install and enable');
    document.getElementById('language-status').textContent = this.ui.text(
      missingVoice
        ? 'Voice is not installed. Use Install and enable below; Capri handles all files and applies your selected language automatically.'
        : unavailable
          ? 'Recognition is not installed. Use Install and enable below.'
          : resolved.speech === 'off'
            ? 'This language uses text replies. No matching spoken voice is available or voice is disabled.'
            : resolved.speech === 'en'
              ? 'English uses the trained Capri voice.'
              : 'Multilingual voice uses Capri’s reference recording. Accent and similarity vary by language.',
    );
    document.getElementById('language-recognition-status').textContent = this.ui.text(
      resolved.recognition === 'off'
        ? 'Microphone is unavailable for this selection.'
        : unavailable
          ? 'Recognition is not installed. Use Install and enable below.'
          : resolved.recognition === 'auto-europe'
            ? 'Fast automatic recognition of 25 European languages. Language is detected per utterance; switching languages inside one phrase may lose words. Other languages need Auto-detect / Whisper. No draft transcription is used.'
            : pack?.recognizer.startsWith('parakeet')
              ? 'Parakeet runs locally on CPU. Changing language stops the microphone.'
              : 'Whisper runs locally on CPU. Auto-detection and some languages take longer. Changing language stops the microphone.',
    );
    document.getElementById('language-install-help').hidden = !missingVoice && !unavailable;
    document.getElementById('language-install-details').hidden = !missingVoice && !unavailable;
    document.getElementById('language-install-help').textContent = this.ui.text(
      missingVoice
        ? 'Setup installs the voice for your Conversation language automatically. English uses the included Capri voice; other supported languages use one multilingual model (BETA). No separate voice ZIP is needed. NVIDIA CUDA or a supported AMD ROCm GPU on Windows 11 is required. AMD support is experimental.'
        : 'Downloads only the missing recognition components. Existing downloads are reused.',
    );
    this.renderInstallation();
  }
  async installSelected(value = this.draft()) {
    const draft = validateLanguages(value);
    const resolved = resolveLanguages(draft);
    this.pendingLanguages = draft;
    try {
      this.installStatus(
        await this.api.installSpeech({
          speech: resolved.speech,
          recognition: resolved.recognition,
        }),
      );
    } catch (error) {
      this.pendingLanguages = null;
      throw error;
    }
  }
  installStatus(value) {
    this.installation = value;
    if (document.getElementById('language-conversation').value) this.details();
    else this.renderInstallation();
    if (value.phase === 'ready' && this.pendingLanguages) {
      const draft = this.pendingLanguages;
      this.pendingLanguages = null;
      void this.api
        .setLanguages(draft)
        .then(async (saved) => {
          this.show(saved);
          if (resolveLanguages(draft).speech !== 'off') await this.api.setVoiceEnabled(true);
        })
        .catch((error) => this.onError(error.message));
    }
    if (['error', 'cancelled', 'interrupted'].includes(value.phase)) this.pendingLanguages = null;
  }
  renderInstallation() {
    const value = this.installation ?? { phase: 'idle' };
    const busy = value.phase === 'installing';
    for (const key of ['interface', 'conversation', 'recognition', 'speech', 'custom', 'apply'])
      document.getElementById('language-' + key).disabled = busy;
    const box = document.getElementById('language-install-progress');
    box.hidden = value.phase === 'idle';
    document.getElementById('language-install-cancel').hidden = !busy;
    document.getElementById('language-install-report').hidden = value.phase !== 'error';
    const labels = {
      checking: 'Checking speech components…',
      python: 'Preparing speech installer…',
      recognition: 'Installing recognition and its models…',
      'voice-pack': 'Preparing Capri’s included voice…',
      'voice-runtime': 'Installing voice dependencies…',
      'voice-models': 'Downloading multilingual voice…',
      verify: 'Checking voice files…',
    };
    const message = busy
      ? value.currentFile
        ? ({ connecting: 'Connecting', retrying: 'Reconnecting' }[value.transferState] ??
          'Downloading voice model…')
        : (labels[value.stage] ?? 'Installing voice…')
      : {
          ready: 'Voice components are installed and ready to use.',
          cancelled:
            'Installation cancelled. Downloaded files are retained; use Install and enable to continue.',
          interrupted:
            'The previous installation was interrupted. Use Install and enable to continue.',
          error: value.error,
        }[value.phase];
    document.getElementById('language-install-state').textContent =
      this.ui.text(message ?? '') +
      ((busy || value.phase === 'error') && value.currentFile ? ` · ${value.currentFile}` : '');
    const bar = document.getElementById('language-install-bar');
    if (busy) {
      const progress = value.progress;
      if (progress?.total > 0) bar.value = Math.min(1, progress.received / progress.total);
      else bar.removeAttribute('value');
    } else bar.value = value.phase === 'ready' ? 1 : 0;
    document.getElementById('language-install-keep-open').hidden = !busy;
    document.getElementById('language-install-keep-open').textContent = this.ui.text(
      'Keep Capri open during installation. You can close this panel and return to view progress.',
    );
    document.getElementById('language-install-speech').disabled = busy;
    if (busy) {
      document.getElementById('language-install-speech').hidden = false;
      document.getElementById('language-install-speech').textContent =
        this.ui.text('Installing voice…');
    }
    this.onChange();
  }
  localizeChoices(conversation, recognition) {
    this.populate('conversation', [
      ...LANGUAGE_PACKS.map((p) => [
        p.id,
        `${this.ui.languageName(p.id)}${p.speechReady ? '' : ' / ' + this.ui.text('text only')}`,
      ]),
      ['custom', this.ui.text('Other language') + ' / ' + this.ui.text('text only')],
    ]);
    this.populate('recognition', [
      ['follow', this.ui.text('Automatic')],
      ['auto', this.ui.text('Auto-detect / Whisper')],
      ['auto-europe', this.ui.text('Fast auto / English, Russian and European languages')],
      ['off', this.ui.text('Microphone unavailable')],
      ...LANGUAGE_PACKS.map((p) => [
        p.id,
        `${this.ui.languageName(p.id)} / ${p.recognizer.startsWith('parakeet') ? 'Parakeet' : 'Whisper'}`,
      ]),
    ]);
    document.getElementById('language-conversation').value = conversation;
    document.getElementById('language-recognition').value = recognition;
  }
  refreshLocale() {
    const conversation = document.getElementById('language-conversation').value;
    if (!conversation) return;
    this.localizeChoices(conversation, document.getElementById('language-recognition').value);
    this.details();
  }
  show(value) {
    this.value = validateLanguages(value);
    this.ui.apply(value.interface);
    this.localizeChoices(this.value.conversation, this.value.recognition);
    document.getElementById('language-interface').value = this.value.interface;
    // Older matching explicit choices mean the same thing as automatic here.
    document.getElementById('language-speech').value =
      this.value.speech === 'off' ? 'off' : 'follow';
    document.getElementById('language-custom').value = this.value.customConversation;
    this.details();
    this.savedDraft = JSON.stringify(this.draft());
    this.onChange();
  }
  installed(value, speech) {
    this.availability = typeof value === 'object' ? value : null;
    this.speechAvailability = speech ?? null;
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (open) document.getElementById('language-interface').focus();
    else document.getElementById('settings-open')?.focus();
    if (open && this.api.speechAvailability) {
      this.speechAvailability = await this.api.speechAvailability();
      this.details();
    }
    if (open && this.api.speechInstallStatus)
      this.installStatus(await this.api.speechInstallStatus());
  }
}
