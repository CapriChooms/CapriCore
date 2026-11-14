// SPDX-License-Identifier: GPL-3.0-only
export const VOICE_VOLUME_DEFAULT = 100;

export function validateVoiceVolume(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    throw new Error('Invalid voice volume.');
  return value;
}

export function voiceVolumeSettings(value) {
  return {
    volume: validateVoiceVolume(value.volume),
    lastAudible: validateVoiceVolume(value.lastAudible) || VOICE_VOLUME_DEFAULT,
  };
}
