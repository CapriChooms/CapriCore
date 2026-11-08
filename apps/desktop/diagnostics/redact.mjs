// SPDX-License-Identifier: GPL-3.0-only
import { privateLog, privateLogRecord } from '../../../packages/runtime/src/privacy-log.mjs';
import { isDiagnosticControlValue } from './state.mjs';
const privateKey =
  /^(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|headers|env|environment|messages|prompt|transcript|content|audio|image|personality|utterance|requestBody|responseBody|goal|query|parameters|arguments|clipboard|windowTitle|caption|fileName|filePath)$/i;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redactor({ root, home, secrets = [] } = {}) {
  const replacements = [
    ...secrets.filter((s) => typeof s === 'string' && s.length >= 8).map((s) => [s, '[SECRET]']),
    ...[
      [root, '<INSTALL>'],
      [home, '<USER>'],
    ].flatMap(([value, label]) =>
      value
        ? [
            [value, label],
            [value.replaceAll('\\', '/'), label],
            [value.replaceAll('\\', '\\\\'), label],
            [encodeURI(value.replaceAll('\\', '/')), label],
          ]
        : [],
    ),
  ].sort((a, b) => b[0].length - a[0].length);
  const text = (input) => {
    let value = String(input ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    for (const [from, to] of replacements)
      value = value.replace(new RegExp(escape(from), 'gi'), to);
    return value
      .replace(/\b(?:Authorization|Cookie|Set-Cookie)\s*[:=]\s*[^\r\n]*/gi, '[PRIVATE HEADER]')
      .replace(
        /(\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|token|secret)\s*["']?\s*[:=]\s*)(["'])(.*?)\2/gi,
        '$1"[SECRET]"',
      )
      .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [SECRET]')
      .replace(
        /(\b(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|token|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
        '$1[SECRET]',
      )
      .replace(/https?:\/\/[^\s"<>]+/gi, (url) =>
        url
          .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/i, '$1[SECRET]@')
          .replace(/[?#].*$/, '?[REDACTED]'),
      )
      .replace(/\b(?:sk|gh[pousr]|github_pat|hf)_[A-Za-z0-9_-]{12,}\b/g, '[SECRET]')
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[SECRET]')
      .replace(/\b[A-Z]:[\\/]Users[\\/][^\\/\r\n"<>]+/gi, '<USER>')
      .replace(/(?:\/(?:home|Users)\/)[^/\s"<>]+/g, '<USER>')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
  };
  const value = (input, depth = 0) => {
    if (depth > 12) return '[DEPTH LIMIT]';
    if (typeof input === 'string') return text(input);
    if (Array.isArray(input)) return input.slice(0, 150).map((item) => value(item, depth + 1));
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .slice(0, 150)
          .map(([key, item]) => [
            key,
            privateKey.test(key)
              ? '[REDACTED]'
              : /^(?:error|message|reason|stack|stderr|stdout|warning)$/.test(key) &&
                  typeof item === 'string'
                ? isDiagnosticControlValue(key, item)
                  ? item
                  : privateLogRecord(item)
                : value(item, depth + 1),
          ]),
      );
    return input;
  };
  const log = privateLog;
  return { text, value, log };
}
