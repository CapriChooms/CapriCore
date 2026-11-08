// SPDX-License-Identifier: GPL-3.0-only
export class UserToolsPanel {
  constructor({ api, ui, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.id = 'user-tools-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.innerHTML =
      '<h2>User tools</h2><div class="preferences-content"><div class="settings-card"><p>Place each tool in its own subfolder with manifest.json and its script. Discovery does not run code. Review the code, permissions and output before enabling a tool. Changed code requires approval again.</p><p>Enabled tools run in a Windows AppContainer with a timeout and no inherited credentials. File access is limited to input files you select and temporary output. Network access must be declared. Only enable code you trust with its private settings.</p><div class="settings-actions"><button id="user-tools-folder" type="button">Open tools folder</button><button id="user-tools-refresh" type="button">Refresh tools</button><button id="user-tools-example" type="button">Create example tool</button><button id="user-tools-stop" type="button">Stop user tools</button></div><p id="user-tools-status" role="status"></p></div><div id="user-tools-list"></div></div>';
    this.panel.dataset.panelCut = '12';
    for (const paragraph of this.panel.querySelectorAll('.settings-card > p:not([id])'))
      paragraph.classList.add('settings-help');
    document.getElementById('companion').append(this.panel);
    const $ = (id) => this.panel.querySelector('#' + id);
    this.$ = $;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        for (const node of this.panel.querySelectorAll('input[type=password]')) node.value = '';
        for (const node of this.panel.querySelectorAll('pre')) node.textContent = '';
      }
    });
    $('user-tools-folder').onclick = () => this.run(() => api.userToolAction({ action: 'open' }));
    $('user-tools-refresh').onclick = () =>
      this.run(async () => this.show(await api.userToolAction({ action: 'refresh' })));
    $('user-tools-example').onclick = () =>
      this.run(async () => this.show(await api.userToolAction({ action: 'example' })));
    $('user-tools-stop').onclick = () => this.run(() => api.userToolAction({ action: 'stop' }));
  }
  async run(work) {
    try {
      return await work();
    } catch (error) {
      this.onError(error.message);
    }
  }
  async open() {
    this.show(await this.api.userToolAction({ action: 'status' }));
  }
  show(rows) {
    this.$('user-tools-status').textContent =
      this.ui.text('Available user tools') + ': ' + rows.length;
    const list = this.$('user-tools-list');
    list.replaceChildren();
    for (const row of rows) {
      const card = document.createElement('article');
      card.className = 'settings-card';
      const title = document.createElement('h3'),
        description = document.createElement('p'),
        permissions = document.createElement('p');
      title.textContent = row.name ?? row.id;
      title.dataset.untranslated = '';
      description.textContent = row.description ?? this.ui.text(row.error);
      description.dataset.untranslated = '';
      permissions.textContent = [
        row.runtime,
        row.mode,
        this.ui.text(row.permissions?.network ? 'Network allowed' : 'Network blocked'),
        this.ui.text(
          row.permissions?.files === 'inputs' ? 'Selected input files only' : 'No owner files',
        ),
        row.timeoutMs + ' ms',
      ]
        .filter(Boolean)
        .join(' · ');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = this.ui.text(
        row.enabled
          ? 'Disable tool'
          : row.changed
            ? 'Review changed code and enable'
            : 'I reviewed this tool — enable',
      );
      toggle.disabled = Boolean(row.error);
      toggle.setAttribute('aria-pressed', String(row.enabled));
      toggle.onclick = () =>
        this.run(async () =>
          this.show(
            await this.api.userToolAction({ action: 'enable', id: row.id, enabled: !row.enabled }),
          ),
        );
      card.append(title, description, permissions, toggle);
      if (!row.error) {
        const secretLabel = document.createElement('label'),
          secrets = document.createElement('input'),
          save = document.createElement('button');
        secretLabel.textContent = this.ui.text(
          'Private tool settings (JSON; encrypted, never shown to the model)',
        );
        secrets.type = 'password';
        secrets.maxLength = 8000;
        secrets.spellcheck = false;
        secrets.autocomplete = 'off';
        secrets.placeholder = row.configured ? this.ui.text('Encrypted') : '{"apiKey":"…"}';
        save.type = 'button';
        save.textContent = this.ui.text('Encrypt tool settings');
        save.onclick = () =>
          this.run(async () => {
            await this.api.userToolAction({
              action: 'settings',
              id: row.id,
              settings: JSON.parse(secrets.value),
            });
            secrets.value = '';
            secrets.placeholder = this.ui.text('Encrypted');
          });
        card.append(secretLabel, secrets, save);
        if (row.permissions.files === 'inputs') {
          const inputs = document.createElement('button');
          inputs.type = 'button';
          inputs.textContent = this.ui.text('Choose input files');
          inputs.onclick = () =>
            this.run(async () => {
              const result = await this.api.userToolAction({ action: 'inputs', id: row.id });
              inputs.textContent = this.ui.text('Selected input files') + ': ' + result.count;
            });
          card.append(inputs);
        }
        const label = document.createElement('label'),
          parameters = document.createElement('textarea'),
          test = document.createElement('button'),
          output = document.createElement('pre');
        label.textContent = this.ui.text('Test parameters (JSON)');
        parameters.rows = 2;
        parameters.value = '{}';
        test.type = 'button';
        test.textContent = this.ui.text('Test tool');
        output.dataset.untranslated = '';
        output.style.whiteSpace = 'pre-wrap';
        output.style.overflowWrap = 'anywhere';
        test.disabled = !row.enabled;
        test.onclick = () =>
          this.run(async () => {
            test.disabled = true;
            try {
              output.textContent = JSON.stringify(
                await this.api.userToolAction({
                  action: 'test',
                  id: row.id,
                  parameters: JSON.parse(parameters.value),
                }),
                null,
                2,
              );
            } finally {
              test.disabled = !row.enabled;
            }
          });
        card.append(label, parameters, test, output);
      }
      list.append(card);
    }
  }
}
