import {
  VOICE_EFFECT_DEFAULTS,
  VOICE_EFFECT_PRESETS,
  VOICE_EFFECT_LIMITS,
  validateVoiceEffects,
} from './voice-effects-settings.mjs';

export class VoiceEffectsPanel {
  constructor({
    api,
    ui = { text: (value) => value, language: 'en' },
    onSettings,
    onOpen,
    onError,
    deferDrafts = false,
  }) {
    Object.assign(this, { api, ui, onSettings, onOpen, onError, deferDrafts });
    this.settings = { ...VOICE_EFFECT_DEFAULTS };
    this.panel = document.getElementById('voice-effects-panel');
    this.inputs = new Map();
    this.revision = 0;
    for (const [key, label] of Object.entries({
      intensity: 'Intensity',
      mix: 'Effect mix',
      reverb: 'Room / reverb',
      delay: 'Short delay',
      filter: 'Radio filtering',
      glitch: 'Glitch frequency',
      electronicMix: 'Electronic voice blend',
      carrierHz: 'Electronic carrier frequency (Hz)',
    })) {
      const row = document.createElement('label');
      row.className = 'dimming-label';
      row.htmlFor = `fx-${key}`;
      row.append(label);
      const output = document.createElement('output');
      row.append(output);
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `fx-${key}`;
      input.min = key === 'carrierHz' ? '20' : '0';
      input.max = String(VOICE_EFFECT_LIMITS[key]);
      input.step = '1';
      input.addEventListener('input', () =>
        this.save({ ...this.settings, preset: 'custom', [key]: Number(input.value) }),
      );
      document.getElementById('voice-effects-controls').append(row, input);
      this.inputs.set(key, { input, output });
    }
    document
      .getElementById('voice-effects-enabled')
      .addEventListener('change', (event) =>
        this.save({ ...this.settings, enabled: event.target.checked }),
      );
    document.getElementById('voice-effects-preset').addEventListener('change', (event) => {
      const preset = VOICE_EFFECT_PRESETS[event.target.value];
      if (preset) this.save(preset);
    });
    document
      .getElementById('voice-effects-reset')
      .addEventListener('click', () => this.save(VOICE_EFFECT_DEFAULTS));
    document
      .getElementById('voice-effects-close')
      .addEventListener('click', () => this.open(false));
    document.getElementById('voice-effects-preview').addEventListener('click', async () => {
      if (this.previewPending) return;
      this.previewPending = true;
      this.availability(this.available);
      try {
        await this.api.previewVoice(this.settings);
      } catch {
        this.onError('Voice preview could not start. Check the local voice service and try again.');
      } finally {
        this.previewPending = false;
        this.availability(this.available);
      }
    });
  }
  show(value, { draft = false } = {}) {
    this.settings = validateVoiceEffects(value);
    if (!draft) this.savedSettings = this.settings;
    this.onSettings(this.settings);
    document.getElementById('voice-effects-enabled').checked = value.enabled;
    document.getElementById('voice-effects-preset').value = value.preset;
    for (const [key, { input }] of this.inputs) input.value = String(this.settings[key]);
    this.refreshLocale();
  }
  refreshLocale() {
    const format = new Intl.NumberFormat(this.ui.language, {
      style: 'percent',
      maximumFractionDigits: 0,
    });
    for (const [key, { output }] of this.inputs)
      output.textContent =
        key === 'carrierHz' ? this.settings[key] + ' Hz' : format.format(this.settings[key] / 100);
    this.availability(this.available);
  }
  save(value) {
    if (this.deferDrafts) {
      this.show(value, { draft: true });
      return;
    }
    const revision = ++this.revision;
    this.show(validateVoiceEffects(value));
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.pending = (this.pending ?? 0) + 1;
      this.tail = (this.tail ?? Promise.resolve())
        .catch(() => {})
        .then(() => this.api.setVoiceEffects(value))
        .then((saved) => {
          if (revision === this.revision) this.show(saved);
        })
        .catch(() => this.onError('Voice effects could not be saved.'))
        .finally(() => this.pending--);
    }, 100);
  }
  async commit() {
    this.show(await this.api.setVoiceEffects(this.settings));
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    if (!open && this.previewPending) this.api.stopVoice().catch(() => {});
    this.panel.hidden = !open;
    if (open) document.getElementById('voice-effects-preset').focus();
    else document.getElementById('settings-open')?.focus();
  }
  availability(available) {
    this.available = available;
    const button = document.getElementById('voice-effects-preview');
    button.disabled = !available || Boolean(this.previewPending);
    button.title = this.ui.text(
      this.previewPending
        ? 'Preparing voice preview…'
        : available
          ? 'Preview without changing automatic voice replies.'
          : 'Wait for the current reply or playback to finish.',
    );
  }
}
