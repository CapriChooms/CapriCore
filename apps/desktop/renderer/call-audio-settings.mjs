// SPDX-License-Identifier: GPL-3.0-only
export const CALL_VOICE_VOLUME_DEFAULT = 50;

export function validateCallVoiceVolume(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    throw new Error('Invalid call voice volume.');
  return value;
}
