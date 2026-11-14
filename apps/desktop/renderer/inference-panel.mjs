// SPDX-License-Identifier: GPL-3.0-only
import {
  inferenceEndpoint,
  isLemonadeNpuEndpoint,
  isLemonadePhiEndpoint,
  isLocalApiEndpoint,
} from './inference-endpoint.mjs';
import { normalizeApiKey, apiKeyProblem, MAX_API_KEY_LENGTH } from './api-key.mjs';
import { DesktopAiPanel } from './desktop-ai-panel.mjs';

const PROVIDER_URLS = new Map([
  ['openai', 'https://api.openai.com/v1'],
  ['claude', 'https://api.anthropic.com/v1'],
  ['openrouter', 'https://openrouter.ai/api/v1'],
  ['huggingface', 'https://router.huggingface.co/v1'],
  ['proxyapi', 'https://api.proxyapi.ru/v1'],
  ['deepseek', 'https://api.deepseek.com'],
  ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'],
  ['lemonade', 'http://127.0.0.1:13305/api/v1'],
]);
function providerDisplayName(hostname) {
  if (hostname === 'api.openai.com') return 'OpenAI';
  if (hostname === 'api.anthropic.com') return 'Claude';
  if (hostname === new URL(PROVIDER_URLS.get('openrouter')).hostname) return 'OpenRouter';
  if (hostname === new URL(PROVIDER_URLS.get('huggingface')).hostname) return 'Hugging Face';
  if (hostname === new URL(PROVIDER_URLS.get('proxyapi')).hostname) return 'ProxyAPI';
  if (hostname === new URL(PROVIDER_URLS.get('deepseek')).hostname) return 'DeepSeek';
  if (hostname === new URL(PROVIDER_URLS.get('gemini')).hostname) return 'Google Gemini';
  return hostname;
}
export function renderInferenceLabel(value, ui) {
  if (!value) return;
  const label = document.getElementById('inference-label');
  const external = value.remote || value.setupRequired;
  const mode = external ? (value.authMode === 'chatgpt' ? 'ChatGPT' : 'API') : ui.text('Local');
  const detail = value.remote
    ? providerDisplayName(value.providerHost)
    : value.setupRequired
      ? ui.text('OFFLINE')
      : value.model;
  label.querySelector('#inference-mode').textContent = mode;
  label.querySelector('#inference-detail').textContent = detail ?? '';
  const model = label.querySelector('#inference-model');
  model.textContent = value.remote ? value.model : '';
  model.hidden = !model.textContent;
  label.dataset.mode = external ? 'api' : 'local';
  label.title = [mode, detail, model.textContent].filter(Boolean).join(' · ');
  label.setAttribute('aria-label', [ui.text('Current model'), label.title].join(' · '));
  label.hidden = false;
}
function origin(url) {
  return URL.parse(url)?.origin;
}

