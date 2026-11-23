// SPDX-License-Identifier: GPL-3.0-only
import { interferenceFrame } from './presence-model.mjs';

export const GLITCH_DEFAULTS = Object.freeze({
  glitchEnabled: true,
  glitchStrength: 65,
  glitchIntervalSeconds: 35,
  glitchEvents: true,
});

export function validateGlitchSettings(value) {
  const next = Object.fromEntries(
    Object.entries(GLITCH_DEFAULTS).map(([key, fallback]) => [
      key,
      value?.[key] === undefined ? fallback : value[key],
    ]),
  );
  if (
    typeof next.glitchEnabled !== 'boolean' ||
    typeof next.glitchEvents !== 'boolean' ||
    !Number.isInteger(next.glitchStrength) ||
    next.glitchStrength < 0 ||
    next.glitchStrength > 100 ||
    !Number.isInteger(next.glitchIntervalSeconds) ||
    next.glitchIntervalSeconds < 10 ||
    next.glitchIntervalSeconds > 120
  )
    throw new Error('Invalid visual glitch settings');
  return next;
}

/** Coalesce adjacent speech/pose/status events; clicks never enter this schedule. */
export class GlitchSchedule {
  constructor(value = GLITCH_DEFAULTS) {
    this.configure(value);
    this.seenAt = -Infinity;
    this.eventAt = -Infinity;
  }
  configure(value) {
    this.settings = validateGlitchSettings(value);
  }
  frame(now, requestedAt, reduced = false) {
    const value = this.settings;
    if (requestedAt > this.seenAt) {
      this.seenAt = requestedAt;
      if (value.glitchEnabled && value.glitchEvents && !reduced && now - this.eventAt >= 6000)
        this.eventAt = now;
    }
    return interferenceFrame(now, this.eventAt, reduced, {
      enabled: value.glitchEnabled,
      strength: value.glitchStrength / 100,
      intervalMs: value.glitchIntervalSeconds * 1000,
      events: value.glitchEvents,
    });
  }
}
