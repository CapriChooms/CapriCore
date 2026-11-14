// SPDX-License-Identifier: GPL-3.0-only
export class DesktopAiPanel {
  constructor({ api, ui, host, onError, onConnections, onUseConnection, onConfigure }) {
    Object.assign(this, { api, ui, onError, onConnections, onUseConnection, onConfigure });
    this.modelsRequest = 0;
    this.selectedModels = new Map();
    this.panel = document.createElement('section');
    this.panel.className = 'settings-card desktop-ai-card';
    this.panel.innerHTML = `<details id="desktop-ai-details"><summary><strong>AI apps and ChatGPT plan</strong></summary><h3>AI apps on this PC</h3>
      <p class="settings-help" data-inline-help>Find installed AI apps and local model servers. Detection reads application metadata and queries known loopback model lists. It does not sign in, send conversations, run AI commands or load models.</p>
      <div class="settings-actions"><button id="desktop-ai-scan" type="button">Find installed AI apps</button></div>
      <p id="desktop-ai-status" role="status" aria-live="polite"></p><div id="desktop-ai-installed"></div><div id="desktop-ai-servers"></div>
      </details><div id="chatgpt-plan-card" class="settings-card">
        <h3>Connect your ChatGPT plan</h3>
        <p class="settings-help" data-inline-help>Continue with ChatGPT to authorize Capri separately. Your existing app login and conversations are not imported. Eligible accounts can use their ChatGPT plan; its usage limits apply. The ChatGPT desktop app is not required.</p>
        <label for="chatgpt-plan-account">ChatGPT account</label><select id="chatgpt-plan-account"></select>
        <p id="chatgpt-plan-status" role="status" aria-live="polite"></p>
        <div class="settings-actions"><button id="chatgpt-plan-connect" type="button">Continue with ChatGPT</button><button id="chatgpt-plan-add-account" type="button">Add account</button><button id="chatgpt-plan-cancel" type="button" hidden>Cancel sign-in</button></div>
        <label for="chatgpt-plan-model">ChatGPT model</label><select id="chatgpt-plan-model" disabled></select>
        <p class="settings-help" data-inline-help>Choose a model and click Use connection.</p>
        <div class="settings-actions"><button id="chatgpt-plan-save" type="button" disabled>Use connection</button><button id="chatgpt-plan-test" type="button" disabled>Test connection</button><button id="chatgpt-plan-models" type="button" disabled>Refresh models</button></div>
        <p class="settings-help" data-inline-help>Capri sends conversation context and authorized tool results through the official Responses API. Images require a compatible model and enabled vision. A test sends only a fixed short sample.</p>
        <div class="settings-actions"><button id="chatgpt-plan-usage" type="button">Manage usage</button><button id="chatgpt-plan-signout" type="button" disabled>Sign out</button></div>
      </div>`;
    host.prepend(this.panel);
    this.get = (id) => this.panel.querySelector('#' + id);
    this.get('desktop-ai-details').addEventListener('toggle', () => {
      if (this.get('desktop-ai-details').open && !this.scanned) {
        this.scanned = true;
        void this.scan(false);
      }
    });
    this.get('desktop-ai-scan').onclick = () => this.scan(true);
    this.get('chatgpt-plan-connect').onclick = () => this.signIn(this.accountId());
    this.get('chatgpt-plan-add-account').onclick = () => this.signIn(null);
    this.get('chatgpt-plan-cancel').onclick = () => {
      this.cancelled = true;
      void api.chatGPTPlan({ action: 'cancel-sign-in' }).catch((error) => onError(error.message));
    };
    this.get('chatgpt-plan-account').onchange = async () => {
      this.clearModels();
      await this.action(async () => {
        this.showAccount(
          await api.chatGPTPlan({ action: 'select-account', accountId: this.accountId() }),
        );
      });
      await this.loadModels();
    };
    this.get('chatgpt-plan-model').onchange = () => {
      this.selectedModels.set(this.accountId(), this.modelId());
      this.sync();
    };
    this.get('chatgpt-plan-models').onclick = () => this.loadModels();
    this.get('chatgpt-plan-test').onclick = () =>
      this.action(async () => {
        await api.chatGPTPlan({
          action: 'test',
          accountId: this.accountId(),
          model: this.modelId(),
        });
        this.status('Connection works');
      });
    this.get('chatgpt-plan-save').onclick = () =>
      this.action(async () => {
        const accountId = this.accountId(),
          model = this.modelId();
        const value = await api.chatGPTPlan({
          action: 'add-connection',
          accountId,
          model,
        });
        onConnections(value);
        const profile = value.profiles.find(
          (item) =>
            item.authMode === 'chatgpt' && item.accountId === accountId && item.model === model,
        );
        if (!profile) throw new Error('Choose an available ChatGPT model.');
        this.status('Connection saved.');
        // Reuse the normal idle checks and restart confirmation; login alone
        // never switches providers or sends conversation context.
        await onUseConnection(profile.id);
      });
    this.get('chatgpt-plan-usage').onclick = () =>
      api.chatGPTPlan({ action: 'manage-usage' }).catch((error) => onError(error.message));
    this.get('chatgpt-plan-signout').onclick = () =>
      this.action(async () => {
        const value = await api.chatGPTPlan({ action: 'sign-out', accountId: this.accountId() });
        this.clearModels();
        this.showAccount(value);
        if (value.warning) this.status(value.warning);
        onConnections(await api.inferenceApiStatus());
      });
  }
  accountId() {
    return this.get('chatgpt-plan-account').value || null;
  }
  modelId() {
    return this.get('chatgpt-plan-model').value;
  }
  status(text) {
    this.get('chatgpt-plan-status').textContent = this.ui.text(text);
  }
  async action(work) {
    if (this.busy) return;
    this.busy = true;
    this.sync();
    try {
      await work();
    } catch (error) {
      if (!this.cancelled) {
        this.status(error.message);
        this.onError(error.message);
      } else this.status('Sign-in cancelled.');
    } finally {
      this.busy = false;
      this.sync();
    }
  }
  async signIn(accountId) {
    if (this.busy) return;
    let connected = false;
    this.cancelled = false;
    this.signingIn = true;
    this.status('Finish sign-in in your browser. Screen observation is paused.');
    try {
      await this.action(async () => {
        try {
          this.showAccount(await this.api.chatGPTPlan({ action: 'sign-in', accountId }));
          connected = true;
        } catch (error) {
          // A registration can survive a failed token exchange; reuse it on retry.
          try {
            this.showAccount(await this.api.chatGPTPlan({ action: 'status' }));
          } catch {
            /* Keep the original sign-in error. */
          }
          throw error;
        }
        this.clearModels();
      });
    } finally {
      this.signingIn = false;
      this.cancelled = false;
      this.sync();
    }
    if (connected) await this.loadModels();
  }
  clearModels() {
    this.modelsRequest++;
    this.loadingModels = false;
    this.modelsAccount = null;
    this.models = [];
    this.renderModels();
  }
  async loadModels() {
    const accountId = this.accountId();
    const selected = this.value?.profiles.find((profile) => profile.id === accountId);
    if (this.busy || !selected?.connected || !selected.sharing) return;
    const request = ++this.modelsRequest;
    this.loadingModels = true;
    this.modelsAccount = accountId;
    this.models = [];
    this.status('Loading ChatGPT models…');
    this.renderModels();
    try {
      const models = await this.api.chatGPTPlan({ action: 'models', accountId });
      if (request !== this.modelsRequest || accountId !== this.accountId()) return;
      this.models = models;
      this.status(
        models.length
          ? 'ChatGPT plan usage is enabled.'
          : 'No models are available for this account. Refresh models or try another account.',
      );
    } catch (error) {
      if (request !== this.modelsRequest || accountId !== this.accountId()) return;
      this.modelsAccount = null;
      this.status(error.message);
    } finally {
      if (request === this.modelsRequest) {
        this.loadingModels = false;
        this.renderModels();
      }
    }
  }
  showAccount(value) {
    this.value = value;
    this.get('chatgpt-plan-account').replaceChildren(
      ...value.profiles.map((profile, i) => {
        const option = new Option(`${i + 1} · ${profile.label}`, profile.id);
        option.dataset.untranslated = '';
        return option;
      }),
    );
    this.get('chatgpt-plan-account').value = value.selectedId ?? value.profiles[0]?.id ?? '';
    const selected = value.profiles.find((profile) => profile.id === this.accountId());
    this.status(
      value.loadError
        ? 'Saved ChatGPT access could not be read. Restore access using the original Windows account.'
        : selected?.connected && selected.sharing
          ? 'ChatGPT plan usage is enabled.'
          : selected?.connected
            ? 'Sign in again and allow ChatGPT plan usage.'
            : 'Connect your ChatGPT account to use an eligible plan.',
    );
    this.sync();
  }
  renderModels() {
    const select = this.get('chatgpt-plan-model');
    select.replaceChildren(
      ...(this.models ?? []).map((model) => {
        const option = new Option(model.name, model.id);
        option.dataset.untranslated = '';
        return option;
      }),
    );
    if (this.models?.some((model) => model.id === this.selectedModels.get(this.accountId())))
      select.value = this.selectedModels.get(this.accountId());
    if (!select.options.length)
      select.append(
        new Option(
          this.ui.text(this.loadingModels ? 'Loading ChatGPT models…' : 'ChatGPT model'),
          '',
        ),
      );
    select.setAttribute('aria-busy', String(Boolean(this.loadingModels)));
    this.sync();
  }
  sync() {
    const selected = this.value?.profiles.find((profile) => profile.id === this.accountId());
    for (const element of this.panel.querySelectorAll(
      '#chatgpt-plan-card input, #chatgpt-plan-card select, #chatgpt-plan-card button',
    ))
      element.disabled = Boolean(this.busy);
    this.get('chatgpt-plan-cancel').hidden = !this.signingIn;
    this.get('chatgpt-plan-cancel').disabled = !this.signingIn;
    this.get('chatgpt-plan-account').disabled = this.busy || !this.value?.profiles.length;
    this.get('chatgpt-plan-model').disabled =
      this.busy || this.loadingModels || !this.models?.length;
    this.get('chatgpt-plan-models').disabled =
      this.busy || this.loadingModels || !selected?.connected || !selected.sharing;
    for (const id of ['chatgpt-plan-test', 'chatgpt-plan-save'])
      this.get(id).disabled =
        this.busy || this.loadingModels || !this.modelId() || !selected?.sharing;
    this.get('chatgpt-plan-signout').disabled = this.busy || !selected?.connected;
  }
  openChatGPT() {
    this.get('chatgpt-plan-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  async scan(refresh) {
    if (this.scanning) return;
    this.scanning = true;
    this.get('desktop-ai-scan').disabled = true;
    this.get('desktop-ai-status').textContent = this.ui.text(
      'Looking for AI apps and local servers…',
    );
    try {
      const value = await this.api.discoverAiProviders(refresh);
      this.renderDiscovery(value);
      this.get('desktop-ai-status').textContent = this.ui.text(
        'Detection finished. Choose an official connection below.',
      );
    } catch (error) {
      this.get('desktop-ai-status').textContent = this.ui.text(error.message);
    } finally {
      this.scanning = false;
      this.get('desktop-ai-scan').disabled = false;
    }
  }
  renderDiscovery(value) {
    const installed = this.get('desktop-ai-installed');
    installed.replaceChildren();
    const detected = value.apps.filter((app) => app.installed);
    if (!detected.length) {
      const p = document.createElement('p');
      p.textContent = this.ui.text(
        'No supported AI apps detected. You can still connect a provider.',
      );
      installed.append(p);
    }
    for (const app of detected) {
      const row = document.createElement('p'),
        name = document.createElement('strong'),
        button = document.createElement('button');
      name.textContent = app.name;
      name.dataset.untranslated = '';
      button.type = 'button';
      button.textContent = this.ui.text('Set up connection');
      const provider =
        app.connection ??
        (app.id === 'codex'
          ? 'chatgpt'
          : app.id === 'claude-code'
            ? 'claude'
            : app.id === 'gemini-cli'
              ? 'gemini'
              : 'local');
      button.onclick = () =>
        provider === 'chatgpt'
          ? this.openChatGPT()
          : provider === 'local'
            ? this.get('desktop-ai-servers').scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
              })
            : this.onConfigure(provider);
      row.className = 'settings-actions';
      row.append(name, button);
      installed.append(row);
    }
    const servers = this.get('desktop-ai-servers');
    servers.replaceChildren();
    for (const server of value.servers) {
      if (server.state === 'offline' && !detected.some((app) => app.id === server.id)) continue;
      const card = document.createElement('div');
      card.className = 'settings-card';
      const heading = document.createElement('h4'),
        status = document.createElement('p'),
        select = document.createElement('select'),
        save = document.createElement('button');
      heading.textContent = server.name;
      heading.dataset.untranslated = '';
      status.textContent = this.ui.text(
        server.state === 'ready'
          ? 'Local model server is available.'
          : server.state === 'key-required'
            ? 'This local server requires an API key. Use manual setup.'
            : 'Start the local API server and scan again.',
      );
      select.setAttribute('aria-label', server.name + ' · ' + this.ui.text('Language model'));
      for (const model of server.models) {
        const option = new Option(model, model);
        option.dataset.untranslated = '';
        select.append(option);
      }
      select.disabled = server.state !== 'ready';
      save.type = 'button';
      save.textContent = this.ui.text(server.state === 'ready' ? 'Add connection' : 'Manual setup');
      save.onclick = async () => {
        save.disabled = true;
        try {
          if (server.state !== 'ready') return this.onConfigure('custom', server.baseUrl);
          this.onConnections(
            await this.api.chatGPTPlan({ action: 'add-local', id: server.id, model: select.value }),
          );
          status.textContent = this.ui.text('Connection saved.');
        } catch (error) {
          this.onError(error.message);
        } finally {
          save.disabled = false;
        }
      };
      card.append(heading, status, select, save);
      servers.append(card);
    }
  }
  async open() {
    try {
      this.showAccount(await this.api.chatGPTPlan({ action: 'status' }));
      if (this.modelsAccount !== this.accountId() && !this.signingIn) await this.loadModels();
    } catch (error) {
      this.status(error.message);
    }
    if (!this.scanned && this.get('desktop-ai-details').open) {
      this.scanned = true;
      void this.scan(false);
    }
  }
}
