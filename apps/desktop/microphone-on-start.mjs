// SPDX-License-Identifier: GPL-3.0-only

/**
 * Grants something at most once per application launch.
 *
 * The companion window asks for its starting state every time it loads, which
 * can happen again after a renderer reload. Listening should begin when Capri
 * opens, not switch itself back on after the owner turned the microphone off.
 */
export class OncePerLaunch {
  constructor() {
    this.used = false;
  }

  /** True the first time it is called with `wanted` true; false ever after. */
  take(wanted) {
    if (wanted !== true || this.used) return false;
    this.used = true;
    return true;
  }
}
