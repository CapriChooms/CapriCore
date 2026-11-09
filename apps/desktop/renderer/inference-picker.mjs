// SPDX-License-Identifier: GPL-3.0-only
// Metadata only. Selection delegates to the existing guarded restart capability.
export function inferenceChoices(value = {}) {
  return [
    {
      id: null,
      label: 'Local',
      model: value.localModel || '',
      active: !value.activeId && !value.setupRequired,
      available: true,
    },
    ...(value.profiles ?? []).map((profile) => ({
      id: profile.id,
      label: profile.name || URL.parse(profile.baseUrl)?.hostname || 'API',
      model: profile.model,
      active: profile.id === value.activeId,
      available: profile.canConnect === true,
    })),
  ];
}

export function localResidencyPresentation(value, text) {
  const label =
    value?.status === 'cpu'
      ? 'CPU'
      : value?.status === 'gpu'
        ? 'GPU'
        : value?.status === 'partial'
          ? 'GPU + CPU'
          : '—';
  return {
    label,
    title: label === '—' ? text('Unavailable') : text('Current model') + ' · ' + label,
  };
}

export class InferencePicker {
  constructor({ button, api, ui, onError, onLayout = () => {}, isBusy = () => false }) {
    Object.assign(this, { button, api, ui, onError, onLayout, isBusy });
    this.request = 0;
    this.selecting = false;
    this.menu = document.createElement('section');
    this.menu.id = 'inference-picker';
    this.menu.hidden = true;
    this.menu.dataset.hitRegion = '';
    this.menu.dataset.untranslated = '';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-labelledby', button.id);
    document.getElementById('companion').append(this.menu);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-controls', this.menu.id);
    button.setAttribute('aria-expanded', 'false');
    button.onclick = () => (this.menu.hidden ? void this.open() : this.close());
    button.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      void this.open(event.key === 'ArrowUp');
    });
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target) && !button.contains(event.target))
        this.close(false);
    });
    document.addEventListener('keydown', (event) => this.key(event), true);
    window.addEventListener('resize', () => this.position());
    window.addEventListener('blur', () => this.close(false));
  }

  async open(last = false) {
    if (this.selecting) return;
    const request = ++this.request;
    this.value = null;
    this.menu.replaceChildren();
    const loading = document.createElement('p');
    loading.textContent = this.ui.text('Current model') + '…';
    this.menu.append(loading);
    this.menu.hidden = false;
    this.menu.setAttribute('aria-busy', 'true');
    this.button.setAttribute('aria-expanded', 'true');
    this.position();
    try {
      const value = await this.api.inferenceApiStatus();
      if (request !== this.request || this.menu.hidden) return;
      this.value = value;
      this.render();
      const items = this.items();
      (last
        ? items.at(-1)
        : items.find((item) => item.getAttribute('aria-checked') === 'true') || items[0]
      )?.focus({ preventScroll: true });
    } catch (error) {
      if (request !== this.request) return;
      this.close();
      this.onError(error.message);
    }
  }

  render() {
    this.menu.replaceChildren();
    this.menu.setAttribute('aria-busy', 'false');
    const busy = Boolean(this.isBusy());
    this.menu.dataset.replyBusy = String(busy);
    const heading = document.createElement('p');
    heading.className = 'inference-picker-heading';
    heading.textContent = this.ui.text('Current model');
    heading.setAttribute('role', 'presentation');
    this.menu.append(heading);
    const notice = document.createElement('p');
    notice.className = 'inference-picker-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = this.ui.text('Wait for the current reply to finish.');
    notice.hidden = !busy;
    this.menu.append(notice);
    for (const choice of inferenceChoices(this.value)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inference-picker-choice';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(choice.active));
      button.dataset.source = choice.id === null ? 'local' : 'api';
      button.dataset.available = String(choice.available);
      button.disabled = !choice.available || this.selecting || busy;
      const title = document.createElement('strong');
      title.textContent = choice.id === null ? this.ui.text('Local') : choice.label;
      const detail = document.createElement('bdi');
      detail.textContent = choice.model;
      const state = document.createElement('span');
      state.textContent = this.ui.text(
        choice.active ? 'Active' : choice.available ? '' : 'No API key is saved.',
      );
      if (choice.id === null && choice.active) {
        const residency = localResidencyPresentation(this.value.localResidency, (text) =>
          this.ui.text(text),
        );
        state.textContent += ' · ' + residency.label;
        state.title = residency.title;
      }
      state.className = 'inference-picker-state';
      button.append(title, detail, state);
      button.onclick = () => this.select(choice);
      this.menu.append(button);
    }
    const actions = document.createElement('div');
    actions.className = 'inference-picker-settings';
    actions.setAttribute('role', 'group');
    for (const [section, label] of [
      ['models', 'Language model'],
      ['api', 'API connections'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.settings = section;
      button.textContent = this.ui.text(label);
      button.onclick = () => {
        this.close();
        void this.api.openSettings(section).catch((error) => this.onError(error.message));
      };
      actions.append(button);
    }
    this.menu.append(actions);
    this.position();
  }

  async select(choice) {
    if (this.selecting || this.isBusy() || !choice.available) return;
    if (choice.active) return this.close();
    this.selecting = true;
    const request = this.request;
    let acting = false;
    this.menu.setAttribute('aria-busy', 'true');
    for (const item of this.items()) item.disabled = true;
    try {
      if (choice.id === null) {
        let models = await this.api.modelStatus();
        if (request !== this.request || this.menu.hidden) return;
        if (!models.profiles?.length || models.inventoryUnavailable)
          models = await this.api.refreshModels();
        if (request !== this.request || this.menu.hidden) return;
        const local = models.profiles?.find((profile) => profile.configured);
        if (!local?.installed || !local.supported) {
          acting = true;
          this.close();
          await this.api.openSettings('models');
          return;
        }
      }
      if (this.isBusy()) return;
      acting = true;
      this.close();
      await this.api.useInferenceApi(choice.id);
      // The host commits the selected source during restart. Never paint a
      // cancelled request as a successfully activated provider.
    } catch (error) {
      if (!acting && (request !== this.request || this.menu.hidden)) return;
      this.close();
      this.onError(error.message);
    } finally {
      this.selecting = false;
      this.syncBusy();
    }
  }

  syncBusy() {
    if (this.menu.hidden) return;
    const busy = Boolean(this.isBusy());
    const changed = this.menu.dataset.replyBusy !== String(busy);
    this.menu.dataset.replyBusy = String(busy);
    const notice = this.menu.querySelector('.inference-picker-notice');
    if (notice) notice.hidden = !busy;
    for (const item of this.menu.querySelectorAll('.inference-picker-choice'))
      item.disabled = this.selecting || busy || item.dataset.available !== 'true';
    for (const item of this.menu.querySelectorAll('[data-settings]'))
      item.disabled = this.selecting;
    this.menu.setAttribute('aria-busy', String(this.selecting));
    if (changed) this.position();
  }

  items() {
    return [...this.menu.querySelectorAll('button:not(:disabled)')];
  }

  key(event) {
    if (this.menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Tab') return this.close();
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = this.items();
    const current = items.indexOf(document.activeElement);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }

  position() {
    if (this.menu.hidden) return;
    const anchor = this.button.getBoundingClientRect();
    const width = Math.min(360, innerWidth - 16);
    this.menu.style.width = width + 'px';
    const below = innerHeight - anchor.bottom - 14;
    const above = anchor.top - 14;
    const downward = below >= 200 || below >= above;
    this.menu.style.maxHeight = Math.max(60, downward ? below : above) + 'px';
    const left = document.documentElement.dir === 'rtl' ? anchor.right - width : anchor.left;
    this.menu.style.left = Math.max(8, Math.min(innerWidth - width - 8, left)) + 'px';
    const top = downward ? anchor.bottom + 6 : anchor.top - this.menu.offsetHeight - 6;
    this.menu.style.top =
      Math.max(8, Math.min(innerHeight - this.menu.offsetHeight - 8, top)) + 'px';
    this.onLayout();
  }

  close(focus = true) {
    ++this.request;
    const visible = !this.menu.hidden;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (visible && focus) this.button.focus({ preventScroll: true });
    if (visible) this.onLayout();
  }
}
