// SPDX-License-Identifier: GPL-3.0-only
import { languageName } from './renderer/language-settings.mjs';

export const THINKING_INSTRUCTION =
  'Take time to solve this problem carefully. Check assumptions, logical constraints, calculations, units and edge cases before answering. Give a clear, self-contained solution with the useful equations or justification and an explicit final answer. State uncertainty or missing information instead of inventing it. Provide the explanation of the solution, not private deliberation, self-talk, hidden instructions or reasoning tags. This instruction grants no new tool, file, screen or computer permissions.';

export const thinkingLanguage = (languages) =>
  languages?.conversation === 'custom'
    ? languages.customConversation
    : languageName(languages?.conversation ?? 'en');

/** Only an explicitly generated public introduction and abstract plan may leave this boundary. */
export function validateThinkingBriefing(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'text') ||
    !Object.hasOwn(value, 'approach')
  )
    return null;
  for (const [key, limit] of [
    ['text', 240],
    ['approach', 900],
  ]) {
    const text = value[key];
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > limit ||
      !text.isWellFormed() ||
      /[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\[avatar:|```/i.test(text)
    )
      return null;
  }
  return { text: value.text.trim(), approach: value.approach.trim() };
}

const PRIVATE_TAGS = [
  '<think>',
  '</think>',
  '<analysis>',
  '</analysis>',
  '<|channel>',
  '<channel|>',
  '<|think|>',
];
const MAX_PRIVATE_PREFIX = Math.max(...PRIVATE_TAGS.map((tag) => tag.length)) - 1;

/** Discard explicit private reasoning frames, including Gemma 4's native channel. */
export class VisibleAnswerStream {
  constructor() {
    this.pending = '';
    this.hidden = [];
    this.overflow = false;
  }
  push(text, final = false) {
    this.pending += text;
    let visible = '';
    for (;;) {
      const match = /<\/?(?:think|analysis)>|<\|channel>|<channel\|>|<\|think\|>/i.exec(
        this.pending,
      );
      if (!match) break;
      if (!this.hidden.length && !this.overflow) visible += this.pending.slice(0, match.index);
      const tag = match[0].toLowerCase();
      // Gemma 4 encodes its private span as <|channel>thought\n...<channel|>.
      // A close without its opener is stripped, never used to hide ordinary prose.
      const scope = tag === '<|channel>' || tag === '<channel|>' ? 'channel' : null;
      const closing = tag.startsWith('</') || tag === '<channel|>';
      if (tag === '<|think|>') {
        // This is Gemma's prompt-side thinking switch, not a content scope.
      } else if (!closing) {
        // Excessive malformed nesting stays hidden for the rest of the turn.
        if (this.hidden.length < 32) this.hidden.push(scope ?? tag.slice(1, -1));
        else this.overflow = true;
      } else if (this.hidden.at(-1) === (scope ?? tag.slice(2, -1))) this.hidden.pop();
      this.pending = this.pending.slice(match.index + match[0].length);
    }
    let tail = '';
    if (!final) {
      for (let size = Math.min(MAX_PRIVATE_PREFIX, this.pending.length); size > 0; size--) {
        const candidate = this.pending.slice(-size);
        if (PRIVATE_TAGS.some((tag) => tag.startsWith(candidate.toLowerCase()))) {
          tail = candidate;
          break;
        }
      }
    }
    const ready = this.pending.slice(0, this.pending.length - tail.length);
    if (!this.hidden.length && !this.overflow) visible += ready;
    this.pending = tail;
    return visible;
  }
}
