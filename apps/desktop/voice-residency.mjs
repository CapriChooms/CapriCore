// SPDX-License-Identifier: GPL-3.0-only
/** Release muted or idle TTS and serialize against a later start.
 * All process ownership and termination remain in the injected runtime boundary.
 */
export class MutedVoiceResidency {
  constructor({
    enabled,
    needed,
    resident,
    cancel,
    starting,
    stop,
    idleEligible = () => false,
    idleBusy = () => false,
    idleMs = 90000,
    onIdleError = () => {},
  }) {
    Object.assign(this, {
      enabled,
      needed,
      resident,
      cancel,
      starting,
      stop,
      idleEligible,
      idleBusy,
      idleMs,
      onIdleError,
    });
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
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.enabled || !this.idleEligible()) return;
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = null;
        if (!this.idleEligible()) return;
        if (this.idleBusy()) this.scheduleIdle();
        else void this.release({ idle: true }).catch(this.onIdleError);
      },
      typeof this.idleMs === 'function' ? this.idleMs() : this.idleMs,
    );
    this.idleTimer.unref();
  }
  release({ idle = false } = {}) {
    const needed = idle ? this.idleBusy : this.needed;
    if (!this.enabled || needed() || (idle && !this.idleEligible())) return Promise.resolve(false);
    if (this.pending) return this.pending;
    if (!this.resident()) return Promise.resolve(false);
    this.cancel({ idle });
    const starting = this.starting();
    const work = Promise.resolve()
      .then(async () => {
        // Startup cancellation may reject; a newly enabled/previewed voice still
        // wins before termination begins. New starts await pending termination.
        await starting?.catch(() => {});
        if (needed()) return false;
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
