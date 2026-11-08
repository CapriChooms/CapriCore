// SPDX-License-Identifier: GPL-3.0-only
const hint = 'Take more time to check difficult answers.';

/** A session toggle and a public approach, never a reasoning transcript. */
export class ThinkingMode {
  constructor({
    button,
    preface,
    progress,
    approachButton,
    approach,
    api,
    ui,
    onChange = () => {},
    onError = () => {},
  }) {
    Object.assign(this, {
      button,
      element: preface,
      progress,
      approachButton,
      approach,
      api,
      ui,
      onChange,
      onError,
    });
    this.enabled = false;
    this.ready = false;
    this.pending = false;
    this.prefaceText = '';
    this.approachText = '';
    this.expanded = false;
    button.addEventListener('click', () => void this.setEnabled(!this.enabled));
    approachButton?.addEventListener('click', () => {
      if (!this.approachText) return;
      this.expanded = !this.expanded;
      this.refresh();
    });
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
  async setEnabled(value) {
    if (!this.ready || this.pending || typeof value !== 'boolean') return false;
    const previous = this.enabled;
    this.enabled = value;
    this.pending = true;
    this.refresh();
    try {
      this.configure(await this.api.setThinkingMode(value));
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
    this.answerStarted = false;
    this.prefaceText = '';
    this.approachText = '';
    this.expanded = false;
    this.refresh();
  }
  event(event) {
    if (!event || event.turnId !== this.turnId) return false;
    if (event.type === 'turn.approach') {
      if (this.answerStarted || typeof event.text !== 'string') return false;
      this.approachText = event.text
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .trim()
        .slice(0, 900);
      this.refresh();
      return true;
    }
    if (event.type === 'turn.preface') {
      if (this.answerStarted || typeof event.text !== 'string') return false;
      this.prefaceText = event.text
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .trim()
        .slice(0, 280);
      this.refresh();
      return true;
    }
    if (
      event.type === 'turn.delta' ||
      ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type)
    ) {
      this.answerStarted = true;
      this.prefaceText = '';
      if (event.type !== 'turn.delta') this.turnId = null;
      this.refresh();
    }
    return false;
  }
  clear() {
    this.turnId = null;
    this.prefaceText = '';
    this.approachText = '';
    this.expanded = false;
    this.refresh();
  }
  snapshot() {
    return {
      enabled: this.enabled,
      label: this.ui.text(this.enabled ? 'Thinking mode: On' : 'Thinking mode: Off'),
      hint: this.ui.text(hint),
    };
  }
  refresh() {
    const state = this.snapshot();
    this.button.setAttribute('aria-pressed', String(this.enabled));
    this.button.setAttribute('aria-label', state.label);
    this.button.setAttribute('aria-busy', String(this.pending));
    this.button.title = state.label + '\n' + state.hint;
    this.button.disabled = !this.ready || this.pending;
    this.element.textContent = this.prefaceText;
    this.element.hidden = !this.prefaceText;
    if (this.progress) this.progress.hidden = !this.prefaceText && !this.approachText;
    if (this.approachButton) {
      this.approachButton.hidden = !this.approachText;
      this.approachButton.textContent = this.ui.text('Approach') + (this.expanded ? ' ▴' : ' ▾');
      this.approachButton.setAttribute('aria-expanded', String(this.expanded));
    }
    if (this.approach) {
      this.approach.textContent = this.approachText;
      this.approach.hidden = !this.approachText || !this.expanded;
    }
    this.onChange();
  }
}
