// SPDX-License-Identifier: GPL-3.0-only
import {
  MUSIC_LISTENING_DEFAULTS as defaults,
  musicTempoReady,
} from '../music-listening-settings.mjs';
const capturePhases = new Set(['listening', 'active', 'monitoring', 'running']);
export const musicCaptureActive = (value = {}) =>
  value.enabled === true || value.captureActive === true || capturePhases.has(value.phase);

export function musicListeningLabel(value = {}) {
  if (
    value.supported === false ||
    value.error ||
    ['error', 'unavailable', 'failed'].includes(value.phase)
  )
    return 'Unavailable';
  if (['sleeping', 'paused', 'locked'].includes(value.phase)) return 'Paused';
  if (['preparing', 'loading', 'downloading'].includes(value.phase))
    return 'Preparing music detection…';
  if (['starting', 'arming', 'connecting'].includes(value.phase)) return 'Connecting system audio…';
  if (value.hearingMusic === true && musicCaptureActive(value)) return 'Music detected';
  if (musicCaptureActive(value)) {
    if (value.speechScore >= 0.6 && value.musicScore < 0.5) return 'Speech detected';
    return 'Listening';
  }
  return 'Off';
}

export class MusicListeningPanel {
  constructor({
    api,
    ui,
    onError,
    onChange = () => {},
    onCommitted = () => {},
    revision = () => undefined,
  }) {
    Object.assign(this, { api, ui, onError, onChange, onCommitted, revision });
    this.value = { phase: 'off', settings: { ...defaults } };
    this.panel = document.createElement('section');
    this.panel.id = 'music-listening-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.panel.innerHTML = `<h2>Music listening</h2><div class="preferences-content"><div class="settings-card">
      <p class="settings-help" data-inline-help>Analyze system sound locally to react to music. No microphone is required; audio is not saved or sent to an API.</p>
      <p id="music-listening-status" role="status" aria-live="polite"></p>
      <p id="music-listening-error" role="status" hidden></p>
      <label><input id="music-listening-auto-bpm" type="checkbox"> Automatically match the track BPM</label>
      </div><div class="settings-card">
      <label><input id="music-listening-enabled" type="checkbox"> Music animations</label>
      <label><input id="music-listening-notes" type="checkbox"> Floating notes</label>
      <label><input id="music-listening-motion" type="checkbox"> Move to the music</label>
    </div></div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (id) =>
      this.panel.querySelector('#music-listening-' + (id === 'autoBpm' ? 'auto-bpm' : id));
    for (const id of Object.keys(defaults)) this.get(id).onchange = () => this.onChange();
    this.show(this.value);
  }
  draft() {
    return {
      enabled: this.get('enabled').checked,
      notes: this.get('notes').checked,
      motion: this.get('motion').checked,
      autoBpm: this.get('autoBpm').checked,
    };
  }
  show(value = this.value, { preserveDraft = false } = {}) {
    const settings = { ...defaults, ...(value.settings ?? {}) };
    this.value = { ...this.value, ...value, settings };
    if (!preserveDraft) for (const id of Object.keys(defaults)) this.get(id).checked = settings[id];
    this.status(this.value);
  }
  status(value = this.value) {
    this.value = {
      ...this.value,
      ...value,
      settings: { ...defaults, ...(value.settings ?? this.value.settings) },
    };
    const label = musicListeningLabel(this.value);
    this.get('status').textContent =
      this.ui.text(label) +
      (label === 'Music detected'
        ? ` · BPM ${musicTempoReady(this.value) ? Math.round(this.value.tempo) : '…'}`
        : '');
    this.get('error').textContent = this.value.error ? this.ui.text(this.value.error) : '';
    this.get('error').hidden = !this.value.error;
  }
  async open({ preserveDraft = false } = {}) {
    try {
      this.show(await this.api.musicStatus(), { preserveDraft });
    } catch (error) {
      this.onError(error.message);
    }
  }
  async save() {
    try {
      const snapshot = await this.api.setMusicSettings(this.draft(), this.revision());
      this.show(snapshot);
      this.onCommitted(snapshot);
      return true;
    } catch (error) {
      this.onError(error.message);
      return false;
    }
  }
}
