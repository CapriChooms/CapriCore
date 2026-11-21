// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';

export const toolLoopError = (failureCode = 'CAPRI_TOOL_LOOP_GATEWAY') =>
  Object.assign(new Error('Tool execution made no progress.'), {
    code: 'CAPRI_TOOL_LOOP',
    failureCode,
  });
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const fingerprint = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const discovery = new Set(['apps', 'find_app', 'status', 'journal']);

/** Turn-local, content-free fingerprints. Successful actions reset the discovery budget. */
export class ToolProgressGuard {
  constructor() {
    this.reads = new Map();
    this.failures = 0;
    this.failedAction = '';
  }
  record(tool, args, result) {
    if (result?.needsApproval || result?.needsWindow) return;
    if (result?.ok === false) {
      const action = tool + ':' + args?.action;
      this.failures = action === this.failedAction ? this.failures + 1 : 1;
      this.failedAction = action;
      if (this.failures >= 3) throw toolLoopError('CAPRI_TOOL_LOOP_REPEATED_FAILURE');
      return;
    }
    this.failures = 0;
    if (result?.ok !== true) return;
    if (!discovery.has(args?.action)) {
      this.reads.clear();
      return;
    }
    const key = fingerprint([tool, args, result]);
    const count = (this.reads.get(key) ?? 0) + 1;
    if (this.reads.size >= 32) this.reads.delete(this.reads.keys().next().value);
    this.reads.set(key, count);
    if (count >= 3) throw toolLoopError('CAPRI_TOOL_LOOP_UNCHANGED_RESULT');
  }
}

const failurePrefixes = ['OpenClaw stopped this run', 'OpenClaw stopped this turn'];
const toolNames = [
  'spotify_control',
  'application_control',
  'desktop_control',
  'filesystem_control',
  'settings_control',
  'time_control',
];
const toolPrefixes = [
  '<tool_call>',
  '<tool_call ',
  ...toolNames.flatMap((name) => [name + '{', name + '(', '<function=' + name + '>']),
];
/** Hold only a possible diagnostic prefix at a line start, never an entire normal reply. */
export class CoreFailureStream {
  constructor() {
    this.buffer = '';
    this.lineStart = true;
    this.failed = false;
  }
  push(text, final = false) {
    if (this.failed) throw this.failure ?? toolLoopError();
    let output = '';
    for (const char of text) {
      if (!this.lineStart) {
        output += char;
        this.lineStart = char === '\n';
        continue;
      }
      this.buffer += char;
      const candidate = this.buffer.trimStart().toLowerCase();
      if (!candidate) {
        if (this.buffer.length >= 64) {
          output += this.buffer;
          this.buffer = '';
        }
        continue;
      }
      const toolCandidate = candidate.replace(/^(?:\*\*|\x60{1,3})?\[?/u, '');
      if (toolPrefixes.includes(toolCandidate)) {
        this.failed = true;
        this.buffer = '';
        this.failure = Object.assign(new Error('Model returned tool syntax as reply text.'), {
          code: 'CAPRI_TOOL_ENCODING',
        });
        throw this.failure;
      }
      if (failurePrefixes.some((prefix) => candidate === prefix.toLowerCase())) {
        this.failed = true;
        this.buffer = '';
        throw toolLoopError();
      }
      if (
        failurePrefixes.some((prefix) => prefix.toLowerCase().startsWith(candidate)) ||
        ['[', '**', '**[', '\x60\x60\x60'].some((prefix) => prefix.startsWith(candidate)) ||
        toolPrefixes.some((prefix) => prefix.startsWith(toolCandidate))
      )
        continue;
      output += this.buffer;
      this.buffer = '';
      this.lineStart = char === '\n';
    }
    if (final) {
      output += this.buffer;
      this.buffer = '';
    }
    return output;
  }
}
