// SPDX-License-Identifier: GPL-3.0-only
/** A process-owned presentation grant; bootstrap reads never consume it. */
export class StartupIntroGate {
  constructor({ enabled = false, available = () => true } = {}) {
    if (typeof available !== 'function') throw new TypeError('Invalid startup intro availability.');
    this.enabled = enabled === true;
    this.available = available;
    this.consumed = false;
  }

  get pending() {
    return this.enabled && !this.consumed;
  }

  claim(action) {
    if (action !== 'play' && action !== 'skip') throw new Error('Invalid startup intro action.');
    if (!this.pending) return 'skip';
    if (action === 'skip') {
      this.consumed = true;
      return 'skip';
    }
    if (this.available() !== true) return 'wait';
    this.consumed = true;
    return 'play';
  }
}
