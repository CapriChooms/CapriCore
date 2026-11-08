// SPDX-License-Identifier: GPL-3.0-only
// Pure, shared renderer/host validation. Keys are opaque; no vendor prefix is
// required. Only presentation characters outside the copied token are removed.
export const MAX_API_KEY_LENGTH = 4096;
const boundary = /^[\s\u200b\u2060\ufeff]+|[\s\u200b\u2060\ufeff]+$/gu;

export function normalizeApiKey(value) {
  if (typeof value !== 'string') return value;
  let key = value.replace(boundary, '');
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"'))
    key = key.slice(1, -1).replace(boundary, '');
  return key;
}

export function validApiKey(value) {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= MAX_API_KEY_LENGTH &&
    /^[\x21-\x7e]+$/u.test(value) &&
    !/["\\]/u.test(value)
  );
}

export function apiKeyProblem(value) {
  if (typeof value !== 'string' || value.length < 8) return 'Enter a valid API key.';
  if (value.length > MAX_API_KEY_LENGTH) return 'API key is too long (maximum 4096 characters).';
  if (!validApiKey(value)) return 'Paste only the API key, without spaces or quotation marks.';
  return null;
}
