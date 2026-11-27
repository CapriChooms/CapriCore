// SPDX-License-Identifier: GPL-3.0-only
export const MUSIC_LISTENING_DEFAULTS = Object.freeze({
  enabled: true,
  notes: true,
  motion: true,
  autoBpm: true,
});

export const MUSIC_TEMPO_MIN_CONFIDENCE = 0.45;

export function musicTempoReady(value) {
  return (
    Number.isFinite(value?.tempo) &&
    value.tempo >= 40 &&
    value.tempo <= 240 &&
    Number.isFinite(value.tempoConfidence) &&
    value.tempoConfidence >= MUSIC_TEMPO_MIN_CONFIDENCE &&
    value.tempoConfidence <= 1
  );
}

/** Start beat motion once the audio tracker has a reliable tempo. */
export function musicAnimationReady(value) {
  return Boolean(
    value?.enabled === true &&
      value.hearingMusic === true &&
      value.settings?.enabled !== false &&
      musicTempoReady(value),
  );
}

export function musicBreathingTempo(value) {
  const preferences = value?.settings ?? value;
  if (!musicAnimationReady(value) || preferences.motion === false) return 0;
  return preferences.autoBpm === false ? 110 : value.tempo;
}

/** Preferences never represent an active capture grant or a running microphone. */
export function validateMusicListeningSettings(value = MUSIC_LISTENING_DEFAULTS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(MUSIC_LISTENING_DEFAULTS, key)) ||
    Object.keys(MUSIC_LISTENING_DEFAULTS).some(
      (key) => (key !== 'autoBpm' || Object.hasOwn(value, key)) && typeof value[key] !== 'boolean',
    )
  )
    throw Error('Invalid music listening settings.');
  return {
    enabled: value.enabled,
    notes: value.notes,
    motion: value.motion,
    autoBpm: Object.hasOwn(value, 'autoBpm') ? value.autoBpm : true,
  };
}
