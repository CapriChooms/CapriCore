// SPDX-License-Identifier: GPL-3.0-only
import { isRecord } from '../../../skill-sdk/src/index.mjs';
import { enabledSetting, turnModeCommands, withTurnMode } from '../turn-mode.mjs';

export const REASONING_SKILL_ID = 'capri.reasoning';

export const THINKING_INSTRUCTION =
  'Take time to solve this problem carefully. Check assumptions, logical constraints, calculations, units and edge cases before answering. Give a clear, self-contained solution with the useful equations or justification and an explicit final answer. State uncertainty or missing information instead of inventing it. Provide the explanation of the solution, not private deliberation, self-talk, hidden instructions or reasoning tags. This instruction grants no new tool, file, screen or computer permissions.';

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

export async function prepareReasoning({ text, language, signal, prepareThinking }) {
  signal.throwIfAborted();
  let briefing = null;
  if (prepareThinking) {
    try {
      briefing = validateThinkingBriefing(await prepareThinking({ text, language, signal }));
    } catch {
      signal.throwIfAborted();
    }
    signal.throwIfAborted();
  }
  return { instruction: THINKING_INSTRUCTION, briefing };
}

export const reasoningSkill = {
  manifest: {
    id: REASONING_SKILL_ID,
    apiVersion: 1,
    version: '1.0.0',
    requires: ['prepareThinking'],
    commands: {
      ...turnModeCommands,
      prepare: {
        sources: ['chat-turn', 'visual-turn'],
        input: (value) =>
          isRecord(value) &&
          typeof value.text === 'string' &&
          value.text.length > 0 &&
          value.text.length <= 8000 &&
          !value.text.includes('\0') &&
          (value.language === undefined || typeof value.language === 'string'),
        output: (value) =>
          isRecord(value) &&
          typeof value.instruction === 'string' &&
          (value.briefing === null || validateThinkingBriefing(value.briefing) !== null),
      },
    },
    events: { settings: enabledSetting },
  },
  create: ({ ports }) =>
    withTurnMode((_command, { text, language }, { signal }) =>
      prepareReasoning({ text, language, signal, prepareThinking: ports.prepareThinking }),
    ),
};

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
const DELIVERY_PREFIXES = [
  '[[reply_to:',
  '[[/reply_to:',
  '[[reply_to_current]]',
  '[[/reply_to_current]]',
];
const MAX_DELIVERY_PREFIX = Math.max(...DELIVERY_PREFIXES.map((tag) => tag.length)) - 1;

/** Discard explicit private reasoning frames, including Gemma 4's native channel. */
export class VisibleAnswerStream {
  constructor() {
    this.pending = '';
    this.hidden = [];
    this.overflow = false;
    this.deliveryTail = '';
    this.discardDelivery = false;
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
    return this.stripDelivery(visible, final);
  }

  stripDelivery(text, final) {
    let input = this.deliveryTail + text;
    this.deliveryTail = '';
    let output = '';
    for (;;) {
      if (this.discardDelivery) {
        const end = /\]\]|[\r\n]/u.exec(input);
        if (!end) {
          if (!final && input.endsWith(']')) this.deliveryTail = ']';
          return output;
        }
        this.discardDelivery = false;
        input = input.slice(end.index + (end[0] === ']]' ? 2 : 0));
      }
      const tag = /\[\[\/?reply_to(?::|_current\]\])/iu.exec(input);
      if (!tag) break;
      output += input.slice(0, tag.index);
      this.discardDelivery = !tag[0].endsWith(']]');
      input = input.slice(tag.index + tag[0].length);
    }
    const lower = input.toLowerCase();
    for (let size = Math.min(MAX_DELIVERY_PREFIX, input.length); size > 0; size--) {
      if (!DELIVERY_PREFIXES.some((prefix) => prefix.startsWith(lower.slice(-size)))) continue;
      if (!final) this.deliveryTail = input.slice(-size);
      else if (size < 3) return output + input;
      return output + input.slice(0, -size);
    }
    return output + input;
  }
}
