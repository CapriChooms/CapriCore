// SPDX-License-Identifier: GPL-3.0-only
export const VOICE_COMMIT_MESSAGE =
  'Windows ran out of committed memory while loading the voice. Enable a system-managed paging file, close memory-heavy apps, or choose a smaller Qwen model, then restart Capri. Text replies remain available.';
export function voiceStartupError(value, { pid, startedAt }) {
  if (
    value?.schemaVersion !== 1 ||
    value.pid !== pid ||
    !Number.isFinite(value.at) ||
    value.at < startedAt ||
    value.at > Date.now() + 10000 ||
    value.code !== 'CAPRI_VOICE_COMMIT_LIMIT'
  )
    return null;
  return Object.assign(new Error(VOICE_COMMIT_MESSAGE), { code: value.code, memory: value.memory });
}
