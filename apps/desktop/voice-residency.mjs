// SPDX-License-Identifier: GPL-3.0-only
/** Release muted TTS on memory-constrained PCs; serialize against a later start.
 * All process ownership and termination remain in the injected runtime boundary.
 */
export class MutedVoiceResidency {
  constructor({ enabled, needed, resident, cancel, starting, stop }) {
    Object.assign(this, { enabled, needed, resident, cancel, starting, stop });
    this.pending = null;
    this.releases = 0;
    this.lastError = null;
  }
  diagnostics() {
    return {
      enabled: this.enabled,
      releasing: Boolean(this.pending),
      releases: this.releases,
      lastError: this.lastError,
    };
  }
  release() {
    if (!this.enabled || this.needed()) return Promise.resolve(false);
    if (this.pending) return this.pending;
    if (!this.resident()) return Promise.resolve(false);
    this.cancel();
    const starting = this.starting();
    const work = Promise.resolve()
      .then(async () => {
        // Startup cancellation may reject; a newly enabled/previewed voice still
        // wins before termination begins. New starts await pending termination.
        await starting?.catch(() => {});
        if (this.needed()) return false;
        await this.stop();
        this.lastError = null;
        this.releases++;
        return true;
      })
      .catch((error) => {
        this.lastError = { name: error.name, message: error.message.slice(0, 500) };
        throw error;
      })
      .finally(() => {
        if (this.pending === work) this.pending = null;
      });
    this.pending = work;
    return work;
  }
}
