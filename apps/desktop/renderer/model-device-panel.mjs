// SPDX-License-Identifier: GPL-3.0-only
export class ModelDevicePanel {
  constructor({ api, ui, host, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.className = 'settings-card model-device-card';
    this.panel.innerHTML = `<h3>Model devices</h3>
      <label for="model-device-language">Language model device</label><select id="model-device-language" aria-describedby="model-device-language-reason"></select>
      <p id="model-device-language-reason" class="settings-help" role="status"></p>
      <label for="model-device-voice">Voice model device</label><select id="model-device-voice" aria-describedby="model-device-voice-reason"></select>
      <p id="model-device-voice-reason" class="settings-help" role="status"></p>
      <p class="settings-help">Choose independently for language and voice. CPU uses system RAM and can be slower. An external API runs on the provider's hardware.</p>
      <div class="settings-actions"><button type="button" id="model-device-refresh">Refresh devices</button><button type="button" id="model-device-apply">Save and restart Capri</button></div>
      <p id="model-device-status" class="settings-help" role="status" aria-live="polite"></p>`;
    host.append(this.panel);
    this.get = (id) => this.panel.querySelector('#model-device-' + id);
    for (const role of ['language', 'voice']) this.get(role).onchange = () => this.details();
    this.get('refresh').onclick = () => this.refresh();
    this.get('apply').onclick = async () => {
      this.busy = true;
      this.details();
      try {
        await api.applyModelDevices({
          language: this.get('language').value,
          voice: this.get('voice').value,
        });
      } catch (error) {
        onError(error.message);
      } finally {
        this.busy = false;
        this.details();
      }
    };
    this.details();
  }
  show(value) {
    this.value = value;
    for (const role of ['language', 'voice']) {
      this.get(role).replaceChildren(
        ...value.options[role].map((device) => {
          const label =
            device.id === 'auto'
              ? this.ui.text('Automatic')
              : device.id === 'cpu'
                ? 'CPU'
                : `${device.name}${device.backend ? ' · ' + device.backend.toUpperCase() : ''}${device.available ? '' : ' · ' + this.ui.text('Unavailable')}`;
          const option = new Option(label, device.id);
          option.dataset.untranslated = '';
          return option;
        }),
      );
      if (!value.options[role].some((x) => x.id === value.current[role])) {
        const option = new Option(this.ui.text('Selected GPU is unavailable'), value.current[role]);
        option.dataset.untranslated = '';
        this.get(role).append(option);
      }
      this.get(role).value = value.current[role];
    }
    this.details();
  }
  details() {
    let valid = Boolean(this.value),
      changed = false;
    for (const role of ['language', 'voice']) {
      const selected = this.value?.options[role].find((x) => x.id === this.get(role).value);
      const available = selected?.available === true;
      valid &&= available;
      changed ||= this.get(role).value !== this.value?.current[role];
      this.get(role).disabled = this.busy || !this.value;
      this.get(role + '-reason').textContent =
        this.value && !available
          ? this.ui.text(selected?.reason ?? 'Selected GPU is unavailable')
          : '';
      this.get(role + '-reason').classList.toggle(
        'model-device-error',
        Boolean(this.value && !available),
      );
    }
    this.get('apply').disabled = this.busy || !valid || !changed;
    this.get('refresh').disabled = Boolean(this.busy);
  }
  async refresh() {
    if (!this.api.modelDevices) return;
    this.busy = true;
    this.details();
    this.get('status').textContent = this.ui.text('Checking available devices...');
    try {
      this.show(await this.api.modelDevices());
      this.get('status').textContent = '';
    } catch (error) {
      this.get('status').textContent = this.ui.text('Device discovery failed. Try refreshing.');
      this.onError(error.message);
    } finally {
      this.busy = false;
      this.details();
    }
  }
}