export class InferencePanel {
  constructor({ api, ui, onError }) {
    Object.assign(this, { api, ui, onError });
    this.panel = document.createElement('section');
    this.panel.id = 'inference-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.health = new Map();
    this.rows = new Map();
    this.skipLocalModelOnApi = true;
    this.startupRevision = 0;
    this.panel.innerHTML = `<h2>API connections</h2><div class="preferences-content">
      <p class="settings-help" data-inline-help>Optional alternative to the local language model. Your messages, personality, relevant memory and tool results are sent to your chosen provider. Screen images are sent only when you enable vision and use screen features. Provider charges and privacy terms apply. Speech recognition remains local. Voice stays local unless you enable Voice API separately.</p>
      <div class="settings-card">
      <label><input id="api-skip-local-model" type="checkbox" checked> Skip local language model when using an API</label>
      <p class="settings-help">Recommended for API users. Frees the local language model at startup and skips its warmup. Local mode, voice and speech recognition keep their own settings.</p>
      <p id="api-startup-status" role="status"></p>
      </div>
      <div class="settings-card">
      <div class="api-current"><span>Current model</span><strong id="api-mode" data-untranslated></strong></div>
      <h3>Saved API connections</h3>
      <p class="settings-help">A connection test sends a short sample message without conversation history. Provider charges may apply.</p>
      <div class="settings-actions"><button id="api-test-all" type="button" disabled>Test all connections</button></div>
      <div id="api-connections"></div>
      </div>
      <div class="settings-card">
      <button id="api-add" type="button" aria-controls="api-form" aria-expanded="false">Add an API connection</button>
      <p id="api-status" role="status"></p>
      <div id="api-form" hidden>
      <h3 class="api-edit-heading"><span id="api-form-title">Add an API connection</span><span id="api-editing-name" data-untranslated></span></h3>
      <details class="api-setup-guide" id="api-guide" open>
        <summary>How to connect an API</summary>
        <ol>
          <li>Use the API base URL from the provider, not its website address.</li>
          <li>Copy the exact model ID from the provider's model list.</li>
          <li>Create an API key in your provider account and paste it here. Keep it private.</li>
        </ol>
      </details>
      <label for="api-name">Connection name (optional)</label><input id="api-name" type="text" maxlength="64" autocomplete="off" data-untranslated disabled>
      <label for="api-provider">API provider</label><select id="api-provider" disabled>
        <option value="openai" data-untranslated>OpenAI</option>
        <option value="claude" data-untranslated>Claude API</option>
        <option value="openrouter" data-untranslated>OpenRouter</option>
        <option value="huggingface" data-untranslated>Hugging Face</option>
        <option value="proxyapi" data-untranslated>ProxyAPI</option>
        <option value="deepseek" data-untranslated>DeepSeek</option>
        <option value="gemini" data-untranslated>Google Gemini</option>
        <option value="lemonade">Lemonade (local)</option>
        <option value="custom">Custom</option>
      </select>
      <label for="api-url">OpenAI-compatible API base URL</label><input id="api-url" type="url" maxlength="512" autocomplete="off" data-untranslated disabled>
      <label for="api-model">Provider model ID</label><input id="api-model" type="text" maxlength="128" autocomplete="off" spellcheck="false" data-untranslated disabled>
      <label for="api-key">API key</label><input id="api-key" type="password" maxlength="${MAX_API_KEY_LENGTH}" autocomplete="new-password" spellcheck="false" data-untranslated disabled>
      <p class="settings-help" id="api-key-help">Each connection has its own encrypted key. Keys are never shown again or included in diagnostic reports.</p>
      <p class="settings-help" data-inline-help>Paste the key itself. Copied outer spaces and quotation marks are removed.</p>
      <label><input id="api-tools" type="checkbox" disabled> This API model supports tool calls</label>
      <label><input id="api-vision" type="checkbox" disabled> This API model supports images</label>
      <label for="api-context">Provider context limit (tokens)</label><input id="api-context" type="number" min="32768" max="262144" step="1024" data-untranslated disabled>
      <p class="settings-help">Image support is required for screen questions. Set the same context limit as the server. Leave tool calls off for chat-only models.</p>
      <div class="settings-actions"><button id="api-save" type="button" disabled>Save connection</button><button id="api-cancel" type="button">Cancel</button></div>
      </div></div></div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (id) => this.panel.querySelector('#api-' + id);
    this.ai = new DesktopAiPanel({
      api,
      ui,
      host: this.panel.querySelector('.preferences-content'),
      onError,
      onConnections: (value) => this.show(value),
      onUseConnection: (id) => this.use(id),
      onConfigure: (provider, baseUrl) => {
        this.resetForm();
        this.setFormOpen(true);
        this.get('provider').value = provider;
        this.get('provider').dispatchEvent(new Event('change'));
        if (baseUrl) {
          this.get('url').value = baseUrl;
          this.syncProvider();
        }
        this.get('form').scrollIntoView({ block: 'start', behavior: 'smooth' });
        this.get('model').focus();
      },
    });
    this.get('skip-local-model').onchange = () => this.saveStartup();
    this.get('add').onclick = () => {
      if (!this.get('form').hidden && !this.editingProfile) {
        this.resetForm();
        return;
      }
      this.resetForm();
      this.get('status').textContent = '';
      this.setFormOpen(true);
      this.get('name').focus();
    };
    this.get('cancel').onclick = () => {
      this.resetForm();
      this.get('add').focus();
    };
    this.get('test-all').onclick = () => this.testAll();
    this.get('provider').onchange = (event) => {
      const baseUrl = PROVIDER_URLS.get(event.target.value);
      if (baseUrl && baseUrl !== this.get('url').value) {
        this.get('url').value = baseUrl;
        if (event.target.value !== 'gemini')
          this.get('model').value =
            event.target.value === 'lemonade' ? 'Phi-4-mini-instruct-NPU' : '';
        this.get('vision').checked = false;
        this.syncProvider();
      } else if (!baseUrl) this.get('url').focus();
    };
    this.get('url').oninput = () => this.syncProvider();
    this.get('model').oninput = () => this.syncProvider();
    this.get('key').oninput = () => this.syncEnabled();
    this.get('key').addEventListener('paste', (event) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      const field = this.get('key');
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      // Password inputs remove newlines and enforce maxlength before input.
      // Validate the full clipboard candidate first; never silently crop a key
      // or turn two pasted lines into a different, apparently valid credential.
      const value = normalizeApiKey(
        field.value.slice(0, start) +
          event.clipboardData.getData('text/plain') +
          field.value.slice(end),
      );
      const problem = this.keyProblem(value);
      if (problem) {
        this.onError(problem);
        return;
      }
      field.value = value;
      field.setSelectionRange(value.length, value.length);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    this.get('save').onclick = async () => {
      if (this.get('form').hidden || this.saving) return;
      const key = normalizeApiKey(this.get('key').value);
      const problem = this.keyProblem(key);
      if (problem) {
        onError(problem);
        this.get('key').focus();
        return; // Retain invalid input for correction without invoking IPC.
      }
      this.get('key').value = key;
      this.saving = true;
      this.syncEnabled();
      try {
        const editingId = this.editingProfile?.id;
        const saved = await api.saveInferenceApi({
          ...(editingId ? { id: editingId } : {}),
          name: this.get('name').value,
          key,
          settings: {
            enabled: true,
            ...(this.editingProfile?.authMode === 'chatgpt'
              ? {
                  authMode: 'chatgpt',
                  accountId: this.editingProfile.accountId,
                  visionMode: 'manual',
                }
              : {}),
            baseUrl: this.get('url').value.trim(),
            model: this.get('model').value.trim(),
            vision: this.get('vision').checked,
            tools: this.get('tools').checked,
            contextTokens: Number(this.get('context').value),
          },
        });
        if (saved === false) return;
        if (editingId) this.health.delete(editingId);
        this.resetForm();
        this.show(await api.inferenceApiStatus());
        this.get('status').textContent = ui.text('Connection saved.');
      } catch (error) {
        onError(error.message);
      } finally {
        this.saving = false;
        this.clear();
        this.syncEnabled();
      }
    };
    this.resetForm();
  }
  async open() {
    void this.ai.open();
    const startupRevision = this.startupRevision;
    try {
      this.show(await this.api.inferenceApiStatus(), {
        startup: startupRevision === this.startupRevision,
      });
    } catch (error) {
      this.onError(error.message);
    }
  }
  async saveStartup() {
    if (this.startupSaving) return;
    const checkbox = this.get('skip-local-model');
    const enabled = checkbox.checked;
    this.startupRevision++;
    this.startupSaving = true;
    checkbox.disabled = true;
    this.get('startup-status').textContent = '';
    try {
      const value = await this.api.setInferenceStartup({ skipLocalModelOnApi: enabled });
      this.skipLocalModelOnApi = value.startup?.skipLocalModelOnApi !== false;
      checkbox.checked = this.skipLocalModelOnApi;
      this.show(value, { startup: false });
      this.get('startup-status').textContent = this.ui.text(
        'Applies on next startup or reconnect.',
      );
    } catch (error) {
      checkbox.checked = this.skipLocalModelOnApi;
      this.onError(error.message);
    } finally {
      this.startupRevision++;
      this.startupSaving = false;
      checkbox.disabled = false;
    }
  }
  show(value, { startup = true } = {}) {
    const { activeId, profiles, setupRequired, secureStorage, localModel } = value;
    if (startup && !this.startupSaving) {
      this.skipLocalModelOnApi = value.startup?.skipLocalModelOnApi !== false;
      this.get('skip-local-model').checked = this.skipLocalModelOnApi;
    }
    this.secureStorage = secureStorage;
    this.syncEnabled();
    const selected = profiles.find((profile) => profile.id === activeId);
    const mode = this.get('mode');
    mode.textContent = selected
      ? [selected.model, providerDisplayName(new URL(selected.baseUrl).hostname)].join(' · ')
      : activeId || setupRequired
        ? this.ui.text('OFFLINE')
        : [localModel, this.ui.text('Local')].filter(Boolean).join(' · ');
    const list = this.get('connections');
    list.replaceChildren();
    this.rows.clear();
    const ids = new Set(profiles.map(({ id }) => id));
    if (this.editingProfile && !ids.has(this.editingProfile.id)) this.resetForm();
    for (const id of this.health.keys()) if (!ids.has(id)) this.health.delete(id);
    if (!profiles.length) {
      list.textContent = this.ui.text('No saved API connections.');
    }
    for (const profile of [...profiles].sort(
      (a, b) => Number(b.id === activeId) - Number(a.id === activeId),
    )) {
      const active = profile.id === activeId;
      const card = document.createElement('article');
      card.className = 'api-connection';
      card.dataset.active = String(active);
      card.toggleAttribute('data-editing', profile.id === this.editingProfile?.id);
      const title = document.createElement('strong');
      title.dataset.untranslated = 'true';
      const host = providerDisplayName(new URL(profile.baseUrl).hostname);
      title.textContent = profile.name || host;
      const header = document.createElement('div');
      header.className = 'api-connection-header';
      header.append(title);
      if (active) {
        const badge = document.createElement('span');
        badge.className = 'api-active-badge';
        badge.textContent = this.ui.text('Active');
        header.append(badge);
      }
      const detail = document.createElement('p');
      detail.className = 'settings-help';
      detail.dataset.untranslated = 'true';
      detail.textContent = [profile.name && host, profile.model].filter(Boolean).join(' · ');
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.className = 'api-connection-health';
      const actions = document.createElement('div');
      actions.className = 'settings-actions';
      const button = (label, action, disabled) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = this.ui.text(label);
        element.onclick = action;
        element.disabled = disabled;
        actions.append(element);
        return element;
      };
      const test = button('Test connection', () => this.test(profile.id), !profile.canConnect);
      const use = button(
        'Use connection',
        () => this.use(profile.id),
        active || !profile.canConnect,
      );
      const edit = button('Edit', () => this.edit(profile), Boolean(this.saving));
      const remove = button(
        'Remove',
        async () => {
          try {
            this.show(await this.api.removeInferenceApi(profile.id));
          } catch (error) {
            this.onError(error.message);
          }
        },
        active,
      );
      remove.classList.add('danger-action');
      card.append(header, detail);
      if (profile.hasKey) {
        const keyState = document.createElement('input');
        keyState.className = 'api-key-state';
        keyState.type = 'text';
        keyState.readOnly = true;
        keyState.placeholder = 'Encrypted';
        keyState.dataset.untranslated = 'true';
        keyState.setAttribute('aria-label', this.ui.text('API key'));
        keyState.title = this.ui.text('An encrypted API key is saved.');
        card.append(keyState);
      }
      card.append(status, actions);
      list.append(card);
      this.rows.set(profile.id, {
        card,
        status,
        test,
        edit,
        use,
        remove,
        active,
        canConnect: profile.canConnect,
        authMode: profile.authMode,
      });
      this.renderHealth(profile.id);
    }
    this.syncEnabled();
  }
  renderHealth(id) {
    const row = this.rows.get(id);
    if (!row) return;
    const health = this.health.get(id);
    const state = row.canConnect ? (health?.state ?? 'unknown') : 'unavailable';
    row.card.dataset.health = state;
    row.test.disabled =
      !row.canConnect || state === 'testing' || Boolean(this.bulkTesting) || Boolean(this.saving);
    row.status.textContent = this.ui.text(
      !row.canConnect
        ? row.authMode === 'chatgpt'
          ? 'Sign in to ChatGPT and allow plan usage first.'
          : 'No API key is saved.'
        : state === 'available'
          ? 'Connection works'
          : state === 'unavailable'
            ? 'Unavailable'
            : state === 'testing'
              ? 'Testing connection…'
              : 'Not tested',
    );
    if (state === 'available')
      row.status.textContent +=
        ' · ' +
        (health.elapsedMs / 1000).toLocaleString(this.ui.language, { maximumFractionDigits: 1 }) +
        ' s';
    if (row.canConnect && state === 'unavailable')
      row.status.textContent += ' · ' + this.ui.text(health.error);
  }
  syncTestAll() {
    this.get('test-all').disabled =
      Boolean(this.bulkTesting) ||
      Boolean(this.saving) ||
      [...this.health.values()].some(({ state }) => state === 'testing') ||
      ![...this.rows.values()].some((row) => row.canConnect);
  }
  async test(id) {
    if (this.saving) return;
    if (!this.rows.get(id)?.canConnect || this.health.get(id)?.state === 'testing') return;
    this.health.set(id, { state: 'testing' });
    this.renderHealth(id);
    this.syncTestAll();
    try {
      const { elapsedMs } = await this.api.testInferenceApi(id);
      if (this.rows.has(id)) this.health.set(id, { state: 'available', elapsedMs });
    } catch (error) {
      if (this.rows.has(id))
        this.health.set(id, {
          state: 'unavailable',
          error: error.message.replace(/^Error invoking remote method '[^']+': Error: /u, ''),
        });
    }
    this.renderHealth(id);
    this.syncTestAll();
  }
  async testAll() {
    if (this.bulkTesting || this.saving) return;
    const pending = [...this.rows.keys()];
    this.bulkTesting = true;
    this.syncTestAll();
    for (const id of pending) this.renderHealth(id);
    const worker = async () => {
      while (pending.length) await this.test(pending.shift());
    };
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      this.bulkTesting = false;
      for (const id of this.rows.keys()) this.renderHealth(id);
      this.syncTestAll();
    }
  }
  async use(id) {
    if (this.saving) return;
    try {
      await this.api.useInferenceApi(id);
    } catch (error) {
      this.onError(error.message);
    }
  }
  resetForm() {
    this.editingProfile = null;
    for (const { card } of this.rows.values()) card.removeAttribute('data-editing');
    this.get('form-title').textContent = this.ui.text('Add an API connection');
    this.get('editing-name').textContent = '';
    this.get('save').textContent = this.ui.text('Save connection');
    this.setFormOpen(false);
    this.get('name').value = '';
    this.get('url').value = PROVIDER_URLS.get('openrouter');
    this.get('model').value = '';
    this.get('context').value = 32768;
    this.get('guide').open = true;
    this.get('tools').checked = true;
    this.get('vision').checked = false;
    this.clear();
    this.syncProvider();
    this.syncEnabled();
  }
  edit(profile) {
    if (this.saving) return;
    this.resetForm();
    this.editingProfile = { ...profile };
    for (const [id, { card }] of this.rows) card.toggleAttribute('data-editing', id === profile.id);
    this.get('status').textContent = '';
    this.get('name').value = profile.name ?? '';
    this.get('url').value = profile.baseUrl;
    this.get('model').value = profile.model;
    this.providerOrigin = origin(profile.baseUrl);
    this.syncProvider();
    this.get('tools').checked = profile.tools !== false;
    this.get('vision').checked = profile.vision === true;
    this.get('context').value = profile.contextTokens;
    this.get('form-title').textContent = this.ui.text('Edit');
    this.get('editing-name').textContent =
      profile.name || providerDisplayName(new URL(profile.baseUrl).hostname);
    this.get('save').textContent = this.ui.text('Save changes');
    this.get('guide').open = false;
    this.setFormOpen(true);
    this.get('form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.get('name').focus({ preventScroll: true });
  }
  keepsKey() {
    return (
      this.editingProfile?.hasKey === true &&
      origin(this.get('url').value.trim()) === origin(this.editingProfile.baseUrl)
    );
  }
  keyProblem(key) {
    if (this.editingProfile?.authMode === 'chatgpt')
      return key ? 'Use ChatGPT sign-in instead of an API key for this connection.' : null;
    if (!key && this.keepsKey()) return null;
    if (!key && this.editingProfile?.hasKey && !this.keepsKey())
      return 'Enter a new API key when changing the provider address.';
    return !key && this.localEndpoint ? null : apiKeyProblem(key);
  }
  syncProvider() {
    const baseUrl = this.get('url').value.trim().replace(/\/+$/, '');
    const preset = [...PROVIDER_URLS].find(([, url]) => url === baseUrl)?.[0];
    this.get('provider').value = preset ?? 'custom';
    const nextOrigin = origin(baseUrl);
    if (nextOrigin !== this.providerOrigin) this.clear();
    this.providerOrigin = nextOrigin;
    const local = isLocalApiEndpoint(inferenceEndpoint(baseUrl, this.get('model').value.trim()));
    const context = this.get('context');
    context.min = local ? '8192' : '32768';
    if (local !== this.localEndpoint) {
      this.get('tools').checked = !local;
      context.value = context.min;
    }
    this.localEndpoint = local;
    this.get('key-help').textContent = this.ui.text(
      this.editingProfile?.authMode === 'chatgpt'
        ? 'Using your authorized ChatGPT plan. No API key is needed. Manage the account in AI apps and ChatGPT plan.'
        : this.editingProfile?.hasKey
          ? this.keepsKey()
            ? 'The key is encrypted for your Windows account. Leave the field empty to keep the saved key. It is never shown again or included in diagnostic reports.'
            : 'Enter a new API key when changing the provider address.'
          : local
            ? 'Leave the key blank unless your local server requires one. HTTP is limited to this PC.'
            : 'Each connection has its own encrypted key. Keys are never shown again or included in diagnostic reports.',
    );
    this.refreshExamples(preset);
    this.get('key').setAttribute(
      'aria-required',
      String(!local && !this.keepsKey() && this.editingProfile?.authMode !== 'chatgpt'),
    );
    this.syncEnabled();
  }
  refreshExamples(preset) {
    preset ??= [...PROVIDER_URLS].find(
      ([, url]) => url === this.get('url').value.trim().replace(/\/+$/, ''),
    )?.[0];
    const example = (value) => this.ui.text('Example: {value}', { value });
    this.get('name').placeholder = example(
      preset === 'lemonade'
        ? 'Lemonade'
        : PROVIDER_URLS.has(preset)
          ? providerDisplayName(new URL(PROVIDER_URLS.get(preset)).hostname)
          : 'API',
    );
    this.get('url').placeholder = example(
      PROVIDER_URLS.get(preset) ?? 'https://api.example.com/v1',
    );
    this.get('model').placeholder = example(
      preset === 'lemonade'
        ? 'Phi-4-mini-instruct-NPU'
        : preset === 'huggingface'
          ? 'organization/model-name'
          : ['openrouter', 'proxyapi'].includes(preset)
            ? 'provider/model-name'
            : 'model-id',
    );
    this.get('key').placeholder =
      this.editingProfile?.authMode === 'chatgpt'
        ? this.ui.text('Using ChatGPT plan')
        : this.keepsKey()
          ? this.ui.text('Encrypted')
          : example(
              preset === 'gemini'
                ? 'AIza…'
                : preset === 'huggingface'
                  ? 'hf_…'
                  : preset === 'openrouter'
                    ? 'sk-or-v1-…'
                    : 'API_KEY_FROM_PROVIDER',
            );
    this.get('context').placeholder = '32768';
  }
  syncEnabled() {
    const enabled = !this.get('form').hidden && !this.saving;
    for (const id of ['name', 'provider', 'url', 'model', 'key', 'context'])
      this.get(id).disabled = !enabled;
    if (this.editingProfile?.authMode === 'chatgpt')
      for (const id of ['provider', 'url', 'key']) this.get(id).disabled = true;
    const model = this.get('model').value.trim();
    const endpoint = inferenceEndpoint(this.get('url').value.trim(), model);
    const textOnly = isLemonadePhiEndpoint(endpoint, model);
    for (const id of ['tools', 'vision']) {
      const unsupported = textOnly || (id === 'tools' && isLemonadeNpuEndpoint(endpoint, model));
      if (unsupported) this.get(id).checked = false;
      this.get(id).disabled = !enabled || unsupported;
    }
    const needsStorage = !this.localEndpoint || Boolean(normalizeApiKey(this.get('key').value));
    this.get('save').disabled = !enabled || (needsStorage && this.secureStorage === false);
    this.get('add').disabled = Boolean(this.saving);
    this.get('cancel').disabled = Boolean(this.saving);
    for (const [id, row] of this.rows) {
      row.edit.disabled = Boolean(this.saving);
      row.use.disabled = Boolean(this.saving) || row.active || !row.canConnect;
      row.remove.disabled = Boolean(this.saving) || row.active;
      this.renderHealth(id);
    }
    this.syncTestAll();
    if (this.get('form').hidden) this.clear();
  }
  setFormOpen(open) {
    this.get('form').hidden = !open;
    this.get('add').setAttribute('aria-expanded', String(open));
    this.syncEnabled();
  }
  clear() {
    this.get('key').value = '';
  }
}
