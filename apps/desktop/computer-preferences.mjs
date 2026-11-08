// SPDX-License-Identifier: GPL-3.0-only
export const COMPUTER_DEFAULTS = Object.freeze({
  enabled: true,
  intensity: 50,
  theme: 'capri',
  cursor: true,
  pointerDuration: 260,
});
export function computerPreferences(value = COMPUTER_DEFAULTS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(COMPUTER_DEFAULTS, key))
  )
    throw Error('Invalid computer-control appearance.');
  const result = { ...COMPUTER_DEFAULTS, ...value };
  if (
    typeof result.enabled !== 'boolean' ||
    typeof result.cursor !== 'boolean' ||
    !Number.isInteger(result.intensity) ||
    result.intensity < 0 ||
    result.intensity > 100 ||
    !['capri', 'blackwall'].includes(result.theme) ||
    !Number.isInteger(result.pointerDuration) ||
    result.pointerDuration < 0 ||
    result.pointerDuration > 1000
  )
    throw Error('Invalid computer-control appearance.');
  return result;
}
