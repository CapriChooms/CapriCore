// SPDX-License-Identifier: GPL-3.0-only
import { EXTERNAL_TTS_DEFAULTS, externalTtsSettings } from './external-tts-settings.mjs';
import { apiKeyProblem, normalizeApiKey } from './api-key.mjs';

const connection = (value) =>
  externalTtsSettings(
    Object.fromEntries(Object.keys(EXTERNAL_TTS_DEFAULTS).map((key) => [key, value[key]])),
  );
const fingerprint = (value) =>
  JSON.stringify([value.provider, value.baseUrl, value.model, value.voice]);
const localServer = (url) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(URL.parse(url ?? '')?.hostname);
export const voiceApiErrorMessage = (error) =>
  String(error?.message ?? error)
    .replace(
      /^Error invoking remote method 'capri:voice-api-(?:save|test|remove)':\s*(?:Error:\s*)?/,
      '',
    )
    .replace(/^Error:\s*/, '');

export class ExternalTtsPanel {
  constructor({ api, ui }) {
    Object.assign(this, { api, ui });
    this.previewGeneration = 0;
    this.panel = document.createElement('section');
    this.panel.id = 'external-tts-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.dataset.panelCut = '12';
    this.panel.innerHTML = `<h2>Voice API</h2><div class="preferences-content tts-setup">
      <div class="tts-source"><span>Current voice source</span><strong id="tts-api-source"></strong></div>
      <p class="settings-help" data-inline-help>Connect a cloud voice to reduce local RAM and VRAM use. The chat model is configured separately.</p>
      <div class="settings-card tts-step">
        <h3><span class="tts-step-number" aria-hidden="true">01</span><span>Provider and API key</span></h3>
        <label for="tts-api-provider">API provider</label>
        <select id="tts-api-provider"><option value="openai" data-untranslated>OpenAI</option><option value="elevenlabs" data-untranslated>ElevenLabs</option><option value="compatible">Other OpenAI-compatible provider</option></select>
        <div class="tts-key-label"><label for="tts-api-key">API key</label><span id="tts-api-key-badge" class="tts-key-badge" role="status"></span></div>
        <input id="tts-api-key" type="password" autocomplete="new-password" spellcheck="false" maxlength="4096" aria-describedby="tts-api-key-status tts-api-key-help">
        <p id="tts-api-key-status" class="settings-help" role="status"></p>
        <p id="tts-api-key-help" class="settings-help" data-inline-help>Use an API key from this provider. Signing in to ChatGPT does not connect the voice API.</p>
      </div>
      <details id="tts-api-voice-options" class="settings-card tts-step tts-voice-options">
        <summary><span class="tts-step-number" aria-hidden="true">02</span><strong>Voice</strong><span id="tts-api-selection-summary" class="tts-selection-summary" data-untranslated></span></summary>
        <div class="tts-voice-fields">
          <div><label for="tts-api-model">Provider model ID</label><input id="tts-api-model" type="text" placeholder="gpt-4o-mini-tts" spellcheck="false" autocomplete="off" maxlength="200"></div>
          <div><label for="tts-api-voice">Voice name or ID</label><input id="tts-api-voice" type="text" placeholder="coral" spellcheck="false" autocomplete="off" maxlength="128"></div>
        </div>
        <p class="settings-help" data-inline-help>Use a voice supported by your provider. A cloud voice may sound different from Capri.</p>
        <details id="tts-api-advanced" class="tts-advanced"><summary>Server address</summary>
          <label for="tts-api-url">API base URL</label><input id="tts-api-url" type="url" placeholder="https://api.openai.com/v1" spellcheck="false" autocomplete="off">
          <p class="settings-help" data-inline-help>Use the provider's API address, not its website address.</p>
        </details>
      </details>
      <div class="settings-card tts-step">
        <h3><span class="tts-step-number" aria-hidden="true">03</span><span>Connect and use</span></h3>
        <div class="settings-actions tts-connect-actions"><button id="tts-api-save" class="tts-connect-primary" type="button">Save and test</button><label class="tts-enable-row"><input id="tts-api-enabled" type="checkbox"><span>Use cloud voice</span></label></div>
        <p id="tts-api-status" class="tts-connection-status" role="status" aria-live="polite"></p>
        <p class="settings-help" data-inline-help>The test plays a short sample. Provider charges may apply.</p>
        <p id="tts-api-enable-help" class="settings-help" data-inline-help></p>
        <p class="settings-help" data-inline-help>Turn on the speaker in the main panel to hear replies.</p>
        <div class="settings-actions"><button id="tts-api-remove" type="button">Remove connection</button></div>
      </div>
      <p class="settings-help tts-privacy" data-inline-help>Only the text to be spoken is sent. Your microphone, screen, memory and chat history are not sent to the voice provider.</p>
    </div>`;
    document.getElementById('companion').append(this.panel);
    this.get = (id) => this.panel.querySelector('#tts-api-' + id);
    this.get('provider').onchange = () => {
      const provider = this.get('provider').value;
      this.get('url').value =
        provider === 'elevenlabs'
          ? 'https://api.elevenlabs.io/v1'
          : provider === 'openai'
            ? EXTERNAL_TTS_DEFAULTS.baseUrl
            : '';
      this.get('model').value =
        provider === 'elevenlabs'
          ? 'eleven_multilingual_v2'
          : provider === 'openai'
            ? EXTERNAL_TTS_DEFAULTS.model
            : '';
      this.get('voice').value = provider === 'openai' ? EXTERNAL_TTS_DEFAULTS.voice : '';
      this.get('key').value = '';
      this.get('advanced').open = provider === 'compatible';
      this.get('voice-options').open = provider !== 'openai';
      this.examples();
      this.edited();
    };
    for (const id of ['url', 'model', 'voice', 'key'])
      this.get(id).addEventListener('input', () => this.edited());
    window.addEventListener('pagehide', () => this.clear());
    this.get('save').onclick = () => {
      if (!this.formState().canSave) return;
      void this.action(async () => {
        if (!this.formState().canTest) {
          this.status('Saving…', 'busy');
          // A failed encrypted save retains the draft; it never tests old settings.
          const value = await api.saveVoiceApi({
            settings: this.draft(),
            key: normalizeApiKey(this.get('key').value),
          });
          this.show(value);
        }
        await this.testSaved();
      });
    };
    this.get('enabled').onchange = () => {
      void this.setEnabled(this.get('enabled').checked);
    };
    this.get('remove').onclick = () =>
      this.action(async () => {
        this.show(await api.removeVoiceApi());
        this.status('Voice API connection removed. Local voice is selected.');
      });
    this.show({ ...EXTERNAL_TTS_DEFAULTS, hasKey: false, loadError: false });
  }
  setEnabled(enabled) {
    return this.action(async () => {
      const dirty = this.formState().dirty;
      const value = await this.api.saveVoiceApi({
        settings: { ...connection(this.value), enabled },
        key: '',
      });
      if (dirty) this.value = value;
      else this.show(value);
      this.status(enabled ? 'Cloud voice is on.' : 'Local voice is selected.', 'success');
    });
  }
  draft() {
    return externalTtsSettings({
      enabled: Boolean(this.value?.enabled),
      provider: this.get('provider').value === 'elevenlabs' ? 'elevenlabs' : 'openai',
      baseUrl: this.get('url').value,
      model: this.get('model').value.trim(),
      voice: this.get('voice').value.trim(),
    });
  }
  formState() {
    let draft, problem;
    try {
      draft = this.draft();
    } catch (error) {
      problem = error.message.startsWith('Use HTTPS')
        ? "Enter the provider's API address. Remote services require HTTPS."
        : error.message;
    }
    const key = normalizeApiKey(this.get('key').value);
    const sameProvider =
      this.value &&
      (this.get('provider').value === 'elevenlabs' ? 'elevenlabs' : 'openai') ===
        this.value.provider &&
      URL.parse(this.get('url').value.trim())?.origin === URL.parse(this.value.baseUrl)?.origin;
    const savedKey = Boolean(sameProvider && this.value.hasKey && !this.value.loadError);
    const local = draft && localServer(draft.baseUrl);
    const hasKey = Boolean(key) && !apiKeyProblem(key);
    const dirty = Boolean(
      key || !draft || !this.value || fingerprint(draft) !== fingerprint(this.value),
    );
    return {
      draft,
      key,
      savedKey,
      local,
      problem,
      dirty,
      canSave: Boolean(draft && (hasKey || (!key && (savedKey || local)))),
      canTest: Boolean(draft && !dirty && (savedKey || local) && !this.value?.loadError),
    };
  }
  edited() {
    this.verified = false;
    this.notice = null;
    this.clearPreview();
    this.sync();
  }
  status(text, tone = 'neutral') {
    this.notice = { text, tone };
    this.sync();
  }
  sync() {
    const state = this.formState();
    this.get('selection-summary').textContent = [this.get('model').value, this.get('voice').value]
      .filter(Boolean)
      .join(' · ');
    this.get('save').disabled = Boolean(this.busy || !state.canSave);
    this.get('remove').hidden =
      !this.value?.hasKey &&
      !this.value?.enabled &&
      this.value?.baseUrl === EXTERNAL_TTS_DEFAULTS.baseUrl &&
      !this.value?.loadError;
    this.get('remove').disabled = Boolean(this.busy);
    this.get('enabled').checked = this.value?.enabled === true;
    this.get('enabled').disabled = Boolean(
      this.busy || (!this.value?.enabled && (!state.canTest || !this.verified)),
    );
    this.get('source').textContent = this.ui.text(this.value?.enabled ? 'Cloud voice' : 'Local');
    this.get('source').dataset.active = String(this.value?.enabled === true);
    const badge = this.get('key-badge');
    badge.textContent = this.ui.text(
      state.key
        ? 'Not saved'
        : state.savedKey
          ? 'Encrypted key saved'
          : state.local
            ? 'Optional'
            : 'Key not saved',
    );
    badge.dataset.state = state.savedKey && !state.key ? 'saved' : 'missing';
    this.get('key').placeholder = this.ui.text(
      state.savedKey ? 'Encrypted key saved' : 'Paste your provider API key',
    );
    this.get('key-status').textContent = this.ui.text(
      state.key
        ? (apiKeyProblem(state.key) ?? 'Save and test to store this key securely.')
        : state.savedKey
          ? 'Encrypted key saved. Leave this field empty to keep it.'
          : state.local
            ? 'Local servers may not require an API key.'
            : 'Enter an API key to continue.',
    );
    this.get('key').setAttribute(
      'aria-invalid',
      String(Boolean(state.key && apiKeyProblem(state.key))),
    );
    this.get('enable-help').textContent = this.ui.text(
      this.value?.enabled
        ? 'Local voice models stay unloaded while cloud voice is on.'
        : this.verified && state.canTest
          ? 'You can switch back to local voice at any time.'
          : 'Save and test the connection, then turn on cloud voice.',
    );
    const notice =
      this.notice ??
      (!state.canSave
        ? {
            text:
              state.problem ??
              (state.key ? apiKeyProblem(state.key) : null) ??
              'Enter an API key to continue.',
            tone: 'warning',
          }
        : state.dirty && this.value?.hasKey
          ? { text: 'Settings changed. Save and test before using them.', tone: 'warning' }
          : {
              text: this.verified ? 'Connection works' : 'Not tested',
              tone: this.verified ? 'success' : 'neutral',
            });
    this.get('status').textContent = this.ui.text(notice.text);
    this.get('status').dataset.tone = notice.tone;
    this.get('status').setAttribute('aria-busy', String(Boolean(this.busy)));
    this.onSourceChange?.(this.value?.enabled === true, Boolean(this.busy));
  }
  async action(work) {
    if (this.busy) return;
    this.busy = true;
    for (const field of this.panel.querySelectorAll('input, select, button')) field.disabled = true;
    this.panel.setAttribute('aria-busy', 'true');
    try {
      await work();
    } catch (error) {
      this.verified = false;
      this.status(voiceApiErrorMessage(error), 'error');
    } finally {
      this.busy = false;
      this.panel.setAttribute('aria-busy', 'false');
      for (const field of this.panel.querySelectorAll('input, select, button'))
        field.disabled = false;
      this.sync();
    }
  }
  examples() {
    const provider = this.get('provider').value;
    this.get('url').placeholder =
      provider === 'elevenlabs'
        ? 'https://api.elevenlabs.io/v1'
        : provider === 'openai'
          ? EXTERNAL_TTS_DEFAULTS.baseUrl
          : 'https://api.example.com/v1';
    this.get('model').placeholder =
      provider === 'elevenlabs' ? 'eleven_multilingual_v2' : EXTERNAL_TTS_DEFAULTS.model;
    this.get('voice').placeholder =
      provider === 'elevenlabs'
        ? this.ui.text('Voice ID from your ElevenLabs account')
        : EXTERNAL_TTS_DEFAULTS.voice;
  }
  show(value) {
    if (
      !this.value ||
      fingerprint(value) !== fingerprint(this.value) ||
      value.hasKey !== this.value.hasKey ||
      value.loadError
    )
      this.verified = false;
    this.value = value;
    this.get('provider').value =
      value.provider === 'elevenlabs'
        ? 'elevenlabs'
        : value.baseUrl === EXTERNAL_TTS_DEFAULTS.baseUrl
          ? 'openai'
          : 'compatible';
    for (const [field, key] of [
      ['url', 'baseUrl'],
      ['model', 'model'],
      ['voice', 'voice'],
    ])
      this.get(field).value = value[key];
    this.get('advanced').open = this.get('provider').value === 'compatible';
    this.get('voice-options').open = this.get('provider').value !== 'openai';
    this.get('key').value = '';
    this.notice = value.loadError
      ? { text: 'Saved voice API access could not be read. Save the key again.', tone: 'error' }
      : null;
    this.examples();
    this.sync();
  }
  async testSaved() {
    const generation = this.previewGeneration;
    this.status('Testing voice connection…', 'busy');
    const audio = await this.api.testVoiceApi();
    if (generation !== this.previewGeneration || this.panel.hidden) return;
    await this.stopPreview();
    const context = (this.audio = new AudioContext({ sampleRate: audio.sampleRate }));
    const bytes = Uint8Array.from(atob(audio.pcm), (character) => character.charCodeAt(0)),
      pcm = new DataView(bytes.buffer);
    const buffer = context.createBuffer(1, bytes.byteLength / 4, audio.sampleRate),
      channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = pcm.getFloat32(i * 4, true);
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.25;
    source.connect(gain).connect(context.destination);
    source.onended = () => {
      if (this.audio === context) void this.stopPreview();
    };
    source.start();
    this.verified = true;
    this.status(
      this.value?.enabled ? 'Connection works' : 'Connection works. Turn on cloud voice to use it.',
      'success',
    );
  }
  async stopPreview() {
    const context = this.audio;
    this.audio = null;
    if (context) await context.close();
  }
  clearPreview() {
    this.previewGeneration++;
    void this.stopPreview();
  }
  clear() {
    this.get('key').value = '';
    this.clearPreview();
    this.sync();
  }
  async open() {
    this.show(await this.api.voiceApiStatus());
  }
}
