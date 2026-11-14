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
      <div class="settings-actions"><button type="button" id="model-device-refresh">Refresh devices</button><button type="button" id="model-device-apply">Save and restart Capri</button><button type="button" id="model-device-npu-guide" hidden>Open NPU installation guide</button></div>
      <p id="model-device-status" class="settings-help" role="status" aria-live="polite"></p>
      <details class="settings-help" id="model-device-npu-advanced"><summary>Advanced NPU setup</summary></details>`;
    host.append(this.panel);
    this.get = (id) => this.panel.querySelector('#model-device-' + id);
    for (const role of ['language', 'voice']) this.get(role).onchange = () => this.details();
    this.get('refresh').onclick = () => this.refresh();
    this.get('npu-guide').onclick = async () => {
      const backend = this.selected('language')?.npuSetup;
      if (!backend) return;
      try {
        await api.nativeNpu({ op: 'install-guide', backend });
      } catch (error) {
        onError(error.message);
      }
    };
    this.get('apply').onclick = async () => {
      const npu = this.usesNpuSetup();
      this.busy = true;
      this.details();
      if (npu) this.updateNpuStatus({ stage: 'runtime' });
      const poll = npu
        ? setInterval(() => {
            void api
              .nativeNpu({ op: 'setup-status' })
              .then((status) => {
                if (this.busy && status) this.updateNpuStatus(status);
              })
              .catch(() => {});
          }, 750)
        : null;
      try {
        const applied = await api.applyModelDevices({
          language: this.get('language').value,
          voice: this.get('voice').value,
        });
        if (npu) this.get('status').textContent = applied ? ui.text('Restarting Capri...') : '';
      } catch (error) {
        if (npu) this.get('status').textContent = '';
        onError(error.message);
      } finally {
        clearInterval(poll);
        this.busy = false;
        this.details();
      }
    };
    this.details();
  }
  selected(role) {
    return this.value?.options[role].find((device) => device.id === this.get(role).value);
  }
  usesNpuSetup() {
    const selected = this.selected('language');
    return (
      selected?.backend === 'npu' &&
      (selected.id !== this.value.current.language || this.value.external)
    );
  }
  updateNpuStatus({ stage, percent }) {
    const label =
      stage === 'download'
        ? this.ui.text('Downloading the NPU model…') + ' ' + percent + '%'
        : stage === 'test'
          ? this.ui.text('Testing generation on the NPU…')
          : this.ui.text('Preparing the NPU runtime…');
    const status = this.get('status');
    if (status.textContent !== label) status.textContent = label;
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
                : `${this.ui.text(device.name)}${device.backend && device.backend !== 'npu' ? ' · ' + device.backend.toUpperCase() : ''}${device.available ? '' : ' · ' + this.ui.text('Unavailable')}`;
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
    const npu = this.usesNpuSetup();
    for (const role of ['language', 'voice']) {
      const selected = this.selected(role);
      const available = selected?.available === true;
      valid &&= available;
      changed ||= this.get(role).value !== this.value?.current[role];
      this.get(role).disabled = this.busy || !this.value;
      this.get(role + '-reason').textContent =
        this.value && !available
          ? this.ui.text(selected?.reason ?? 'Selected GPU is unavailable')
          : role === 'language' && selected?.npuSetup
            ? this.ui.text('Capri will prepare and test this model automatically.') +
              ` ${selected.model} · ≈ ${(selected.bytes / 1024 ** 3).toFixed(1)} GiB`
            : '';
      this.get(role + '-reason').classList.toggle(
        'model-device-error',
        Boolean(this.value && !available),
      );
    }
    this.get('apply').disabled = this.busy || !valid || !(changed || npu);
    this.get('apply').textContent = this.ui.text(
      npu ? 'Set up NPU and restart' : 'Save and restart Capri',
    );
    this.get('npu-advanced').querySelector('summary').textContent =
      this.ui.text('Advanced NPU setup');
    this.get('npu-guide').hidden = !this.selected('language')?.installLink;
    this.get('npu-guide').disabled = Boolean(this.busy);
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
