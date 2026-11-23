// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
/** Main-process destructive actions require a response to their current UI request. */
export class Confirmations {
  constructor({ emit, show, now = () => performance.now() }) {
    Object.assign(this, { emit, show, now });
    this.pending = null;
  }
  request(options) {
    return this.choose(options).then((choice) => choice === 'confirm');
  }
  /** Multi-action dialogs return an explicit choice; binary approvals stay boolean. */
  choose({ signal, ...options }) {
    if (this.pending || signal?.aborted) return Promise.resolve('cancel');
    const choices = options.choices ?? [
      { id: 'cancel', label: 'Cancel' },
      { id: 'confirm', label: options.confirmLabel ?? 'Confirm', danger: options.danger },
    ];
    if (
      !Array.isArray(choices) ||
      choices.length < 2 ||
      choices.some((choice) => !choice || typeof choice.id !== 'string' || !choice.id) ||
      new Set(choices.map((choice) => choice.id)).size !== choices.length ||
      !choices.some((choice) => choice.id === 'cancel')
    )
      throw new Error('Invalid confirmation choices');
    const delayMs = options.delayMs ?? 0;
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10000)
      throw new Error('Invalid confirmation delay');
    return new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => this.respond({ id, choice: 'cancel' }), 180000);
      const abort = () => this.respond({ id, choice: 'cancel' });
      this.pending = {
        id,
        resolve,
        timer,
        cleanup: () => signal?.removeEventListener('abort', abort),
        acceptAfter: this.now() + delayMs,
        choices: new Set(choices.map((choice) => choice.id)),
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.show();
      this.emit({ type: 'confirmation.request', id, ...options, choices });
      if (signal?.aborted) abort();
    });
  }
  respond(value) {
    const pending = this.pending;
    if (!pending || value?.id !== pending.id || !pending.choices.has(value.choice)) return false;
    if (value.choice !== 'cancel' && this.now() < pending.acceptAfter) return false;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.cleanup();
    this.emit({ type: 'confirmation.closed', id: pending.id });
    pending.resolve(value.choice);
    return true;
  }
  cancel() {
    if (this.pending) this.respond({ id: this.pending.id, choice: 'cancel' });
  }
}
