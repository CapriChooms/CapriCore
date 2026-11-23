// SPDX-License-Identifier: GPL-3.0-only
import { Preferences } from './preferences.mjs';
const validate = (value) => {
  if (!value || Object.keys(value).length !== 1 || typeof value.enabled !== 'boolean')
    throw new Error('Invalid application access setting.');
  return { enabled: value.enabled };
};
/** Pauses capabilities without overwriting any application-specific grants. */
export class ApplicationAccess {
  constructor({ file, stop = async () => {}, changed = () => {} }) {
    this.preferences = new Preferences(file, { enabled: true }, validate);
    this.controller = new AbortController();
    if (!this.enabled) this.controller.abort();
    Object.assign(this, { stop, changed });
  }
  get enabled() {
    return this.preferences.value.enabled;
  }
  get signal() {
    return this.controller.signal;
  }
  snapshot() {
    return this.preferences.snapshot();
  }
  assertAllowed(tool, args) {
    if (
      this.enabled ||
      !['desktop_control', 'application_control', 'spotify_control', 'workflow_control'].includes(
        tool,
      ) ||
      ['status', 'apps', 'control_status'].includes(args?.action)
    )
      return;
    throw Object.assign(
      new Error('Application access is paused. Turn it on from Capri’s toolbar.'),
      { code: 'APPLICATION_ACCESS_PAUSED' },
    );
  }
  mask(value) {
    return this.enabled ? { ...value } : { ...value, notepad: false, calculator: false };
  }
  set(value) {
    const task = Promise.resolve(this.pending)
      .catch(() => {})
      .then(() => this.apply(value));
    this.pending = task;
    return task;
  }
  async apply(value) {
    validate({ enabled: value });
    if (value === this.enabled) return this.snapshot();
    this.preferences.set({ enabled: value });
    if (value) this.controller = new AbortController();
    else this.controller.abort();
    try {
      if (!value) await this.stop();
    } finally {
      this.changed(this.snapshot());
    }
    return this.snapshot();
  }
}
