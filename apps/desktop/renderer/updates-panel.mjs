// SPDX-License-Identifier: GPL-3.0-only
const messages = {
  idle: 'Check GitHub for a newer version of Capri.',
  checking: 'Checking for updates...',
  available: 'A new version is available.',
  current: 'No newer version is available on this channel.',
  downloading: 'Downloading update...',
  verifying: 'Verifying update...',
  ready: 'The update is ready to install.',
  installing: 'Preparing to restart Capri...',
  error: 'The update could not be completed.',
};
export class UpdatesPanel {
  constructor({ api, ui, onOpen, onError, deferDrafts = false }) {
    Object.assign(this, { api, ui, onOpen, onError, deferDrafts });
    this.panel = document.createElement('section');
    Object.assign(this.panel, {
      id: 'updates-panel',
      className: 'preferences-panel',
      hidden: true,
    });
    this.panel.dataset.panelCut = '12';
    this.panel.dataset.hitRegion = '';
    this.panel.setAttribute('aria-label', 'Updates');
    this.panel.innerHTML = `
      <div class="settings-heading"><h2>Updates</h2><button type="button" id="updates-close" aria-label="Close settings">×</button></div>
      <div class="preferences-content">
        <p class="update-version"><span>Installed version</span><strong id="updates-current" data-untranslated></strong></p>
        <label class="update-channel"><input id="updates-experimental" type="checkbox">Include experimental updates</label>
        <p class="settings-help">Experimental builds in the private repository are available to Lava.top subscribers with GitHub access.</p>
        <div class="settings-actions"><button type="button" id="updates-lava">View Lava.top subscription</button></div>
        <p class="settings-help">Experimental versions may contain unfinished features and bugs. Stable updates are selected by default.</p>
        <div class="update-status-card" role="status" aria-live="polite"><p id="updates-status"></p><strong id="updates-release" data-untranslated></strong><progress id="updates-progress" max="100" hidden></progress><p id="updates-transfer" data-untranslated></p><p id="updates-error"></p></div>
        <div class="settings-actions"><button type="button" id="updates-check">Check for updates</button><button type="button" id="updates-download" hidden>Download update</button><button type="button" id="updates-cancel" hidden>Cancel download</button></div>
        <div class="settings-actions"><button type="button" id="updates-install" class="update-install" hidden>Restart and update</button></div>
        <p class="settings-help" id="updates-preserve">Your history, memory, models and personal settings are kept. Capri restarts only when you choose to install.</p>
        <p class="settings-help" id="updates-source" hidden>This is a development checkout. The downloaded installer creates or updates a separate managed installation.</p>
        <p class="settings-help" id="updates-full" hidden>The full installer will open; select your current installation folder to keep your data.</p>
        <section class="settings-card">
          <h3>Release history</h3>
          <button id="updates-versions" type="button">Load versions</button>
          <label for="updates-version">Version</label><select id="updates-version" disabled></select>
          <pre id="updates-changelog" data-untranslated hidden></pre>
          <p id="updates-history-status" role="status"></p>
          <div class="settings-actions">
            <button id="updates-select" type="button" hidden>Choose this update</button>
            <button id="updates-release-page" type="button" hidden>Open on GitHub</button>
          </div>
        </section>
        <section class="github-access-card">
          <h3 data-untranslated>GitHub</h3><p class="settings-help">Public updates do not require a GitHub account or token.</p><p id="updates-access-status" class="settings-help" role="status"></p>
          <details id="updates-access-details"><summary><span>Connect GitHub for private updates</span> <code data-untranslated>CapriChooms/Capri</code></summary>
            <label for="updates-token">GitHub access token</label><input id="updates-token" type="password" maxlength="255" autocomplete="new-password" spellcheck="false" dir="ltr" data-untranslated placeholder="ghp_… / github_pat_…">
            <div class="settings-actions"><button type="button" id="updates-connect">Save and check access</button><button type="button" id="updates-forget">Remove saved access</button></div>
            <details class="settings-help"><summary>Create read-only token</summary>
              <ol><li>Open GitHub and create a fine-grained token.</li><li>Select CapriChooms as resource owner, only the Capri repository, and Contents: Read-only.</li><li>Copy the token below. If GitHub shows Pending, the organization owner must approve it first.</li></ol>
              <button type="button" id="updates-token-page">Create read-only token</button>
              <p>Accept the organization invitation or ask Overyx for membership with Read access. GitHub fine-grained tokens do not support outside collaborators on organization repositories. Existing GitHub CLI or classic tokens also work; classic token scopes are broader, so organization membership with a read-only token is preferred.</p>
              <div class="settings-actions"><button type="button" id="updates-classic-token-page"><span>GitHub access token</span><code data-untranslated> (classic · repo)</code></button></div>
            </details>
            <p class="settings-help">The token is encrypted for your Windows account and stays on this PC. Capri uses it only to read releases and download files. Never send your token in a bug report.</p>
          </details>
        </section>
        <p class="settings-help">Updates come from CapriChooms/CapriCore on GitHub and are checked with SHA-256 before installation.</p>
      </div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (id) => this.panel.querySelector('#updates-' + id);
    this.get('lava').onclick = () =>
      api.communityLink('lava').catch((error) => onError(error.message));
    let history = [];
    const selectedVersion = () => history.find(({ id }) => id === this.get('version').value);
    const showVersion = () => {
      const selected = selectedVersion();
      this.get('changelog').hidden = !selected;
      this.get('changelog').textContent = selected?.notes || this.ui.text('No release notes.');
      this.get('select').hidden = !selected?.update;
      this.get('release-page').hidden = !selected;
    };
    this.get('version').onchange = showVersion;
    this.get('versions').onclick = async () => {
      const load = this.get('versions');
      load.disabled = true;
      try {
        const result = await api.updateVersions(this.channel().experimental);
        history = result.releases;
        this.get('version').replaceChildren(
          ...history.map(({ id, tag, experimental }) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = experimental ? tag + ' · ' + this.ui.text('Experimental') : tag;
            return option;
          }),
        );
        this.get('version').disabled = !history.length;
        this.get('history-status').textContent = this.ui.text(
          result.previewUnavailable
            ? 'Private preview versions are unavailable. Connect GitHub to see them.'
            : history.length
              ? ''
              : 'No releases found.',
        );
        showVersion();
      } catch (error) {
        onError(error.message);
      } finally {
        load.disabled = false;
      }
    };
    this.get('select').onclick = async () => {
      try {
        this.show(await api.chooseUpdateVersion(selectedVersion()?.id));
      } catch (error) {
        onError(error.message);
      }
    };
    this.get('release-page').onclick = () =>
      api.openUpdateVersion(selectedVersion()?.id).catch((error) => onError(error.message));
    this.get('close').onclick = () => this.open(false);
    this.get('token-page').onclick = () =>
      api.openGitHubTokenPage().catch((error) => onError(error.message));
    this.get('classic-token-page').onclick = () =>
      api.openGitHubTokenPage('classic').catch((error) => onError(error.message));
    this.get('connect').onclick = async () => {
      this.accessBusy = true;
      this.syncAccessControls();
      this.get('access-status').textContent = this.ui.text('Checking GitHub access…');
      try {
        this.showAccess(await api.connectGitHub(this.get('token').value));
        this.get('access-details').open = false;
        this.show(await api.checkUpdates(this.channel()));
      } catch (error) {
        this.get('access-status').textContent = this.ui.text(error.message);
        this.get('access-status').scrollIntoView({ block: 'nearest' });
      } finally {
        this.get('token').value = '';
        this.accessBusy = false;
        this.syncAccessControls();
      }
    };
    this.get('forget').onclick = async () => {
      this.accessBusy = true;
      this.syncAccessControls();
      try {
        this.showAccess(await api.removeGitHub());
        this.get('token').value = '';
      } catch (error) {
        onError(error.message);
      } finally {
        this.accessBusy = false;
        this.syncAccessControls();
      }
    };
    this.get('experimental').onchange = async () => {
      if (this.deferDrafts) {
        this.show(this.value);
        return;
      }
      try {
        await this.saveChannel();
      } catch (error) {
        this.show(this.value);
        onError(error.message);
      }
    };
    for (const [id, work] of [
      ['check', () => api.checkUpdates(this.channel())],
      ['download', () => api.downloadUpdate()],
      ['cancel', () => api.cancelUpdate()],
      ['install', () => api.installUpdate()],
    ])
      this.get(id).onclick = async () => {
        this.get(id).disabled = true;
        try {
          const result = await work();
          if (result && typeof result === 'object') this.show(result);
        } catch (error) {
          onError(error.message);
        } finally {
          if (this.value) this.show(this.value);
        }
      };
  }
  channel() {
    return { experimental: this.get('experimental').checked };
  }
  async saveChannel() {
    this.show(await this.api.setUpdateSettings(this.channel()), { resetChannel: true });
  }
  show(value, { resetChannel = false } = {}) {
    if (!value) return;
    const pending =
      this.deferDrafts &&
      !resetChannel &&
      this.value &&
      this.channel().experimental !== this.value.experimental;
    this.value = value;
    const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(value.phase);
    this.get('current').textContent = value.current;
    if (!pending) this.get('experimental').checked = value.experimental;
    const currentChannel =
      value.checkedExperimental === undefined ||
      value.checkedExperimental === this.channel().experimental;
    this.get('experimental').disabled = busy;
    this.get('status').textContent = this.ui.text(
      ((currentChannel || busy) && messages[value.phase]) || messages.idle,
    );
    this.get('release').textContent = currentChannel
      ? [value.release?.tag, value.release?.repository].filter(Boolean).join(' · ')
      : '';
    this.get('error').textContent = currentChannel && value.error ? this.ui.text(value.error) : '';
    if (value.needsAccess) this.get('access-details').open = true;
    this.get('check').disabled = busy;
    this.get('download').hidden =
      !currentChannel || !value.release || busy || value.phase === 'ready';
    this.get('download').disabled = busy;
    this.get('cancel').hidden = !['checking', 'downloading'].includes(value.phase);
    this.get('cancel').disabled = false;
    this.get('install').hidden = !currentChannel || value.phase !== 'ready';
    this.get('install').disabled = busy;
    this.get('install').textContent = this.ui.text(
      value.mode === 'managed' && !value.installerRequired
        ? 'Restart and update'
        : 'Open installer',
    );
    this.get('source').hidden = value.mode !== 'installer';
    this.get('full').hidden = value.mode !== 'managed' || !value.installerRequired;
    this.get('preserve').hidden = value.mode !== 'managed';
    const progress = this.get('progress');
    progress.hidden = !busy;
    if (value.progress?.total)
      progress.value = (value.progress.received / value.progress.total) * 100;
    else progress.removeAttribute('value');
    this.get('transfer').textContent = value.progress
      ? `${(value.progress.received / 1048576).toFixed(1)} / ${(value.progress.total / 1048576).toFixed(1)} MB · ${(value.progress.bytesPerSecond / 1048576).toFixed(1)} MB/s`
      : '';
    this.syncAccessControls();
  }
  async open(open) {
    if ((await this.onOpen(open)) === false) return false;
    this.panel.hidden = !open;
    if (!open) this.get('token').value = '';
    if (open) {
      this.show(await this.api.updateStatus());
      if (this.api.githubStatus) this.showAccess(await this.api.githubStatus());
      this.ui.apply(this.ui.language);
    }
    return true;
  }
  showAccess(value) {
    this.access = value;
    this.get('access-status').textContent = this.ui.text(
      value.error ??
        (value.secureStorage === false
          ? 'Secure credential storage is unavailable. GitHub access was not saved.'
          : value.connected
            ? `${this.ui.text('GitHub access token')}: ${this.ui.text('Ready')}`
            : ''),
    );
    this.get('access-status').hidden = !this.get('access-status').textContent;
    this.get('forget').hidden = !value.connected && !value.error;
    this.syncAccessControls();
  }
  syncAccessControls() {
    const busy = Boolean(
      this.accessBusy ||
        this.access?.checking ||
        ['checking', 'downloading', 'verifying', 'installing'].includes(this.value?.phase),
    );
    for (const id of [
      'check',
      'experimental',
      'download',
      'install',
      'forget',
      'token',
      'token-page',
      'classic-token-page',
    ])
      this.get(id).disabled = busy;
    this.get('connect').disabled = busy || this.access?.secureStorage === false;
  }
}
