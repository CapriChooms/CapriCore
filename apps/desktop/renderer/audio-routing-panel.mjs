// SPDX-License-Identifier: GPL-3.0-only
import { VOICE_VOLUME_MAX } from './voice-volume.mjs';

const routeNames = ['microphone', 'speaker', 'music', 'system', 'call'];

function audioOption(value, label) {
  const option = new Option(label, value);
  option.dir = 'auto';
  option.dataset.untranslated = '';
  return option;
}

export class AudioRoutingPanel {
  constructor({ api, ui, onError, onOpenSettings }) {
    Object.assign(this, { api, ui, onError, onOpenSettings });
    this.panel = document.createElement('section');
    this.panel.id = 'audio-routing-panel';
    this.panel.className = 'preferences-panel';
    this.panel.dataset.panelCut = '12';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <h2>Audio</h2>
      <div class="preferences-content">
        <div class="settings-actions">
          <button type="button" id="audio-routing-refresh">Refresh devices</button>
          <p id="audio-routing-status" role="status" data-untranslated></p>
        </div>
        <section class="settings-card">
          <h3>Microphone</h3>
          <label for="audio-route-microphone">Microphone input</label>
          <select id="audio-route-microphone"></select>
          <div class="settings-actions"><button type="button" data-audio-settings="microphone">Microphone settings</button></div>
        </section>
        <section class="settings-card">
          <h3>Spoken voice</h3>
          <label for="audio-route-speaker">Playback device</label>
          <select id="audio-route-speaker"></select>
          <div class="call-voice-volume" id="audio-route-volume-control" hidden>
            <label for="audio-route-volume">Capri’s voice volume</label>
            <output for="audio-route-volume" id="audio-route-volume-value"></output>
            <input type="range" id="audio-route-volume" min="0" max="${VOICE_VOLUME_MAX}" step="1">
          </div>
          <div class="settings-actions"><button type="button" data-audio-settings="voice">Voice effects</button></div>
        </section>
        <section class="settings-card">
          <h3>Music listening</h3>
          <label for="audio-route-music">Source</label>
          <select id="audio-route-music"></select>
          <div class="settings-actions"><button type="button" data-audio-settings="music">Music animations</button></div>
        </section>
        <section class="settings-card">
          <h3>Voice calls</h3>
          <label for="audio-route-system">Listen to mic and system audio</label>
          <select id="audio-route-system"></select>
          <label for="audio-route-call">Call output device</label>
          <select id="audio-route-call"></select>
          <p id="audio-route-call-status" role="status" data-untranslated></p>
          <div class="settings-actions"><button type="button" data-audio-settings="calls">Set up virtual microphone</button></div>
        </section>
      </div>`;
    this.selects = Object.fromEntries(
      routeNames.map((route) => [route, this.panel.querySelector(`#audio-route-${route}`)]),
    );
    this.refresh = this.panel.querySelector('#audio-routing-refresh');
    this.status = this.panel.querySelector('#audio-routing-status');
    this.callStatus = this.panel.querySelector('#audio-route-call-status');
    this.volumeControl = this.panel.querySelector('#audio-route-volume-control');
    this.volume = this.panel.querySelector('#audio-route-volume');
    this.volumeValue = this.panel.querySelector('#audio-route-volume-value');
    this.volume.oninput = () => this.renderVolumeValue();
    this.volume.onchange = () => void this.saveVolume(this.volume.valueAsNumber);
    this.refresh.onclick = () => void this.open();
    for (const [route, select] of Object.entries(this.selects))
      select.onchange = () => void this.save(route, select.value);
    for (const button of this.panel.querySelectorAll('[data-audio-settings]'))
      button.onclick = () => void this.onOpenSettings(button.dataset.audioSettings);
    this.render();
  }

  show(value) {
    this.value = { ...this.value, ...value };
    this.render();
  }

  render() {
    const {
      devices = {},
      routes = {},
      routeLabels = {},
      microphone = {},
      callOutput,
      voiceVolume,
    } = this.value ?? {};
    const endpoints = devices.endpoints ?? [];
    const callOutputs = devices.callOutputs ?? devices.outputs ?? [];
    for (const [route, select] of Object.entries(this.selects)) {
      const microphoneRoute = route === 'microphone';
      const isSource = route === 'music' || route === 'system';
      const selection = microphoneRoute ? microphone.deviceId : routes[route];
      const label = microphoneRoute ? microphone.deviceLabel : routeLabels[route];
      select.replaceChildren(
        audioOption('', this.ui.text(route === 'call' ? 'Automatic' : 'System default')),
      );
      if (isSource) {
        for (const [kind, title] of [
          ['input', 'Input devices'],
          ['output', 'Playback devices (loopback)'],
        ]) {
          const choices = endpoints.filter((device) => device.kind === kind);
          if (!choices.length) continue;
          const group = document.createElement('optgroup');
          group.label = this.ui.text(title);
          group.append(...choices.map(({ id, label }) => audioOption(id, label)));
          select.append(group);
        }
      } else {
        const choices =
          route === 'call'
            ? callOutputs
            : ((microphoneRoute ? devices.inputs : devices.outputs) ?? []);
        select.append(...choices.map(({ id, label }) => audioOption(id, label)));
      }
      if (selection && !Array.from(select.options).some(({ value }) => value === selection)) {
        const unavailable = label
          ? this.ui.text('Unavailable — {device}', { device: label })
          : this.ui.text('Unavailable');
        const option = audioOption(selection, unavailable);
        option.disabled = true;
        select.append(option);
      }
      select.value = selection || '';
    }
    const readiness = callOutput?.ready ? 'Call output is ready.' : 'Call output is off.';
    const callDevice =
      callOutput?.deviceLabel || callOutputs.find(({ id }) => id === callOutput?.deviceId)?.label;
    this.callStatus.textContent = callOutput
      ? [this.ui.text(readiness), callOutput.ready && callDevice].filter(Boolean).join(' · ')
      : '';
    this.volumeControl.hidden = !Number.isFinite(voiceVolume) || !this.api.setVoiceVolume;
    if (!this.volumeControl.hidden) {
      this.volume.value = voiceVolume;
      this.renderVolumeValue();
    }
    this.renderPending();
  }

  renderVolumeValue() {
    this.volumeValue.value = new Intl.NumberFormat(this.ui.language, { style: 'percent' }).format(
      this.volume.valueAsNumber / 100,
    );
    this.volume.setAttribute('aria-valuetext', this.volumeValue.value);
  }

  renderPending() {
    this.panel.setAttribute('aria-busy', String(Boolean(this.pending)));
    this.refresh.disabled = Boolean(this.pending);
    this.volume.disabled = Boolean(this.pending);
    this.status.textContent = this.ui.text(
      this.pending === 'refresh'
        ? 'Checking available devices...'
        : this.error || this.value?.error || '',
    );
    for (const [route, select] of Object.entries(this.selects))
      select.disabled =
        !this.value ||
        Boolean(this.pending) ||
        (this.value.supported === false && ['system', 'music', 'call'].includes(route));
  }

  open() {
    return this.request('refresh', () => this.api.audioRouting());
  }

  save(route, deviceId) {
    return this.request(route, () =>
      route === 'microphone'
        ? this.api.setAudioMicrophone(deviceId)
        : this.api.setAudioRoute({ route, deviceId }),
    );
  }

  saveVolume(volume) {
    return this.request('volume', async () => {
      const value = await this.api.setVoiceVolume(volume);
      return { ...this.value, voiceVolume: value?.volume ?? volume };
    });
  }

  async request(kind, update) {
    if (this.pending) return;
    this.pending = kind;
    this.error = '';
    this.renderPending();
    try {
      const value = await update();
      this.value = value?.routes ? value : await this.api.audioRouting();
    } catch (error) {
      this.error = kind === 'refresh' ? 'Audio devices could not be listed.' : '';
      this.onError(error.message);
    } finally {
      this.pending = null;
      this.render();
    }
  }
}
