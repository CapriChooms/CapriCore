// SPDX-License-Identifier: GPL-3.0-only
export function isLocalApiEndpoint(url) {
  return url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function isLemonadePhiEndpoint(url, model) {
  return isLocalApiEndpoint(url) && /^phi-4-mini-instruct-npu$/iu.test(model);
}

export function lemonadeNpuModel(model) {
  if (/^phi-4-mini-instruct-npu$/iu.test(model)) return 'Phi-4-mini-instruct-NPU';
  if (/^gemma-3-4b-it-mm-npu$/iu.test(model)) return 'Gemma-3-4b-it-mm-NPU';
  return null;
}

export function inferenceEndpoint(value, model) {
  let text = value;
  // Normalize only a known Lemonade NPU preset on its default local port.
  if (
    typeof text === 'string' &&
    lemonadeNpuModel(model) &&
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\s*13305(?:\/(?:api\/)?v1)?\/?$/iu.test(
      text.trim(),
    )
  )
    text = text.trim().replace(/:\s+13305/u, ':13305');
  const url = URL.parse(text);
  if (
    isLocalApiEndpoint(url) &&
    lemonadeNpuModel(model) &&
    /^\/(?:api\/)?(?:v1\/?)?$/u.test(url.pathname)
  )
    url.pathname = '/api/v1';
  return url;
}

export const isLemonadeNpuEndpoint = (url, model) =>
  isLocalApiEndpoint(url) && lemonadeNpuModel(model) !== null;
