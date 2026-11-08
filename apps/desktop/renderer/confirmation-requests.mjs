// SPDX-License-Identifier: GPL-3.0-only
/** Match backend confirmations to their lifetime, including time spent saving drafts. */
export class ConfirmationRequests {
  constructor({ dialog, prepare, respond }) {
    Object.assign(this, { dialog, prepare, respond });
    this.pending = new Map();
  }
  async request(value) {
    if (this.pending.has(value.id)) return;
    const controller = new AbortController();
    this.pending.set(value.id, controller);
    const { signal } = controller;
    try {
      const ready = await this.prepare();
      if (signal.aborted) return;
      const choice = ready ? await this.dialog.ask({ ...value, signal }) : 'cancel';
      if (!signal.aborted) await this.respond({ id: value.id, choice });
    } catch (error) {
      if (!signal.aborted) await this.respond({ id: value.id, choice: 'cancel' }).catch(() => {});
      throw error;
    } finally {
      this.pending.delete(value.id);
    }
  }
  close(id) {
    this.pending.get(id)?.abort();
  }
}
