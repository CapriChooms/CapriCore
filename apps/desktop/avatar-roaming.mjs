// SPDX-License-Identifier: GPL-3.0-only
import { COMPANION_DEFAULTS } from './companion-settings.mjs';

export function chooseRoamingDisplay({
  mode,
  displays,
  currentId,
  pointerId,
  observed,
  random = Math.random,
}) {
  const current = displays.find(({ id }) => id === currentId) ?? displays[0];
  if (mode === 'pointer') return displays.find(({ id }) => id === pointerId) ?? current;
  const candidates =
    mode === 'any'
      ? displays.filter(({ id }) => id !== current?.id)
      : observed && displays.filter(({ id }) => observed.has(id));
  if (!candidates || (mode === 'any' && !candidates.length)) return current;
  return candidates[Math.floor(random() * candidates.length)];
}

/** Uses the existing desktop tick: no extra timer, model request or screen capture. */
export class AvatarRoaming {
  constructor({ now = Date.now, random = Math.random } = {}) {
    Object.assign(this, { now, random });
    this.nextAt = Infinity;
    this.revision = 0;
  }
  sync(settings) {
    const enabled = settings.avatarRoaming === true;
    const monitors = settings.avatarRoamMonitors ?? COMPANION_DEFAULTS.avatarRoamMonitors;
    const seconds =
      settings.avatarRoamIntervalSeconds ?? COMPANION_DEFAULTS.avatarRoamIntervalSeconds;
    if (enabled !== this.enabled || seconds !== this.seconds || monitors !== this.monitors) {
      Object.assign(this, { enabled, seconds, monitors });
      this.revision++;
      this.nextAt = enabled ? this.now() + this.delay() : Infinity;
    }
  }
  delay() {
    // Never move more frequently than the selected interval; vary the pause slightly.
    return this.seconds * 1000 * (1 + this.random() * 0.2);
  }
  due(settings, { blocked = false } = {}) {
    this.sync(settings);
    if (!this.enabled) return false;
    // No queued burst, or surprise jump immediately after interaction/resume.
    if (blocked) this.nextAt = Math.max(this.nextAt, this.now() + 5000);
    return !blocked && this.now() >= this.nextAt;
  }
  postpone(settings, minimumMs = 0) {
    this.sync(settings);
    this.revision++;
    if (this.enabled) this.nextAt = this.now() + Math.max(minimumMs, this.delay());
  }
  current(settings, revision) {
    this.sync(settings);
    return this.enabled && revision === this.revision;
  }
}
