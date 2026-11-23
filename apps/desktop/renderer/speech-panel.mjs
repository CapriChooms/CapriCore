import {
  MICROPHONE_GAIN,
  SPEECH_DEFAULTS,
  SPEECH_PAUSE,
  validateSpeechSettings,
} from './speech-settings.mjs';
import { uiText } from './interface-translations.mjs';

export class SpeechPanel {
  constructor({
    api,
    ui = { text: (value, params) => uiText(value, 'en', params), language: 'en' },
    onOpen,
    onError,
  }) {
    Object.assign(this, { api, ui, onOpen, onError });
    this.panel = document.getElementById('speech-panel');
    this.input = document.getElementById('speech-pause');
    this.output = document.getElementById('speech-pause-value');
    this.apply = document.getElementById('speech-apply');
    Object.assign(this.input, {
      min: String(SPEECH_PAUSE.min),
      max: String(SPEECH_PAUSE.max),
      step: String(SPEECH_PAUSE.step),
    });
    this.input.addEventListener('input', () => this.renderValue());
    this.apply.addEventListener('click', () => this.save());
    document.getElementById('speech-reset').addEventListener('click', () => {
      this.input.value = SPEECH_DEFAULTS.trailingSilenceSeconds;
      this.renderValue();
    });
    document.getElementById('speech-close').addEventListener('click', () => this.open(false));
    this.show(SPEECH_DEFAULTS);
  }
  bindGain(input, output, preview) {
    this.gainInput = input;
    this.gainOutput = output;
    this.previewGain = preview;
    input.min = MICROPHONE_GAIN.min;
    input.max = MICROPHONE_GAIN.max;
    input.value = this.value.microphoneGain;
    input.addEventListener('input', () => this.renderValue());
    this.renderValue();
  }
  draft() {
    return {
      trailingSilenceSeconds: Number(this.input.value),
      ...(this.gainInput && { microphoneGain: Number(this.gainInput.value) }),
    };
  }
  renderValue() {
    this.output.textContent = this.ui.text('{value} s', {
      value: new Intl.NumberFormat(this.ui.language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(Number(this.input.value)),
    });
    if (this.gainInput) {
      this.gainOutput.value = new Intl.NumberFormat(this.ui.language, { style: 'percent' }).format(
        Number(this.gainInput.value) / 100,
      );
      this.previewGain();
    }
  }
  show(value) {
    this.value = validateSpeechSettings(value);
    this.input.value = this.value.trailingSilenceSeconds;
    if (this.gainInput) this.gainInput.value = this.value.microphoneGain;
    this.renderValue();
  }
  async save() {
    if (this.apply.disabled) return;
    this.apply.disabled = true;
    try {
      this.show(await this.api.setSpeechSettings(this.draft()));
      return true;
    } catch {
      this.onError('Microphone settings could not be saved.');
      return false;
    } finally {
      this.apply.disabled = false;
    }
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (open) {
      this.show(this.value);
      this.input.focus();
    } else document.getElementById('settings-open')?.focus();
  }
}
