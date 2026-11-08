// SPDX-License-Identifier: GPL-3.0-only
export class DiscordPanel {
  constructor({ api, ui, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.id = 'discord-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.panel.innerHTML = `<h2>Discord presence <small class="beta-badge">BETA</small></h2>
      <div class="preferences-content"><div class="settings-card">
      <div class="settings-actions"><button id="discord-portal" type="button">Open Discord Developer Portal</button></div>
      <ol class="settings-help">
        <li>Click New Application and name it Capri.</li>
        <li>In General Information, copy the Application ID.</li>
        <li>Paste the ID, turn on the checkbox and save when closing Settings.</li>
      </ol>
      <p class="settings-help">Keep Discord Desktop open and enable sharing in User Settings → Activity Sharing.</p>
      <label for="discord-application">Discord Application ID</label><input id="discord-application" type="text" inputmode="numeric" maxlength="22" autocomplete="off" spellcheck="false" data-untranslated>
      <label><input id="discord-enabled" type="checkbox"> Show Capri in my Discord activity</label>
      <div class="settings-actions"><button id="discord-save" type="button">Apply settings</button><button id="discord-refresh" type="button">Refresh status</button></div>
      <p id="discord-status" role="status"></p>
      <details>
        <summary>Optional activity image</summary>
        <p class="settings-help">Upload an image in your application's Rich Presence → Art Assets, then paste its asset key here. Leave this field empty for text-only activity.</p>
        <label for="discord-asset">Application image asset key</label><input id="discord-asset" type="text" maxlength="64" autocomplete="off" spellcheck="false" data-untranslated>
      </details>
      </div></div>`;
    document.getElementById('companion').append(this.panel);
    const get = (id) => this.panel.querySelector('#discord-' + id);
    this.get = get;
    get('refresh').onclick = () => this.open({ refresh: true });
    get('portal').onclick = () => api.discordPortal().catch((error) => onError(error.message));
    get('save').onclick = () => this.save();
  }
  async save() {
    const get = this.get;
    get('save').disabled = true;
    try {
      this.show(
        await this.api.setDiscordPresence({
          enabled: get('enabled').checked,
          applicationId: get('application').value.trim(),
          assetKey: get('asset').value.trim(),
        }),
      );
      return true;
    } catch (error) {
      this.onError(error.message);
      return false;
    } finally {
      get('save').disabled = false;
    }
  }
  show(value) {
    this.value = structuredClone(value);
    this.get('enabled').checked = value.enabled;
    this.get('application').value = value.applicationId;
    this.get('asset').value = value.assetKey;
    this.status(value);
  }
  status(value) {
    const messages = {
      off: 'Discord activity is off.',
      'setup-required': 'Enter a Discord Application ID to enable activity.',
      connecting: 'Connecting to Discord...',
      connected: 'Capri activity is connected to Discord.',
      waiting: 'Waiting for Discord Desktop. Check Discord activity sharing settings.',
      unavailable: 'Discord activity is unavailable on this platform.',
    };
    this.get('status').textContent = this.ui.text(messages[value.phase] ?? messages.waiting);
  }
  async open({ refresh = false } = {}) {
    try {
      const value = await this.api.discordStatus();
      if (refresh) this.status(value);
      else this.show(value);
    } catch (error) {
      this.onError(error.message);
    }
  }
}
