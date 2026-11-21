// SPDX-License-Identifier: GPL-3.0-only
export const VOICE_VOLUME_DEFAULT = 100;
export const VOICE_VOLUME_MAX = 200;

export function validateVoiceVolume(value) {
  if (!Number.isInteger(value) || value < 0 || value > VOICE_VOLUME_MAX)
    throw new Error('Invalid voice volume.');
  return value;
}

export function voiceVolumeSettings(value) {
  return {
    volume: validateVoiceVolume(value.volume),
    lastAudible: validateVoiceVolume(value.lastAudible) || VOICE_VOLUME_DEFAULT,
  };
}
