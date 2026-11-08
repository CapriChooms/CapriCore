// SPDX-License-Identifier: GPL-3.0-only
const hint =
  'Search the web for the current request only. Chat history, screenshots and files are not sent automatically.';
const phases = {
  searching: 'Searching the web…',
  ready: 'Web sources ready.',
  unavailable: 'Web search is unavailable.',
};
const notices = new Set([
  'Web search found no results.',
  'Web search was skipped because the request may contain private credentials.',
]);

/** A session preference. Only the host may perform an explicitly enabled search. */
export class InternetMode {
  constructor({ button, status, api, ui, onChange = () => {}, onError = () => {} }) {
    Object.assign(this, { button, status, api, ui, onChange, onError });
    this.enabled = false;
    this.ready = false;
    this.busy = false;
    this.pending = false;
    this.phase = '';
    this.message = '';
    this.turnId = null;
    this.sourceViews = new WeakMap();
    button.addEventListener('click', () => void this.setEnabled(!this.enabled));
    this.refresh();
  }
  configure(value) {
    this.enabled = value?.enabled === true;
    this.refresh();
  }
  setReady(value) {
    if (this.ready === Boolean(value)) return;
    this.ready = Boolean(value);
    this.refresh();
  }
  setBusy(value) {
    if (this.busy === Boolean(value)) return;
    this.busy = Boolean(value);
    this.refresh();
  }
  async setEnabled(value) {
    if (!this.ready || this.busy || this.pending || typeof value !== 'boolean') return false;
    const previous = this.enabled;
    this.enabled = value;
    this.pending = true;
    this.refresh();
    try {
      this.configure(await this.api.setInternetMode(value));
      return true;
    } catch (error) {
      this.enabled = previous;
      this.onError(error.message);
      return false;
    } finally {
      this.pending = false;
      this.refresh();
    }
  }
  begin(turnId) {
    this.turnId = turnId;
    this.phase = '';
    this.message = '';
    this.refresh();
  }
  event(event) {
    if (!event || !this.turnId || event.turnId !== this.turnId) return false;
    if (event.type === 'turn.web-search' && Object.hasOwn(phases, event.phase)) {
      this.phase = event.phase;
      this.message =
        event.phase === 'unavailable' && notices.has(event.message) ? event.message : '';
      this.refresh();
      return true;
    }
    if (['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type)) this.clear();
    return false;
  }
  clear() {
    this.turnId = null;
    this.phase = '';
    this.message = '';
    this.refresh();
  }
  snapshot() {
    return {
      enabled: this.enabled,
      label: this.ui.text(this.enabled ? 'Internet mode: On' : 'Internet mode: Off'),
      hint: this.ui.text(hint),
    };
  }
  renderSources(host, sources, { turnId } = {}) {
    const entries = [];
    if (typeof turnId === 'string' && turnId.trim() && Array.isArray(sources))
      sources.slice(0, 5).forEach((source, index) => {
        if (!source || typeof source.title !== 'string' || typeof source.url !== 'string') return;
        try {
          const url = new URL(source.url);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
          const title = source.title
            .replace(/[\x00-\x1f\x7f]/gu, ' ')
            .trim()
            .slice(0, 240);
          if (title) entries.push({ index, title, url: url.href.slice(0, 2048) });
        } catch {}
      });
    const heading = this.ui.text('Sources');
    const signature = JSON.stringify({ turnId, heading, entries });
    if (this.sourceViews.get(host) === signature) return;
    this.sourceViews.set(host, signature);
    host.replaceChildren();
    host.hidden = !entries.length;
    if (!entries.length) return;
    const document = host.ownerDocument;
    const label = document.createElement('div');
    label.className = 'message-source-heading';
    label.textContent = heading;
    const list = document.createElement('ol');
    for (const entry of entries) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `[${entry.index + 1}] ${entry.title}`;
      button.title = entry.url;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await this.api.openWebSource({ turnId, index: entry.index });
        } catch (error) {
          this.onError(error.message);
        } finally {
          button.disabled = false;
        }
      });
      item.append(button);
      list.append(item);
    }
    host.append(label, list);
  }
  get statusText() {
    return this.phase ? this.ui.text(this.message || phases[this.phase]) : '';
  }
  refresh() {
    const state = this.snapshot();
    this.button.setAttribute('aria-pressed', String(this.enabled));
    this.button.setAttribute('aria-label', state.label);
    this.button.setAttribute('aria-busy', String(this.pending || this.phase === 'searching'));
    this.button.title = state.label + '\n' + state.hint;
    this.button.disabled = !this.ready || this.busy || this.pending;
    if (this.status) {
      this.status.textContent = this.statusText;
      this.status.hidden = !this.statusText;
    }
    this.onChange();
  }
}
