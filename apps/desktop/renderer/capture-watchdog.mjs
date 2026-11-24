// SPDX-License-Identifier: GPL-3.0-only
//
// When Windows swaps audio devices (a monitor sleeping, a headset unplugged)
// the capture graph can freeze without the microphone track ever reporting
// "ended": the window keeps showing "listening" while no sound arrives. The
// worklet normally delivers a packet every 100 ms, so a long gap means the
// capture is dead and should be restarted.

/** No packet for this long while listening means capture has stalled. */
export const STALL_MS = 5000;
/** Restarts allowed inside RESTART_WINDOW_MS before giving up. */
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 120000;

export class CaptureWatchdog {
  constructor({
    stallMs = STALL_MS,
    maxRestarts = MAX_RESTARTS,
    windowMs = RESTART_WINDOW_MS,
    now = () => performance.now(),
  } = {}) {
    if (!(stallMs > 0) || !Number.isInteger(maxRestarts) || maxRestarts < 0 || !(windowMs > 0))
      throw new TypeError('CaptureWatchdog needs positive limits.');
    Object.assign(this, { stallMs, maxRestarts, windowMs, now });
    this.last = null;
    this.restarts = [];
  }
  /** Capture started (or restarted): expect packets from now on. */
  arm() {
    this.last = this.now();
  }
  /** A packet arrived. */
  packet() {
    if (this.last !== null) this.last = this.now();
  }
  /** Capture was stopped on purpose: silence is expected. */
  disarm() {
    this.last = null;
  }
  /** 'ok', 'restart' (capture stalled, try again) or 'give-up' (it keeps stalling). */
  check() {
    if (this.last === null) return 'ok';
    const time = this.now();
    if (time - this.last < this.stallMs) return 'ok';
    this.restarts = this.restarts.filter((at) => time - at < this.windowMs);
    this.last = null;
    if (this.restarts.length >= this.maxRestarts) return 'give-up';
    this.restarts.push(time);
    return 'restart';
  }
}
