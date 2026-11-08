// SPDX-License-Identifier: GPL-3.0-only
export const INFERENCE_STARTUP_DEFAULTS = Object.freeze({ skipLocalModelOnApi: true });

export function inferenceStartupSettings(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'skipLocalModelOnApi') ||
    typeof value.skipLocalModelOnApi !== 'boolean'
  )
    throw new Error('Invalid model startup settings.');
  return { skipLocalModelOnApi: value.skipLocalModelOnApi };
}
