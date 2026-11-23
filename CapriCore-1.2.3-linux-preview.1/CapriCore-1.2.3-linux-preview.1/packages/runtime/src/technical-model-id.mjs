// SPDX-License-Identifier: GPL-3.0-only
/** Public model identifiers are technical metadata, never arbitrary log prose. */
export function diagnosticModelId(value) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(value) ||
    /^(?:[A-Za-z]:\/|https?:|file:|sk[-_]|gh[pousr]_|github_pat_|hf_|AIza)/i.test(value) ||
    value.includes('//') ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    /^[^/]+@[^/]+\.[^/]+$/.test(value) ||
    /(?:^|[/:_-])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|bearer)(?:$|[/:_-])/i.test(
      value,
    )
  )
    return undefined;
  return value;
}
