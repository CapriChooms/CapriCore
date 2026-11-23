/** Shared schema for the trusted settings store and playback renderer. */
export const VOICE_EFFECT_DEFAULTS = Object.freeze({
  enabled: false,
  preset: 'clean',
  intensity: 40,
  mix: 25,
  reverb: 0,
  delay: 0,
  filter: 0,
  glitch: 0,
  electronicMix: 0,
  carrierHz: 60,
});
export const VOICE_EFFECT_LIMITS = Object.freeze({
  intensity: 200,
  mix: 100,
  reverb: 200,
  delay: 200,
  filter: 200,
  glitch: 200,
  electronicMix: 100,
  carrierHz: 200,
});
export const VOICE_EFFECT_PRESETS = Object.freeze({
  clean: VOICE_EFFECT_DEFAULTS,
  cybernetic: {
    ...VOICE_EFFECT_DEFAULTS,
    enabled: true,
    preset: 'cybernetic',
    intensity: 145,
    mix: 68,
    reverb: 28,
    delay: 35,
    filter: 58,
    glitch: 122,
    electronicMix: 20,
    carrierHz: 48,
  },
  radio: {
    ...VOICE_EFFECT_DEFAULTS,
    enabled: true,
    preset: 'radio',
    intensity: 92,
    mix: 94,
    reverb: 0,
    delay: 0,
    filter: 151,
    glitch: 26,
  },
  holographic: {
    ...VOICE_EFFECT_DEFAULTS,
    enabled: true,
    preset: 'holographic',
    intensity: 48,
    mix: 60,
    reverb: 160,
    delay: 125,
    filter: 16,
    glitch: 0,
  },
  synthetic: {
    ...VOICE_EFFECT_DEFAULTS,
    enabled: true,
    preset: 'synthetic',
    intensity: 104,
    mix: 87,
    electronicMix: 68,
    carrierHz: 84,
    filter: 33,
  },
});
// A factory preset from an older release follows its updated factory values.
// Edited values, including Custom settings, retain the original tuning.
const previousPresets = {
  cybernetic: { intensity: 35, mix: 22, reverb: 12, delay: 8, filter: 18, glitch: 12 },
  radio: { intensity: 45, mix: 55, filter: 85, glitch: 8 },
  holographic: { intensity: 30, mix: 30, reverb: 60, delay: 25, filter: 8, glitch: 5 },
  synthetic: { mix: 65, electronicMix: 35, filter: 8 },
};
export function validateVoiceEffects(value) {
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    ![...Object.keys(VOICE_EFFECT_PRESETS), 'custom'].includes(value.preset)
  )
    throw new Error('Invalid voice effects');
  const result = { enabled: value.enabled, preset: value.preset };
  for (const [key, maximum] of Object.entries(VOICE_EFFECT_LIMITS)) {
    if (value[key] === undefined && ['electronicMix', 'carrierHz'].includes(key))
      value = { ...value, [key]: VOICE_EFFECT_DEFAULTS[key] };
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > maximum)
      throw new Error('Invalid voice effect amount');
    result[key] = Math.round(value[key]);
  }
  if (result.carrierHz < 20) throw new Error('Carrier frequency must be between 20 and 200 Hz');
  const previous = previousPresets[result.preset];
  if (
    previous &&
    Object.keys(VOICE_EFFECT_LIMITS).every(
      (key) => result[key] === (previous[key] ?? VOICE_EFFECT_DEFAULTS[key]),
    )
  )
    return { ...VOICE_EFFECT_PRESETS[result.preset], enabled: result.enabled };
  return result;
}
