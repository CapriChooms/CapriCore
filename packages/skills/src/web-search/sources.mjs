// SPDX-License-Identifier: GPL-3.0-only
// Display links only: never fetch arbitrary pages or expose a general URL opener.
export function publicWebSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f]/u.test(value))
    return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.+$/u, '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      /^(?:[\d.]+|\[.*\])$/u.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion|home|lan)$/u.test(host) ||
      [...url.searchParams.keys()].some((key) =>
        /^(?:api[_-]?key|access[_-]?token|token|key|auth|password|secret|authorization)$/iu.test(
          key,
        ),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function webSources(values) {
  if (!Array.isArray(values)) return [];
  const result = [],
    seen = new Set();
  for (const value of values.slice(0, 10)) {
    const url = publicWebSourceUrl(value?.url);
    if (!url || seen.has(url) || typeof value.title !== 'string') continue;
    const title = value.title
      .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .trim()
      .slice(0, 180);
    if (!title) continue;
    result.push({ title, url });
    seen.add(url);
    if (result.length === 5) break;
  }
  return result;
}
