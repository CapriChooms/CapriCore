// SPDX-License-Identifier: GPL-3.0-only
export const EXTERNAL_TTS_DEFAULTS = Object.freeze({
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini-tts',
  voice: 'coral',
});
export function externalTtsSettings(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(EXTERNAL_TTS_DEFAULTS, key))
  )
    throw new Error('Invalid voice API settings.');
  const result = { ...EXTERNAL_TTS_DEFAULTS, ...value };
  const url = typeof result.baseUrl === 'string' && URL.parse(result.baseUrl.trim());
  const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !url ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href.length > 2048
  )
    throw new Error(
      'Use HTTPS for a voice API, or HTTP for a loopback address. Omit credentials, query parameters and fragments.',
    );
  if (
    typeof result.enabled !== 'boolean' ||
    !['openai', 'elevenlabs'].includes(result.provider) ||
    typeof result.model !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(result.model) ||
    typeof result.voice !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(result.voice)
  )
    throw new Error('Enter a voice model ID and a voice name or ID.');
  result.baseUrl = url.href.replace(/\/+$/, '');
  return result;
}
